import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { selectedEnglishWord, createWordTranslator, WordLookup } from '../src/words.js';
import { TranslationCache } from '../src/cache.js';

const config = { endpoint: 'https://api.deepseek.com/chat/completions', model: 'test', key: 'test-only' };
const envelope = meaning => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ meaning }) } }] });

test('word requests use AI dictionary instructions and disable DeepSeek thinking', async () => {
  let body;
  const translate = createWordTranslator(options => {
    body = JSON.parse(options.data);
    queueMicrotask(() => options.onload({ status: 200, responseText: envelope('动词：推迟。') }));
    return { abort() {} };
  });
  assert.equal(await translate('postponed', config), '动词：推迟。');
  assert.deepEqual(JSON.parse(body.messages[1].content), { word: 'postponed' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  await assert.rejects(translate('two words', config), /一个英文单词/);
});

test('only a double-click selection of a single English word outside editable fields is eligible', () => {
  const dom = new JSDOM('<p>postponed</p><div contenteditable="true">private</div>');
  const doc = dom.window.document;
  const select = element => {
    const range = doc.createRange(); range.selectNodeContents(element);
    doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range);
  };
  const p = doc.querySelector('p'); select(p);
  assert.equal(selectedEnglishWord(doc, p), 'postponed');
  p.textContent = 'two words'; select(p);
  assert.equal(selectedEnglishWord(doc, p), null);
  p.textContent = '日文'; select(p);
  assert.equal(selectedEnglishWord(doc, p), null);
  const editable = doc.querySelector('div'); select(editable);
  assert.equal(selectedEnglishWord(doc, editable), null);
  dom.window.close();
});

function setup(translate) {
  const dom = new JSDOM('<p>English stays here.</p>', { url: 'https://app.abceed.com/' });
  const doc = dom.window.document;
  const host = doc.createElement('div'); doc.body.append(host);
  const root = host.attachShadow({ mode: 'closed' });
  const cache = new TranslationCache();
  const words = new WordLookup({ doc, win: dom.window, root, getConfig: () => config, translate, cache });
  return { dom, doc, root, words, cache };
}

test('lookup caches meanings, keeps page English intact, and clear removes cached words', async () => {
  let calls = 0;
  const { dom, doc, words } = setup(async () => { calls++; return '<b>释义</b>'; });
  await words.lookup('word', 100, 100);
  assert.equal(words.meaning.textContent, '<b>释义</b>');
  assert.equal(words.meaning.children.length, 0);
  await words.lookup('word', 100, 100);
  assert.equal(calls, 1);
  assert.equal(doc.querySelector('p').textContent, 'English stays here.');
  words.clearCache();
  await words.lookup('word', 100, 100);
  assert.equal(calls, 2);
  words.destroy(); dom.window.close();
});

test('new word and closing cancel older requests without stale results or cache writes', async () => {
  const pending = [];
  const { dom, words, cache } = setup((word, config, signal) => new Promise(resolve => pending.push({ word, resolve, signal })));
  const first = words.lookup('first', 10, 10);
  const second = words.lookup('second', 10, 10);
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve('第二'); await second;
  pending[0].resolve('第一'); await first;
  assert.equal(words.meaning.textContent, '第二');
  assert.equal(cache.get('first'), undefined);
  const third = words.lookup('third', 10, 10);
  words.clearCache();
  assert.equal(pending[2].signal.aborted, true);
  pending[2].resolve('第三'); await third;
  assert.equal(cache.get('third'), undefined);
  assert.equal(words.popup.hidden, true);
  words.destroy(); dom.window.close();
});
