import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { attachFrameBridge, createFrameRequester, attachAutoFrameBridge, attachContentAutoTranslation } from '../src/frames.js';
import { TranslationCache } from '../src/cache.js';

const channel = 'abceed-ai-lookup-v1';
const origin = 'https://private.abceed.com';
const config = { endpoint: 'https://provider.example', model: 'test', key: 'secret-test-only' };
const wait = () => new Promise(resolve => setTimeout(resolve, 0));

test('only attached trusted frames can translate; responses omit keys and reuse parent cache', async () => {
  const dom = new JSDOM('<iframe></iframe>', { url: 'https://app.abceed.com' });
  const win = dom.window, doc = win.document, source = doc.querySelector('iframe').contentWindow;
  const replies = [];
  source.postMessage = (data, target) => replies.push({ data, target });
  let calls = 0;
  const bridge = attachFrameBridge({ win, doc, getConfig: () => config, cache: new TranslationCache(),
    translate: async text => { calls++; assert.equal(text, 'meeting'); return 'n. 会议'; },
    translateSelection: async () => '会议推迟了。' });
  const send = (patch = {}, eventPatch = {}) => win.dispatchEvent(new win.MessageEvent('message', { origin, source,
    data: { channel, id: '1', type: 'request', mode: 'word', text: 'meeting', ...patch }, ...eventPatch }));
  send({}, { origin: 'https://evil.example' });
  send({}, { source: win });
  send({ text: 'a'.repeat(61) });
  await wait(); assert.equal(calls, 0);
  send(); await wait(); send({ id: '2' }); await wait();
  assert.equal(calls, 1);
  assert.equal(replies.length, 2);
  assert.equal(replies[0].data.result, 'n. 会议');
  assert.equal(replies[0].target, origin);
  assert.ok(!JSON.stringify(replies).includes(config.key));
  send({ id: '3', mode: 'selection', text: 'The meeting was postponed.' }); await wait();
  assert.equal(replies[2].data.result, '会议推迟了。');
  bridge.destroy(); dom.window.close();
});

test('cancel prevents late frame requests from caching or replying', async () => {
  const dom = new JSDOM('<iframe></iframe>', { url: 'https://app.abceed.com' });
  const win = dom.window, doc = win.document, source = doc.querySelector('iframe').contentWindow;
  let resolve, signal, replies = 0;
  source.postMessage = () => replies++;
  const cache = new TranslationCache();
  const bridge = attachFrameBridge({ win, doc, cache, getConfig: () => config,
    translate: (text, config, abortSignal) => { signal = abortSignal; return new Promise(r => resolve = r); } });
  const send = type => win.dispatchEvent(new win.MessageEvent('message', { origin, source, data: { channel, id: 'one', type, mode: 'word', text: 'word' } }));
  send('request'); send('cancel');
  assert.equal(signal.aborted, true);
  resolve('n. 词'); await wait();
  assert.equal(replies, 0); assert.equal(cache.get('word'), undefined);
  bridge.destroy(); dom.window.close();
});

test('frame requester checks response source and origin and sends no provider settings', async () => {
  const dom = new JSDOM('', { url: 'https://private.abceed.com/contents/test.html' });
  const win = dom.window;
  let sent;
  win.parent.postMessage = (data, target) => { sent = { data, target }; };
  const request = createFrameRequester(win);
  const pending = request('word', 'meeting', config);
  assert.equal(sent.target, 'https://app.abceed.com');
  assert.ok(!JSON.stringify(sent).includes(config.key));
  const response = { channel, type: 'response', id: sent.data.id, result: 'n. 会议' };
  win.dispatchEvent(new win.MessageEvent('message', { source: win, origin: 'https://evil.example', data: { ...response, result: 'wrong' } }));
  win.dispatchEvent(new win.MessageEvent('message', { source: win.parent, origin: 'https://app.abceed.com', data: response }));
  assert.equal(await pending, 'n. 会议');
  dom.window.close();
});


