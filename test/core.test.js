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

test('mixed paragraphs protect English line breaks and Unicode whitespace byte-for-byte', () => {
  for (const space of ['\n', '\r\n', '\u00a0', '\u202f', '\u2003', '\t']) {
    const english = `New${space}York`;
    const { protectedTexts } = makeRequest([`「${english}」は地名です。`], 'test');
    assert.deepEqual(protectedTexts[0].values.map(part => part.value), [english]);
    const text = `“${protectedTexts[0].values[0].token}”是地名。`;
    assert.deepEqual(parseResponse(envelope([{ id: '0', text }]), protectedTexts), [`“${english}”是地名。`]);
  }
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

test('missing placeholders report preservation failure instead of reordered English', () => {
  const request = makeRequest(['AとBの説明です。'], 'test');
  assert.throws(() => parseResponse(envelope([{ id: '0', text: '说明' }]), request.protectedTexts), /未完整保留/);
});

test('recovers reordered or missing English by translating Japanese spans and stitching originals', async () => {
  for (const failure of ['reorder', 'missing']) {
    const bodies = [];
    const translator = createTranslator(options => {
      const body = JSON.parse(options.data);
      const { entries } = JSON.parse(body.messages[1].content);
      bodies.push(entries);
      let translations;
      if (bodies.length === 1) {
        const tokens = Object.keys(entries[0].protectedEnglish);
        translations = [{ id: '0', text: failure === 'reorder' ? `${tokens[1]}邮件发送${tokens[0]}。` : '邮件发送详情。' }];
      } else {
        const dictionary = { '「詳細」を': '“详情”通过', 'メールで送ります。': '邮件发送。' };
        translations = entries.map(({ id, text }) => ({ id, text: dictionary[text] }));
      }
      queueMicrotask(() => options.onload({ status: 200, responseText: envelope(translations) }));
      return { abort() {} };
    });
    const result = await translator(['those details「詳細」をEメールで送ります。'], { endpoint: 'https://test.example', model: 'llm', key: 'test' });
    assert.deepEqual(result, ['those details“详情”通过E邮件发送。']);
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1].map(x => x.text), ['「詳細」を', 'メールで送ります。']);
    assert.ok(bodies[1].every(x => Object.keys(x.protectedEnglish).length === 0));
  }
});

test('fragment recovery stops on invalid output without retry loops', async () => {
  let calls = 0;
  const translator = createTranslator(options => {
    calls++;
    queueMicrotask(() => options.onload({ status: 200, responseText: envelope([{ id: '0', text: calls === 1 ? '说明' : 'extra English' }]) }));
    return { abort() {} };
  });
  await assert.rejects(translator(['Aの説明'], { endpoint: 'https://test.example', model: 'llm', key: 'test' }), /额外英语/);
  assert.equal(calls, 2);
});

test('fragment recovery batches requests and cancellation prevents further API calls', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let calls = 0;
    const counts = [];
    const source = Array.from({ length: 14 }, (_, i) => `A${i}の説明。`).join('');
    const translator = createTranslator(options => {
      calls++;
      const { entries } = JSON.parse(JSON.parse(options.data).messages[1].content);
      counts.push(entries.length);
      queueMicrotask(() => {
        options.onload({ status: 200, responseText: envelope(entries.map(({ id }) => ({ id, text: '说明。' }))) });
        if (cancel && calls === 2) controller.abort();
      });
      return { abort() {} };
    });
    const pending = translator([source], { endpoint: 'https://test.example', model: 'llm', key: 'test' }, controller.signal);
    if (cancel) {
      await assert.rejects(pending, /暂停/);
      assert.deepEqual(counts, [1, 12]);
    } else {
      assert.deepEqual(await pending, [Array.from({ length: 14 }, (_, i) => `A${i}说明。`).join('')]);
      assert.deepEqual(counts, [1, 12, 2]);
    }
  }
});

