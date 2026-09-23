import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { selectedEnglishWord, createWordTranslator, WordLookup, formatWordMeaning, selectedEnglishText, createSelectionTranslator, selectionPopupPosition, selectedWordContext } from '../src/words.js';
import { TranslationCache, translationScope, wordCacheKey } from '../src/cache.js';

const config = { endpoint: 'https://api.deepseek.com/chat/completions', model: 'test', key: 'test-only' };
const envelope = meaning => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ meaning }) } }] });

test('word requests use AI dictionary instructions and disable DeepSeek thinking', async () => {
  let body;
  const translate = createWordTranslator(options => {
    body = JSON.parse(options.data);
    queueMicrotask(() => options.onload({ status: 200, responseText: envelope('动词：推迟。') }));
    return { abort() {} };
  });
  assert.equal(await translate('postponed', config), 'v. 推迟。');
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


test('formats cached Chinese part-of-speech labels without changing definitions', async () => {
  assert.equal(formatWordMeaning('名词：动作；动词：行动\n形容词: 活跃的；不及物动词：移动'), 'n. 动作；v. 行动\nadj. 活跃的；vi. 移动');
  assert.equal(formatWordMeaning('n. 表示动词的名词'), 'n. 表示动词的名词');
  let calls = 0;
  const { dom, words, cache } = setup(async () => { calls++; return ''; });
  cache.load(translationScope(config, 'word'));
  cache.set('word', '名词：词；动词：措辞');
  await words.lookup('word', 100, 100);
  assert.deepEqual([...words.meaning.querySelectorAll('.meaning-row')].map(row => row.textContent), ['n. 词', 'v. 措辞']);
  assert.equal(calls, 0);
  words.destroy(); dom.window.close();
});


test('phrase selection supports nested text and rejects editable or oversized content', () => {
  const dom = new JSDOM('<p>The <b>meeting</b> was postponed.</p><div contenteditable>private message</div>');
  const doc = dom.window.document;
  const select = element => {
    const range = doc.createRange(); range.selectNodeContents(element);
    doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range);
  };
  const p = doc.querySelector('p'); select(p);
  assert.equal(selectedEnglishText(doc, p.querySelector('b')), 'The meeting was postponed.');
  const editable = doc.querySelector('div'); select(editable);
  assert.equal(selectedEnglishText(doc, editable), null);
  p.textContent = 'a'.repeat(3001); select(p);
  assert.equal(selectedEnglishText(doc, p), null);
  dom.window.close();
});

test('selection API translates phrases without dictionary or Japanese-only protection', async () => {
  let body;
  const translate = createSelectionTranslator(options => {
    body = JSON.parse(options.data);
    queueMicrotask(() => options.onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"translation":"会议已推迟。"}' } }] }) }));
    return { abort() {} };
  });
  assert.equal(await translate('The meeting was postponed.', config), '会议已推迟。');
  assert.deepEqual(JSON.parse(body.messages[1].content), { text: 'The meeting was postponed.' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
});

test('selection translates automatically and caches separately from word definitions', async () => {
  const { dom, words, cache } = setup(async () => 'n. 会议');
  let calls = 0;
  words.translateSelection = async () => { calls++; return '会议'; };
  await words.lookup('meeting', 10, 10);
  await words.lookup('meeting', 10, 10, 'selection');
  assert.equal(calls, 1);
  assert.equal(words.meaning.textContent, '会议');
  assert.equal(cache.get('meeting'), 'n. 会议');
  assert.equal(cache.get('selection:meeting'), '会议');
  await words.lookup('meeting', 10, 10, 'selection');
  assert.equal(calls, 1);
  words.clearCache();
  assert.equal(cache.get('selection:meeting'), undefined);
  words.destroy(); dom.window.close();
});


test('popup remains outside multiline selection and constrains height near viewport edges', () => {
  const anchor = { left: 200, top: 200, bottom: 320 };
  const below = selectionPopupPosition(anchor, 280, 120, 1000, 700);
  assert.ok(below.top >= anchor.bottom + 10);
  const above = selectionPopupPosition({ left: 900, top: 500, bottom: 650 }, 280, 160, 1000, 700);
  assert.ok(above.top + 160 <= 490);
  assert.equal(above.left, 708);
  const constrained = selectionPopupPosition({ left: 200, top: 150, bottom: 550 }, 280, 220, 1000, 700);
  assert.equal(constrained.maxHeight, 128);
  assert.ok(constrained.top >= 560);
});

test('drag mouseup translates selected phrase without click and ignores double-click mouseup', async () => {
  const { dom, doc, words } = setup(async () => 'n. 测试');
  const p = doc.querySelector('p');
  const range = doc.createRange(); range.selectNodeContents(p);
  dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 100, top: 100, bottom: 120 });
  doc.getSelection().addRange(range);
  let calls = 0;
  words.translateSelection = async text => { calls++; assert.equal(text, 'English stays here.'); return '英文保留在这里。'; };
  p.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, button: 0, detail: 1 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.equal(words.meaning.textContent, '英文保留在这里。');
  p.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, button: 0, detail: 2 }));
  assert.equal(calls, 1);
  words.destroy(); dom.window.close();
});