test('iframe automatic batches share parent cache, budget, and pause controls', async () => {
  const dom = new JSDOM('<iframe></iframe>', { url: 'https://app.abceed.com' });
  const win = dom.window, doc = win.document, source = doc.querySelector('iframe').contentWindow;
  const replies = [];
  source.postMessage = data => replies.push(data);
  let calls = 0;
  const engine = { active: true, generation: 1, config, used: 0, budget: 50000, cache: new TranslationCache(),
    translate: async texts => { calls++; assert.deepEqual(texts, ['解説']); return ['解析']; } };
  engine.cache.load('test');
  const bridge = attachAutoFrameBridge({ win, doc, engine });
  const send = (mode, text) => win.dispatchEvent(new win.MessageEvent('message', { origin, source, data: { channel, id: String(replies.length), type: 'request', mode, text } }));
  send('state', ''); await wait();
  assert.deepEqual(replies[0].result, { enabled: true, revision: 1, scope: 'test' });
  send('auto', ['解説']); await wait();
  send('auto', ['解説']); await wait();
  assert.equal(calls, 1); assert.equal(engine.used, 2);
  assert.deepEqual(replies[2].result, ['解析']);
  engine.active = false; engine.generation++;
  send('auto', ['新しい説明']); await wait();
  assert.match(replies[3].error, /暂停/);
  assert.equal(calls, 1);
  bridge.destroy(); dom.window.close();
});

test('embedded Japanese translates in place while English stays intact and parent pause is followed', async () => {
  const dom = new JSDOM('<p id="jp">解説</p><p id="en">Please read the memo.</p>', { url: 'https://private.abceed.com/contents/test.html', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  win.Range.prototype.getClientRects = () => [{ width: 80, height: 20, left: 0, right: 80, top: 0, bottom: 20 }];
  let enabled = true, revision = 1, calls = 0;
  const automatic = attachContentAutoTranslation(doc, win, async (mode, texts) => {
    if (mode === 'state') return { enabled, revision, scope: 'test' };
    calls++; assert.deepEqual(texts, ['解説']); return ['解析'];
  });
  await wait();
  automatic.engine.schedule = () => {};
  await automatic.engine.tick();
  assert.equal(doc.querySelector('#jp').textContent, '解析');
  assert.equal(doc.querySelector('#en').textContent, 'Please read the memo.');
  assert.equal(calls, 1);
  enabled = false; await automatic.sync();
  assert.equal(automatic.engine.active, false);
  enabled = true; revision++; await automatic.sync();
  assert.equal(automatic.engine.active, true);
  automatic.destroy(); dom.window.close();
});

test('frame word lookup forwards context and separates cached meanings by sentence', async () => {
  const dom = new JSDOM('<iframe></iframe>', { url: 'https://app.abceed.com' });
  const win = dom.window, doc = win.document, source = doc.querySelector('iframe').contentWindow;
  const contexts = [], replies = [];
  source.postMessage = data => replies.push(data);
  const bridge = attachFrameBridge({ win, doc, getConfig: () => config, cache: new TranslationCache(),
    translate: async (word, config, signal, context) => { contexts.push(context); return context.includes('battery') ? 'v. 充电' : 'v. 收费'; } });
  try {
    const send = context => win.dispatchEvent(new win.MessageEvent('message', { origin, source, data: { channel, id: String(replies.length), type: 'request', mode: 'word', text: 'charge', context } }));
    send('charge the battery'); await wait();
    send('charge a fee'); await wait();
    send('charge the battery'); await wait();
    assert.deepEqual(contexts, ['charge the battery', 'charge a fee']);
    assert.deepEqual(replies.map(reply => reply.result), ['v. 充电', 'v. 收费', 'v. 充电']);
  } finally { bridge.destroy(); dom.window.close(); }
});

test('partial iframe failures preserve valid cache entries and are returned as retryable nulls', async () => {
  const dom = new JSDOM('<iframe></iframe>', { url: 'https://app.abceed.com' });
  const win = dom.window, doc = win.document, source = doc.querySelector('iframe').contentWindow;
  const replies = []; source.postMessage = data => replies.push(data);
  const engine = { active: true, generation: 1, config, used: 0, budget: 50000, failed: new Set(), cache: new TranslationCache(), translate: async () => ['解析', null] };
  const bridge = attachAutoFrameBridge({ win, doc, engine });
  try {
    win.dispatchEvent(new win.MessageEvent('message', { origin, source, data: { channel, id: 'partial', type: 'request', mode: 'auto', text: ['解説', '問題'] } }));
    await wait();
    assert.deepEqual(replies[0].result, ['解析', null]);
    assert.equal(engine.cache.get('解説'), '解析');
    assert.equal(engine.cache.get('問題'), undefined);
    assert.ok(engine.failed.has('問題'));
  } finally { bridge.destroy(); dom.window.close(); }
});