test('partial parsing preserves valid items when another item is missing or duplicated', () => {
  const { protectedTexts } = makeRequest(['解説', '問題'], 'test');
  assert.deepEqual(parseResponse(envelope([{ id: '0', text: '解析' }]), protectedTexts, true), ['解析', null]);
  assert.deepEqual(parseResponse(envelope([{ id: '0', text: '解析' }, { id: '1', text: '题目' }, { id: '1', text: '重复' }]), protectedTexts, true), ['解析', null]);
});

test('page translator keeps successful entries and bounds failed-entry recovery', async () => {
  const { createPageTranslator } = await import('../src/core.js');
  let calls = 0;
  const translate = createPageTranslator(options => {
    calls++;
    const translations = calls === 1 ? [{ id: '0', text: '解析' }, { id: '1', text: 'bad English' }, { id: '2', text: '下一题' }] : [{ id: '0', text: 'bad English' }];
    queueMicrotask(() => options.onload({ status: 200, responseText: envelope(translations) }));
    return { abort() {} };
  });
  assert.deepEqual(await translate(['解説', 'Aの説明', '次の問題'], { endpoint: 'https://test.example', model: 'test', key: 'test' }), ['解析', null, '下一题']);
  assert.equal(calls, 3);
});

test('embedded paragraph recovery identifies validation failure and preserves repeated numbers', async () => {
  const { createPageTranslator } = await import('../src/core.js');
  const source = 'この度はセルッティ社製コーヒーメーカーをお買い求めいただき、ありがとうございました。コーヒーメーカー製造実績80年を超す当社は、お召し上がりになる1杯1杯がお客様に大きな喜びをもたらすと確信しています。';
  const config = { endpoint: 'https://test.example', model: 'test', key: 'test' };
  for (const failure of ['brand', 'number', 'kana']) {
    const bodies = [];
    const translate = createPageTranslator(options => {
      const body = JSON.parse(options.data);
      bodies.push(body);
      const { entries } = JSON.parse(body.messages[1].content);
      const tokens = Object.keys(entries[0].protectedEnglish);
      let text = `感谢您购买塞尔蒂咖啡机。我们有超过${tokens[0]}年的制造经验，相信您喝的${tokens[1]}杯${tokens[2]}杯咖啡都会带来喜悦。`;
      if (bodies.length === 1) {
        if (failure === 'brand') text = text.replace('塞尔蒂', 'Cerrutti');
        if (failure === 'number') text = text.replace(tokens[2], '一');
        if (failure === 'kana') text = text.replace('塞尔蒂', 'セルッティ');
      } else {
        const prompt = body.messages[0].content;
        assert.match(prompt, /上一次输出未通过校验/);
        assert.match(prompt, failure === 'number' ? /未完整保留/ : /额外英语/);
        assert.match(prompt, /中文音译/);
        assert.match(prompt, /省略重复数字/);
        assert.equal(entries[0].text, protectEnglish(source).masked);
      }
      queueMicrotask(() => options.onload({ status: 200, responseText: envelope([{ id: '0', text }]) }));
      return { abort() {} };
    });
    assert.deepEqual(await translate([source], config), ['感谢您购买塞尔蒂咖啡机。我们有超过80年的制造经验，相信您喝的1杯1杯咖啡都会带来喜悦。']);
    assert.equal(bodies.length, 2);
  }
});

test('validation distinguishes leftover kana from extra Latin and shows bounded offending snippets', () => {
  const part = protectEnglish('regard の説明');
  const token = part.values[0].token;
  assert.equal(restoreEnglish(`${token}的说明`, part), 'regard 的说明');
  assert.throws(() => restoreEnglish(`${token}的カバー说明`, part), error => /残留日文假名「カバー」/.test(error.message) && !/额外英语/.test(error.message));
  assert.throws(() => restoreEnglish(`${token}的signs说明`, part), error => /额外英语.*「signs」/.test(error.message) && !/残留日文假名/.test(error.message));
  assert.throws(() => restoreEnglish(`${token}カバー signs`, part), /残留日文假名.*额外英语/);
  assert.throws(() => restoreEnglish(`${token}${'a'.repeat(300)}`, part), error => error.message.includes('a'.repeat(24) + '…') && !error.message.includes('a'.repeat(25)));
});