test('double-click expands hyphenated words and contractions from either half', () => {
  const dom = new JSDOM('<p></p>');
  const doc = dom.window.document, p = doc.querySelector('p');
  for (const word of ['hands-on', 'hands‐on', 'hands‑on', "don't", 'state-of-the-art']) {
    p.textContent = `acquire ${word} experience`;
    for (const offset of [8, 8 + word.length - 1]) {
      const range = doc.createRange(); range.setStart(p.firstChild, offset); range.setEnd(p.firstChild, offset + 1);
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range);
      assert.equal(selectedEnglishWord(doc, p), word);
      assert.equal(doc.getSelection().toString(), word);
    }
  }
  dom.window.close();
});

test('dragging a single word or hyphenated compound uses dictionary lookup', async () => {
  const seen = [];
  const { dom, doc, words } = setup(async word => { seen.push(word); return 'adj. 实践的'; });
  words.translateSelection = async () => { throw new Error('dictionary expected'); };
  dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 100, top: 100, bottom: 120 });
  const p = doc.querySelector('p');
  for (const word of ['hands-on', 'experience']) {
    p.textContent = word;
    const range = doc.createRange(); range.selectNodeContents(p);
    doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range);
    p.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, button: 0, detail: 1 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(words.title.textContent, word);
    assert.equal(words.meaning.textContent, 'adj. 实践的');
  }
  assert.deepEqual(seen, ['hands-on', 'experience']);
  words.destroy(); dom.window.close();
});


test('SPA navigation closes completed and cached lookup popups', async () => {
  const { dom, words } = setup(async () => 'n. 词');
  await words.lookup('word', 10, 10);
  dom.window.history.pushState({}, '', '/results');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(words.popup.hidden, true);
  await words.lookup('word', 10, 10);
  assert.equal(words.popup.hidden, false);
  dom.window.history.replaceState({}, '', '/next');
  words.checkPage();
  assert.equal(words.popup.hidden, true);
  words.destroy(); dom.window.close();
});

test('navigation aborts pending lookup and ignores late results', async () => {
  let resolve, signal;
  const { dom, words, cache } = setup((word, config, s) => { signal = s; return new Promise(r => resolve = r); });
  const pending = words.lookup('word', 10, 10);
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  assert.equal(signal.aborted, true);
  resolve('n. 词'); await pending;
  assert.equal(words.popup.hidden, true);
  assert.equal(cache.get('word'), undefined);
  words.destroy(); dom.window.close();
});

test('replacing selected question content closes popup even without URL change', async () => {
  const { dom, doc, words } = setup(async () => 'n. 词');
  const p = doc.querySelector('p'); p.textContent = 'word';
  const range = doc.createRange(); range.selectNodeContents(p.firstChild);
  doc.getSelection().addRange(range);
  await words.lookup('word', 10, 10);
  p.textContent = 'next question';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(words.popup.hidden, true);
  words.destroy(); dom.window.close();
});


test('dictionary typography separates parts of speech and sentence translations stay plain', () => {
  const { dom, words } = setup(async () => '');
  words.renderMeaning('n. 实践；经验；v. 练习', 'word');
  assert.deepEqual([...words.meaning.querySelectorAll('.meaning-pos')].map(node => node.textContent), ['n.', 'v.']);
  assert.deepEqual([...words.meaning.querySelectorAll('.meaning-row')].map(node => node.textContent), ['n. 实践；经验', 'v. 练习']);
  words.renderMeaning('<img src=x>；n. 原句', 'selection');
  assert.equal(words.meaning.children.length, 0);
  assert.equal(words.meaning.textContent, '<img src=x>；n. 原句');
  words.destroy(); dom.window.close();
});


