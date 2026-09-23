import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createImageTranslator, readImageData, validImageData, MAX_IMAGE_DATA } from '../src/images.js';
import { TranslationCache } from '../src/cache.js';
import { WordLookup } from '../src/words.js';

const config = { endpoint: 'https://provider.example/chat/completions', model: 'vision', key: 'test-secret' };
const data = 'data:image/png;base64,aGVsbG8=';
const envelope = result => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] });
const wait = () => new Promise(resolve => setTimeout(resolve, 0));
function mockRequest(reply) {
  return options => {
    queueMicrotask(() => options.onload(reply(options)));
    return { abort() {} };
  };
}

test('image OCR uses multimodal input, preserves English during translation and persists both stages by content', async () => {
  const calls = []; let snapshot;
  const request = mockRequest(options => {
    assert.equal(options.url, config.endpoint);
    assert.equal(options.anonymous, true);
    const body = JSON.parse(options.data); calls.push(body);
    if (Array.isArray(body.messages[1].content)) {
      assert.deepEqual(body.messages[1].content[1], { type: 'image_url', image_url: { url: data } });
      return { status: 200, responseText: envelope({ status: 'ok', text: '説明：Read the memo.\n答え' }) };
    }
    const { entries } = JSON.parse(body.messages[1].content);
    return { status: 200, responseText: envelope({ translations: entries.map(({ id, text }) => ({ id, text: text.replace('説明', '说明').replace('答え', '答案') })) }) };
  });
  const cacheOptions = { read: () => snapshot, write: value => { snapshot = value; } };
  const translate = createImageTranslator(request, new TranslationCache(cacheOptions));
  const first = await translate(data, config);
  assert.equal(first, '说明：Read the memo.\n答案');
  assert.equal(await createImageTranslator(request, new TranslationCache(cacheOptions))(data, config), first);
  assert.equal(calls.length, 2);
  assert.equal(snapshot.entries.length, 2);
  assert.ok(!JSON.stringify(snapshot).includes(data));
  assert.ok(!JSON.stringify(snapshot).includes(config.key));
  await translate(data, { ...config, model: 'another-vision' });
  assert.equal(calls.length, 4);
});

test('unsupported image inputs show useful hints without leaking server response; auth and rate errors remain distinct', async () => {
  for (const [status, responseText, expected] of [
    [400, 'image_url is not supported test-secret', /不支持图片识别/],
    [422, 'unknown image content type', /不支持图片识别/],
    [400, 'invalid image size', /请求失败.*支持图片输入/],
    [401, 'test-secret', /Key/],
    [429, 'test-secret', /限流/],
    [200, envelope({ status: 'unsupported', text: '' }), /不支持图片识别/],
    [200, 'broken', /确认当前模型支持图片输入/]
  ]) {
    const translate = createImageTranslator(mockRequest(() => ({ status, responseText })), new TranslationCache());
    await assert.rejects(translate(data, config), error => expected.test(error.message) && !error.message.includes(config.key));
  }
});

test('OCR is reused after a translation failure; invalid and oversized image data never reaches provider', async () => {
  let reads = 0, translations = 0;
  const translate = createImageTranslator(mockRequest(options => {
    const body = JSON.parse(options.data);
    if (Array.isArray(body.messages[1].content)) { reads++; return { status: 200, responseText: envelope({ status: 'ok', text: '解説' }) }; }
    translations++;
    return translations === 1 ? { status: 429, responseText: '' } : { status: 200, responseText: envelope({ translations: [{ id: '0', text: '解析' }] }) };
  }), new TranslationCache());
  await assert.rejects(translate(data, config), /限流/);
  assert.equal(await translate(data, config), '解析');
  assert.equal(reads, 1);
  for (const invalid of ['https://example.com/image.png', 'data:image/svg+xml;base64,YQ==', 'data:image/png;base64,' + 'a'.repeat(MAX_IMAGE_DATA)]) {
    assert.equal(validImageData(invalid), false);
    await assert.rejects(translate(invalid, config), /图片数据/);
  }
  assert.equal(reads, 1);
});

test('no readable text and English-only images do not trigger text translation', async () => {
  for (const result of [{ status: 'no_text', text: '' }, { status: 'ok', text: 'Read the memo.' }]) {
    let calls = 0;
    const translate = createImageTranslator(mockRequest(() => { calls++; return { status: 200, responseText: envelope(result) }; }), new TranslationCache());
    if (!result.text) await assert.rejects(translate(data, config), /没有识别到/);
    else assert.match(await translate(data, config), /未识别到需要翻译的日文/);
    assert.equal(calls, 1);
  }
});

test('canceling image recognition aborts transport and ignores late results without caching', async () => {
  let options, aborted = false;
  const cache = new TranslationCache(), controller = new AbortController();
  const translate = createImageTranslator(value => { options = value; return { abort() { aborted = true; } }; }, cache);
  const pending = translate(data, config, controller.signal);
  while (!options) await wait();
  controller.abort();
  await assert.rejects(pending, /暂停/);
  options.onload({ status: 200, responseText: envelope({ status: 'ok', text: '解説' }) });
  assert.equal(aborted, true);
  assert.equal(cache.items.size, 0);
});

