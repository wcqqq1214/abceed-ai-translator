import test from 'node:test';
import assert from 'node:assert/strict';
import { TranslationCache } from '../src/cache.js';

function storage() {
  let saved;
  return { read: () => structuredClone(saved), write: value => { saved = structuredClone(value); } };
}

test('persists across instances without storing API credentials', () => {
  const backing = storage();
  const first = new TranslationCache(backing);
  first.load('https://api.deepseek.com/chat/completions\ndeepseek-flash');
  first.set('ホーム', '首页'); first.flush();
  const second = new TranslationCache(backing);
  second.load('https://api.deepseek.com/chat/completions\ndeepseek-flash');
  assert.equal(second.get('ホーム'), '首页');
  assert.deepEqual(Object.keys(backing.read()).sort(), ['entries', 'scope', 'version']);
});
test('translations do not expire with time and provider/model changes remain isolated', t => {
  const backing = storage();
  const cache = new TranslationCache(backing);
  t.mock.method(Date, 'now', () => 1000);
  cache.load('provider/model-a'); cache.set('解説', '解析'); cache.flush();
  cache.load('provider/model-b'); assert.equal(cache.get('解説'), undefined);
  t.mock.method(Date, 'now', () => 1000 + 10 * 365 * 24 * 60 * 60 * 1000);
  cache.load('provider/model-a'); assert.equal(cache.get('解説'), '解析');
  assert.equal(backing.read().version, 2);
  assert.deepEqual(backing.read().entries, [['解説', '解析']]);
});
test('preserves legacy translations even after their former expiry and writes v2 format', () => {
  const backing = storage();
  backing.write({ version: 1, scope: 'test', entries: [['ホーム', '首页', 0]] });
  const cache = new TranslationCache(backing);
  cache.load('test');
  assert.equal(cache.get('ホーム'), '首页');
  cache.set('解説', '解析'); cache.flush();
  assert.equal(backing.read().version, 2);
  assert.ok(backing.read().entries.every(entry => entry.length === 2));
  const reopened = new TranslationCache(backing); reopened.load('test');
  assert.equal(reopened.get('ホーム'), '首页');
});
test('bounds storage and retains recently accessed menu labels', () => {
  const cache = new TranslationCache({ limit: 2, maxChars: 100 });
  cache.load('test');
  cache.set('ホーム', '首页'); cache.set('教材', '教材');
  cache.get('ホーム'); cache.set('解説', '解析'); cache.flush();
  assert.equal(cache.get('教材'), undefined);
  assert.equal(cache.get('ホーム'), '首页');
  assert.equal(cache.get('解説'), '解析');
  const tiny = new TranslationCache({ maxChars: 3 });
  tiny.set('ホーム', '首页');
  assert.equal(tiny.get('ホーム'), undefined);
});
test('merges translations from two tabs and clear survives reopening', () => {
  const backing = storage();
  const one = new TranslationCache(backing), two = new TranslationCache(backing);
  one.load('test'); two.load('test');
  one.set('ホーム', '首页'); one.flush();
  two.set('解説', '解析'); two.flush();
  const fresh = new TranslationCache(backing);
  fresh.load('test');
  assert.equal(fresh.get('ホーム'), '首页'); assert.equal(fresh.get('解説'), '解析');
  fresh.clear(); one.load('test'); assert.equal(one.get('ホーム'), undefined);
});
test('malformed storage and write failures do not break in-memory translation', () => {
  const cache = new TranslationCache({ read: () => ({ version: 1, scope: 'test', entries: [null, [], ['x', {}, 999999999999999]] }), write: () => { throw new Error('storage unavailable'); } });
  cache.load('test'); assert.deepEqual(cache.values(), []);
  cache.set('解説', '解析'); cache.flush(); assert.equal(cache.get('解説'), '解析');
});

test('cache scopes version translation policies independently of application releases', async () => {
  const { translationScope, wordCacheKey } = await import('../src/cache.js');
  const config = { endpoint: 'https://test.example', model: 'test', version: '1.0.0' };
  assert.equal(translationScope(config), 'https://test.example\ntest\npage-v2');
  assert.equal(translationScope(config, 'word'), translationScope({ ...config, version: '9.0.0' }, 'word'));
  assert.notEqual(wordCacheKey('charge', 'charge a fee'), wordCacheKey('charge', 'charge a battery'));
});

test('persisting a full cache preserves recent hits instead of resurrecting evicted entries', () => {
  const backing = storage();
  const cache = new TranslationCache({ ...backing, limit: 2 });
  cache.load('test');
  cache.set('ホーム', '首页'); cache.set('教材', '教材'); cache.flush();
  cache.get('ホーム'); cache.set('解説', '解析'); cache.flush();
  assert.deepEqual(backing.read().entries, [['ホーム', '首页'], ['解説', '解析']]);
  assert.equal(cache.get('教材'), undefined);
});

test('another tab cannot restore cleared cached or queued results', () => {
  const backing = storage();
  const one = new TranslationCache(backing), two = new TranslationCache(backing);
  one.load('test'); one.set('ホーム', '首页'); one.flush();
  two.load('test'); two.set('教材', '教材');
  one.clear(); two.flush();
  assert.deepEqual(backing.read().entries, []);
  assert.equal(two.get('ホーム'), undefined);
  assert.equal(two.get('教材'), undefined);
  two.set('解説', '解析'); two.flush();
  assert.deepEqual(backing.read().entries, [['解説', '解析']]);
  // A tab that has not flushed since the clear must also retain only fresh results.
  const three = new TranslationCache(backing); three.load('test');
  one.clear(); three.set('問題', '题目'); three.flush();
  assert.deepEqual(backing.read().entries, [['問題', '题目']]);
});

test('a failed clear stays cleared in memory and retries persistence without restoring old data', () => {
  const backing = storage();
  let fail = false;
  const cache = new TranslationCache({ read: backing.read, write: snapshot => {
    if (fail) throw new Error('storage unavailable');
    backing.write(snapshot);
  } });
  cache.load('test'); cache.set('ホーム', '首页'); cache.flush();
  fail = true; cache.clear(); cache.set('解説', '解析'); cache.flush();
  assert.equal(cache.get('ホーム'), undefined);
  assert.equal(cache.get('解説'), '解析');
  fail = false; cache.flush();
  assert.deepEqual(backing.read().entries, [['解説', '解析']]);
});

test('old and new question-count translations use 题 without changing unrelated prose', () => {
  const cache = new TranslationCache({ read: () => ({ version: 2, scope: 'test', entries: [['215問', '215问'], ['問', '问'], ['質問', '提问']] }) });
  cache.load('test');
  assert.equal(cache.get('215問'), '215题');
  assert.equal(cache.get('問'), '题');
  assert.equal(cache.get('質問'), '提问');
  cache.set('388問', '388题'); assert.equal(cache.get('388問'), '388题');
  cache.set('1,234問', '1,234问'); assert.equal(cache.get('1,234問'), '1,234题');
  cache.set('English 問題', 'English 问题'); assert.equal(cache.get('English 問題'), 'English 问题');
});
