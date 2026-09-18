import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, hasJapanese, protectEnglish, restoreEnglish, makeRequest, parseResponse, createTranslator } from '../src/core.js';

const envelope = translations => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations }) } }] });
test('only CJK text is a candidate; English exercises stay out of the queue', () => {
  for (const value of ['The meeting starts at 9:00.', 'TOEIC® L&R', 'What does the man suggest?', '(A) A bicycle.']) assert.equal(hasJapanese(value), false);
  for (const value of ['解説', 'ホーム', '答えを確認する']) assert.equal(hasJapanese(value), true);
});
test('accepts full endpoint or base URL and rejects unsafe credential destinations', () => {
  assert.equal(normalizeConfig({ endpoint: 'https://provider.example/v1/', model: 'test', key: 'test-key' }).endpoint, 'https://provider.example/v1/chat/completions');
  assert.equal(normalizeConfig({ endpoint: 'https://provider.example/api/v1/chat/completions', model: 'test', key: 'test-key' }).endpoint, 'https://provider.example/api/v1/chat/completions');
  for (const endpoint of ['http://provider.example/v1', 'https://user:pass@provider.example', 'https://provider.example?key=abc', 'https://provider.example/#x', 'not a url']) {
    assert.throws(() => normalizeConfig({ endpoint, model: 'test', key: 'test-key' }));
  }
});
test('protects English phrases, punctuation, spelling and numbers byte-for-byte', () => {
  const source = '「Please submit the report by Friday.」は依頼です。期限は9:00です。';
  const protectedText = protectEnglish(source);
  assert.deepEqual(protectedText.values.map(x => x.value), ['Please submit the report by Friday.', '9:00']);
  const translated = protectedText.masked.replace('は依頼です。期限は', '是请求。截止时间为').replace('です。', '。');
  assert.equal(restoreEnglish(translated, protectedText), '「Please submit the report by Friday.」是请求。截止时间为9:00。');
});
test('source cannot collide with English placeholder namespace', () => {
  const part = protectEnglish('ABCEED_KEEP_0 は文字です。');
  assert.match(part.values[0].token, /KEEP_X/);
});
test('response IDs can be reordered but missing, duplicate or changed English is rejected', () => {
  const request = makeRequest(['解説', '「Good morning.」と言います。'], 'test');
  const token = request.protectedTexts[1].values[0].token;
  assert.deepEqual(parseResponse(envelope([{ id: '1', text: `说「${token}」。` }, { id: '0', text: '解析' }]), request.protectedTexts), ['解析', '说「Good morning.」。']);
  for (const bad of ['早上好', `${token}${token}`, `Good morning.`, `これは${token}`, `${token}extra`]) {
    assert.throws(() => parseResponse(envelope([{ id: '0', text: '解析' }, { id: '1', text: bad }]), request.protectedTexts));
  }
  assert.throws(() => parseResponse(envelope([{ id: '0', text: '解析' }, { id: '0', text: '解析' }]), request.protectedTexts));
  assert.throws(() => parseResponse(envelope([{ id: '0', text: '解析' }]), request.protectedTexts));
});
test('reordered protected phrases and truncated/invalid AI replies are rejected', () => {
  const request = makeRequest(['AはBです。'], 'test');
  const [a, b] = request.protectedTexts[0].values;
  assert.throws(() => parseResponse(envelope([{ id: '0', text: `${b.token}是${a.token}` }]), request.protectedTexts));
  assert.throws(() => parseResponse('not json', request.protectedTexts));
  assert.throws(() => parseResponse(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), request.protectedTexts));
});
test('transport calls only configured AI endpoint, omits cookies and rejects redirects', async () => {
  let request;
  const translator = createTranslator(options => {
    request = options;
    queueMicrotask(() => options.onload({ status: 200, responseText: envelope([{ id: '0', text: '解析' }]) }));
    return { abort() {} };
  });
  assert.deepEqual(await translator(['解説'], { endpoint: 'https://test.example/v1/chat/completions', model: 'my-llm', key: 'test-only-key' }), ['解析']);
  assert.equal(request.anonymous, true);
  assert.equal(request.redirect, 'error');
  assert.equal(JSON.parse(request.data).model, 'my-llm');
  assert.equal(JSON.parse(request.data).thinking, undefined);
  assert.equal(request.headers.Authorization, 'Bearer test-only-key');
  assert.equal(request.url, 'https://test.example/v1/chat/completions');
});
test('disables thinking for DeepSeek official endpoints only', async () => {
  for (const endpoint of ['https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/v1/chat/completions', 'https://api.deepseek.com.other.example/chat/completions']) {
    let body;
    const translator = createTranslator(options => {
      body = JSON.parse(options.data);
      queueMicrotask(() => options.onload({ status: 200, responseText: envelope([{ id: '0', text: '解析' }]) }));
      return { abort() {} };
    });
    await translator(['解説'], { endpoint, model: 'deepseek-flash', key: 'test-only-key' });
    assert.deepEqual(body.thinking, new URL(endpoint).hostname === 'api.deepseek.com' ? { type: 'disabled' } : undefined);
  }
});
test('HTTP failures never retry, echo server content or fall back to machine translation', async () => {
  let calls = 0;
  const translator = createTranslator(options => {
    calls++;
    queueMicrotask(() => options.onload({ status: 429, responseText: 'private service details' }));
    return { abort() {} };
  });
  await assert.rejects(translator(['解説'], { endpoint: 'https://test.example', model: 'llm', key: 'test' }), /HTTP 429/);
  assert.equal(calls, 1);
});
test('abort settles once and ignores a late provider response', async () => {
  const controller = new AbortController();
  let request, aborted = 0;
  const translator = createTranslator(options => { request = options; return { abort() { aborted++; } }; });
  const pending = translator(['解説'], { endpoint: 'https://test.example', model: 'llm', key: 'test' }, controller.signal);
  controller.abort();
  request.onload({ status: 200, responseText: envelope([{ id: '0', text: '解析' }]) });
  await assert.rejects(pending, /暂停/);
  assert.equal(aborted, 1);
});