test('word context is limited to nearby prose and forwarded to the model', async () => {
  const dom = new JSDOM('<p id="context">We need to <b>charge</b> the battery.</p><p>Unrelated private content.</p>');
  try {
    const doc = dom.window.document, word = doc.querySelector('b');
    const range = doc.createRange(); range.selectNodeContents(word);
    doc.getSelection().addRange(range);
    const context = selectedWordContext(doc);
    assert.equal(context, 'We need to charge the battery.');
    let entry;
    const translate = createWordTranslator(options => {
      entry = JSON.parse(JSON.parse(options.data).messages[1].content);
      queueMicrotask(() => options.onload({ status: 200, responseText: envelope('v. 充电') }));
      return { abort() {} };
    });
    await translate('charge', config, undefined, context);
    assert.deepEqual(entry, { word: 'charge', context });
    doc.querySelector('#context').append(doc.createElement('input'));
    assert.equal(selectedWordContext(doc), '');
  } finally { dom.window.close(); }
});

test('tight embedded viewports use side space and full-screen selections remain readable', () => {
  const side = selectionPopupPosition({ left: 100, right: 300, top: 15, bottom: 180 }, 280, 160, 800, 210);
  assert.equal(side.left, 310);
  assert.equal(side.maxWidth, 280);
  const full = selectionPopupPosition({ left: 0, right: 340, top: 0, bottom: 180 }, 280, 160, 340, 180);
  assert.ok(full.top >= 0 && full.top + full.maxHeight <= 180);
});

function speechSetup() {
  const fixture = setup(async () => '中文释义');
  const spoken = [];
  let cancellations = 0;
  const local = { lang: 'en-US', localService: true };
  fixture.dom.window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  fixture.dom.window.speechSynthesis = {
    getVoices: () => [{ lang: 'zh-CN', localService: true }, { lang: 'en-US', localService: false }, local],
    speak: utterance => spoken.push(utterance),
    cancel: () => cancellations++
  };
  return { ...fixture, spoken, local, cancellations: () => cancellations };
}

test('pronunciation is opt-in, reads original compound words and sentences, and toggles stop', async () => {
  const { dom, words, spoken, local, cancellations } = speechSetup();
  words.translateSelection = async () => '这是句子。';
  await words.lookup('hands-on', 10, 10);
  assert.equal(spoken.length, 0);
  words.speakButton.click();
  assert.equal(spoken[0].text, 'hands-on');
  assert.equal(spoken[0].voice, local);
  assert.equal(spoken[0].lang, 'en-US');
  assert.equal(spoken[0].rate, 1);
  assert.equal(words.speakButton.getAttribute('aria-label'), '停止发音');
  words.speakButton.click();
  assert.equal(cancellations(), 1);
  assert.equal(words.speakButton.getAttribute('aria-pressed'), 'false');
  await words.lookup('We need hands-on experience.', 10, 10, 'selection');
  words.speakButton.click();
  assert.equal(spoken[1].text, 'We need hands-on experience.');
  spoken[1].onend();
  assert.equal(words.speakButton.getAttribute('aria-pressed'), 'false');
  words.destroy(); dom.window.close();
});

test('closing, replacing a selection and navigation cancel speech and ignore stale callbacks', async () => {
  const { dom, words, spoken, cancellations } = speechSetup();
  await words.lookup('first', 10, 10);
  words.speakButton.click();
  const oldEnd = spoken[0].onend;
  await words.lookup('second', 10, 10);
  assert.equal(cancellations(), 1);
  words.speakButton.click();
  oldEnd();
  assert.equal(words.speakButton.getAttribute('aria-pressed'), 'true');
  dom.window.dispatchEvent(new dom.window.Event('popstate'));
  assert.equal(cancellations(), 2);
  assert.equal(words.popup.hidden, true);
  await words.lookup('third', 10, 10);
  words.speakButton.click();
  words.hide();
  assert.equal(cancellations(), 3);
  words.destroy(); dom.window.close();
});

