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
  assert.equal(translationScope(config), 'https://test.example\ntest');
  assert.equal(translationScope(config, 'word'), translationScope({ ...config, version: '9.0.0' }, 'word'));
  assert.notEqual(wordCacheKey('charge', 'charge a fee'), wordCacheKey('charge', 'charge a battery'));
});