function imageFixture() {
  const dom = new JSDOM('<img src="https://private.abceed.com/picture.png">', { url: 'https://app.abceed.com' });
  const doc = dom.window.document, image = doc.querySelector('img');
  Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 600 }, naturalHeight: { value: 400 } });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  dom.window.HTMLCanvasElement.prototype.toDataURL = () => data;
  return { dom, doc, image };
}

test('reads displayed image pixels; cross-origin fallback downloads only the image and no API credentials', async () => {
  const { dom, image } = imageFixture();
  try {
    assert.equal(await readImageData(image, () => { throw new Error('unexpected download'); }), data);
    dom.window.HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('tainted canvas'); };
    let options;
    const result = await readImageData(image, value => {
      options = value;
      queueMicrotask(() => value.onload({ status: 200, response: new dom.window.Blob(['hello'], { type: 'image/png' }) }));
      return { abort() {} };
    });
    assert.equal(result, data);
    assert.equal(options.method, 'GET');
    assert.equal(options.url, image.src);
    assert.equal(options.headers, undefined);
    assert.equal(options.data, undefined);
  } finally { dom.window.close(); }
});

test('double-click image shares popup, retries failures and closes on image replacement without late reopening', async () => {
  const { dom, doc, image } = imageFixture();
  const host = doc.createElement('div'); doc.body.append(host);
  const root = host.attachShadow({ mode: 'closed' });
  let calls = 0, resolve;
  const words = new WordLookup({ doc, win: dom.window, root, getConfig: () => config, cache: new TranslationCache(),
    readImage: async () => data, translateImage: async () => {
      if (++calls === 1) throw new Error('当前模型不支持图片识别');
      if (calls === 3) return new Promise(r => { resolve = r; });
      return '<b>图片译文</b>';
    } });
  try {
    image.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
    await wait();
    assert.equal(words.title.textContent, '图片翻译');
    assert.match(words.meaning.textContent, /不支持图片识别/);
    assert.equal(words.refreshButton.disabled, false);
    assert.equal(words.speakButton.hidden, true);
    words.refreshButton.click(); await wait();
    assert.equal(words.meaning.textContent, '<b>图片译文</b>');
    assert.equal(words.meaning.children.length, 0);
    assert.equal(words.refreshButton.disabled, false);
    assert.equal(image.src, 'https://private.abceed.com/picture.png');
    image.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true })); await wait();
    image.src = 'https://private.abceed.com/next.png'; words.checkPage();
    resolve('旧译文'); await wait();
    assert.equal(words.popup.hidden, true);
  } finally { words.destroy(); dom.window.close(); }
});

test('closing the popup while reading an image prevents sending it to the AI service', async () => {
  const { dom, doc, image } = imageFixture();
  const host = doc.createElement('div'); doc.body.append(host);
  let finishRead, signal, calls = 0;
  const words = new WordLookup({ doc, win: dom.window, root: host.attachShadow({ mode: 'closed' }),
    getConfig: () => config, cache: new TranslationCache(),
    readImage: (image, s) => { signal = s; return new Promise(resolve => { finishRead = resolve; }); },
    translateImage: async () => { calls++; return '译文'; }
  });
  try {
    const pending = words.lookup(image, 100, 100, 'image', image.getBoundingClientRect());
    doc.body.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    assert.equal(signal.aborted, true);
    finishRead(data); await pending;
    assert.equal(calls, 0);
    assert.equal(words.popup.hidden, true);
  } finally { words.destroy(); dom.window.close(); }
});

test('image refresh reruns OCR and translation but only replaces old cache after success', async () => {
  let reads = 0, translations = 0, fail = false;
  const cache = new TranslationCache();
  const translate = createImageTranslator(mockRequest(options => {
    const body = JSON.parse(options.data);
    if (Array.isArray(body.messages[1].content)) {
      reads++; return { status: 200, responseText: envelope({ status: 'ok', text: reads === 1 ? '説明' : '解説' }) };
    }
    translations++;
    return fail ? { status: 429, responseText: '' } : { status: 200, responseText: envelope({ translations: [{ id: '0', text: translations === 1 ? '说明' : '解析' }] }) };
  }), cache);
  assert.equal(await translate(data, config), '说明');
  fail = true;
  await assert.rejects(translate(data, config, undefined, { force: true }), /限流/);
  assert.equal(await translate(data, config), '说明');
  assert.ok([...cache.items.values()].some(entry => entry.text === '説明'));
  fail = false;
  assert.equal(await translate(data, config, undefined, { force: true }), '解析');
  assert.equal(await translate(data, config), '解析');
  assert.equal(reads, 3); assert.equal(translations, 3);
});