test('speech errors preserve meaning and allow retry; unsupported browsers hide the button', async () => {
  const { dom, words, spoken } = speechSetup();
  await words.lookup('test', 10, 10);
  words.speakButton.click();
  spoken[0].onerror({ error: 'synthesis-failed' });
  assert.equal(words.speechError.hidden, false);
  assert.equal(words.meaning.textContent, '中文释义');
  assert.equal(words.speakButton.getAttribute('aria-pressed'), 'false');
  words.speakButton.click();
  assert.equal(spoken.length, 2);
  assert.equal(words.speechError.hidden, true);
  words.hide();
  delete dom.window.speechSynthesis;
  await words.lookup('test', 10, 10);
  assert.equal(words.speakButton.hidden, true);
  words.destroy(); dom.window.close();
});

test('multi-paragraph selection survives unrelated explanation translation and stopped mouseup bubbling', async () => {
  const { dom, doc, words } = setup(async () => '');
  const p = doc.querySelector('p');
  p.innerHTML = '<span>Trent was surprised -------.</span><br><b>(A) convinced (24%)</b><aside>日本語</aside>';
  dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 100, top: 100, bottom: 200 });
  const range = doc.createRange(); range.setStart(p.firstChild.firstChild, 0); range.setEnd(p.querySelector('b').firstChild, 19);
  doc.getSelection().addRange(range);
  words.translateSelection = async () => '译文';
  p.addEventListener('mouseup', event => event.stopPropagation());
  p.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(words.popup.hidden, false);
  p.querySelector('aside').textContent = '中文';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(words.popup.hidden, false);
  p.querySelector('b').textContent = 'next question';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(words.popup.hidden, true);
  words.destroy(); dom.window.close();
});

test('blank click dismisses once even when selection remains; a new drag can select the same text again', async () => {
  const { dom, doc, words } = setup(async () => '');
  const p = doc.querySelector('p');
  dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 100, top: 100, bottom: 120 });
  const range = doc.createRange(); range.selectNodeContents(p);
  doc.getSelection().addRange(range);
  words.translateSelection = async () => '译文';
  await words.lookup(p.textContent, 100, 100, 'selection');
  doc.body.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 500 }));
  doc.body.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 500, clientY: 500 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(words.popup.hidden, true);
  p.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
  p.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 220, clientY: 100 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(words.popup.hidden, false);
  words.destroy(); dom.window.close();
});

test('refresh bypasses one contextual cache entry, preserves it on failure and remembers context after selection clears', async () => {
  let calls = 0, fail = false;
  const { dom, doc, words, cache } = setup(async (text, config, signal, context) => {
    calls++; assert.equal(context, 'English stays here.');
    if (fail) throw new Error('网络错误');
    return `n. 译文${calls}`;
  });
  try {
    const range = doc.createRange(); range.setStart(doc.querySelector('p').firstChild, 0); range.setEnd(doc.querySelector('p').firstChild, 7);
    doc.getSelection().addRange(range);
    await words.lookup('English', 100, 100);
    cache.set('unrelated', '其他缓存');
    doc.getSelection().removeAllRanges();
    words.refreshButton.click();
    words.refreshButton.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls, 2);
    const key = wordCacheKey('English', 'English stays here.');
    assert.equal(cache.get(key), 'n. 译文2');
    assert.equal(cache.get('unrelated'), '其他缓存');
    fail = true;
    words.refreshButton.click(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(words.meaning.textContent, 'n. 译文2');
    assert.match(words.refreshError.textContent, /保留原译文.*网络错误/);
    assert.equal(cache.get(key), 'n. 译文2');
    assert.equal(words.refreshButton.disabled, false);
  } finally { words.destroy(); dom.window.close(); }
});

test('selection refresh replaces cached result and closing during refresh discards the response', async () => {
  const { dom, words, cache } = setup(async () => '');
  let finish;
  words.translateSelection = async () => '旧译文';
  try {
    await words.lookup('a phrase', 100, 100, 'selection');
    words.translateSelection = () => new Promise(resolve => { finish = resolve; });
    words.refreshButton.click();
    words.hide(); finish('关闭后的译文');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(words.popup.hidden, true);
    assert.equal(cache.get('selection:a phrase'), '旧译文');
    await words.lookup('a phrase', 100, 100, 'selection');
    words.refreshButton.click(); finish('新译文');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(words.meaning.textContent, '新译文');
    assert.equal(cache.get('selection:a phrase'), '新译文');
  } finally { words.destroy(); dom.window.close(); }
});
