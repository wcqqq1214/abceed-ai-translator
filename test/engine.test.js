import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { TranslationEngine, visibleTextNode } from '../src/engine.js';
import { TranslationCache } from '../src/cache.js';

function setup(html, translate, options = {}) {
  const dom = new JSDOM(html, { url: 'https://app.abceed.com/', pretendToBeVisual: true });
  // jsdom does not lay out text; keep real visibility/exclusion logic with synthetic rectangles.
  dom.window.Range.prototype.getClientRects = () => [{ width: 80, height: 20, left: 0, right: 80, top: 0, bottom: 20 }];
  const engine = new TranslationEngine({ doc: dom.window.document, win: dom.window, translate, ...options });
  engine.active = true;
  engine.config = { endpoint: 'https://test.example', model: 'test', key: 'test-only' };
  engine.schedule = () => {};
  return { dom, engine, doc: dom.window.document };
}

test('replaces Japanese in place, preserves English, excludes hidden text and editable/private areas', async () => {
  const seen = [];
  const { dom, engine, doc } = setup(`<p id="jp">  解説  </p><p id="en">What time does the train leave?</p><div hidden>隠れた答え</div><div style="display:none">未公開</div><div aria-hidden="true">非表示</div><textarea>入力</textarea><div contenteditable>編集</div><div translate="no">除外</div>`, async texts => { seen.push(...texts); return texts.map(() => '解析'); });
  await engine.tick();
  assert.deepEqual(seen, ['解説']);
  assert.equal(doc.querySelector('#jp').textContent, '  解析  ');
  assert.equal(doc.querySelector('#en').textContent, 'What time does the train leave?');
  assert.equal(doc.querySelectorAll('#jp > *').length, 0);
  await engine.tick();
  assert.deepEqual(seen, ['解説']);
  dom.window.close();
});
test('deduplicates visible nodes and reuses cached translation when SPA remounts Japanese', async () => {
  let calls = 0;
  const { dom, engine, doc } = setup('<p>解説</p><button>解説</button>', async texts => { calls++; assert.deepEqual(texts, ['解説']); return ['解析']; });
  await engine.tick();
  const button = doc.createElement('button'); button.textContent = '解説'; doc.body.append(button);
  await engine.tick();
  assert.equal(button.textContent, '解析');
  assert.equal(calls, 1);
  // Framework cloning an already translated node must not translate Chinese again.
  doc.body.append(button.cloneNode(true));
  await engine.tick();
  assert.equal(calls, 1);
  dom.window.close();
});
test('does not overwrite text changed by the application during a request', async () => {
  let resolve;
  const { dom, engine, doc } = setup('<p>解説</p>', () => new Promise(r => { resolve = r; }));
  const pending = engine.tick();
  doc.querySelector('p').firstChild.nodeValue = '新しい問題';
  resolve(['解析']);
  await pending;
  assert.equal(doc.querySelector('p').textContent, '新しい問題');
  dom.window.close();
});
test('route changes, paused jobs and newly hidden nodes cannot apply stale results', async () => {
  for (const action of ['route', 'pause', 'hidden']) {
    let resolve;
    const { dom, engine, doc } = setup('<p>解説</p>', () => new Promise(r => { resolve = r; }));
    const pending = engine.tick();
    if (action === 'route') dom.window.history.pushState({}, '', '/next');
    if (action === 'pause') engine.pause();
    if (action === 'hidden') doc.querySelector('p').hidden = true;
    resolve(['解析']); await pending;
    assert.equal(doc.querySelector('p').textContent, '解説');
    dom.window.close();
  }
});
test('translations are inert text, never HTML', async () => {
  const { dom, engine, doc } = setup('<p>解説</p>', async () => ['<img src=x onerror=alert(1)>']);
  await engine.tick();
  assert.equal(doc.querySelector('img'), null);
  assert.equal(doc.querySelector('p').textContent, '<img src=x onerror=alert(1)>');
  dom.window.close();
});
test('new visible explanations are translated without selection or clicks on text', async () => {
  const { dom, engine, doc } = setup('<p hidden>解説</p>', async () => ['解析']);
  await engine.tick();
  assert.equal(engine.count, 0);
  doc.querySelector('p').hidden = false;
  await engine.tick();
  assert.equal(doc.querySelector('p').textContent, '解析');
  dom.window.close();
});
test('API failure and session budget pause processing without recurring requests', async () => {
  let calls = 0;
  const { dom, engine } = setup('<p>解説</p>', async () => { calls++; throw new Error('HTTP 429'); });
  await engine.tick(); await engine.tick();
  assert.equal(engine.active, false); assert.equal(calls, 1);
  engine.active = true; engine.budget = 1;
  await engine.tick();
  assert.equal(engine.active, false); assert.equal(calls, 1);
  dom.window.close();
});
test('restart clears a pending timer and schedules work again', () => {
  const dom = new JSDOM('<p>解説</p>', { url: 'https://app.abceed.com/', pretendToBeVisual: true });
  const engine = new TranslationEngine({ doc: dom.window.document, win: dom.window, translate: async () => ['解析'] });
  engine.start({ endpoint: 'https://test.example', model: 'one' });
  assert.ok(engine.timer);
  engine.pause(); assert.equal(engine.timer, undefined);
  engine.start({ endpoint: 'https://test.example', model: 'one' });
  assert.ok(engine.timer);
  engine.destroy(); dom.window.close();
});
test('offscreen text is not sent', () => {
  const { dom, doc } = setup('<p>解説</p>', async () => []);
  dom.window.Range.prototype.getClientRects = () => [{ width: 80, height: 20, left: 0, right: 80, top: 9000, bottom: 9020 }];
  assert.equal(visibleTextNode(doc.querySelector('p').firstChild, dom.window), false);
  dom.window.close();
});

test('reopened homepage is translated synchronously from storage with zero API calls', async () => {
  let snapshot, calls = 0;
  const storage = { read: () => structuredClone(snapshot), write: value => { snapshot = structuredClone(value); } };
  const config = { endpoint: 'https://test.example', model: 'test', key: 'test-only' };
  const first = setup('<p>ホーム</p><p>解説</p><p>Good morning.</p>', async texts => { calls++; return texts.map(t => t === 'ホーム' ? '首页' : '解析'); }, { cache: new TranslationCache(storage) });
  first.engine.start(config); await first.engine.tick(); first.engine.destroy(); first.dom.window.close();
  const second = setup('<p>ホーム</p><p>解説</p><p>Good morning.</p>', async () => { calls++; throw new Error('unexpected network call'); }, { cache: new TranslationCache(storage) });
  second.engine.start(config);
  // No timer, tick or API result is needed to render a warm homepage.
  assert.equal(second.doc.body.textContent, '首页解析Good morning.');
  assert.equal(second.engine.cacheHits, 2);
  await second.engine.tick();
  assert.equal(calls, 1);
  second.engine.destroy(); second.dom.window.close();
});

test('cached dynamic content does not wait behind a pending API request', async () => {
  let finish;
  const fixture = setup('<p>新しい問題</p>', () => new Promise(resolve => { finish = resolve; }));
  const { engine, doc, dom } = fixture;
  engine.cache.set('ホーム', '首页');
  engine.schedule = TranslationEngine.prototype.schedule.bind(engine);
  const pending = engine.tick();
  const menu = doc.createElement('p'); menu.textContent = 'ホーム'; doc.body.append(menu);
  engine.schedule();
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(menu.textContent, '首页');
  assert.equal(engine.busy, true);
  finish(['新题目']); await pending;
  engine.destroy(); dom.window.close();
});

test('clearing cache discards an in-flight result instead of persisting it again', async () => {
  let finish, snapshot;
  const cache = new TranslationCache({ read: () => snapshot, write: value => { snapshot = value; } });
  const { engine, dom, doc } = setup('<p>解説</p>', () => new Promise(resolve => { finish = resolve; }), { cache });
  const pending = engine.tick(); engine.clearCache();
  finish(['解析']); await pending;
  assert.deepEqual(snapshot.entries, []);
  assert.equal(doc.querySelector('p').textContent, '解説');
  engine.destroy(); dom.window.close();
});

test('translates native options and selected tab attributes while preserving selection and values', async () => {
  const seen = [];
  const { dom, engine, doc } = setup(`<button role="tab" aria-label="学習時間"><span style="visibility:hidden">学習時間</span></button><select><option value="7d">1週間</option><option selected>すべて</option><option value="x" label="1ヶ月">Month</option></select><select hidden><option>秘密</option></select>`, async texts => {
    seen.push(...texts);
    const map = { '学習時間': '学习时间', '1週間': '1周', 'すべて': '全部', '1ヶ月': '1个月' };
    return texts.map(text => map[text]);
  });
  const rect = () => ({ width: 80, height: 20, left: 0, right: 80, top: 0, bottom: 20 });
  doc.querySelector('button').getBoundingClientRect = rect;
  for (const select of doc.querySelectorAll('select')) select.getBoundingClientRect = rect;
  const select = doc.querySelector('select');
  await engine.tick();
  assert.equal(doc.querySelector('button').getAttribute('aria-label'), '学习时间');
  assert.equal(select.options[0].text, '1周');
  assert.equal(select.options[0].value, '7d');
  assert.equal(select.options[1].text, '全部');
  assert.equal(select.value, 'すべて');
  assert.equal(select.selectedIndex, 1);
  assert.equal(select.options[2].label, '1个月');
  assert.equal(select.options[2].value, 'x');
  assert.ok(!seen.includes('秘密'));
  select.selectedIndex = 0;
  assert.equal(select.value, '7d');
  await engine.tick();
  assert.equal(seen.length, 4);
  // Framework restores Japanese: the cache must update both types of target.
  select.options[0].textContent = '1週間';
  doc.querySelector('button').setAttribute('aria-label', '学習時間');
  engine.applyCached();
  assert.equal(select.options[0].text, '1周');
  assert.equal(doc.querySelector('button').getAttribute('aria-label'), '学习时间');
  dom.window.close();
});

test('failed entries are skipped without repeated requests and explicit retry recovers them', async () => {
  let calls = 0;
  const { dom, engine, doc } = setup('<p id="good">解説</p><p id="bad">問題</p>', async texts => {
    calls++;
    return texts.map(text => text === '解説' ? '解析' : calls === 1 ? null : '题目');
  });
  try {
    await engine.tick();
    assert.equal(engine.active, true);
    assert.equal(doc.querySelector('#good').textContent, '解析');
    assert.equal(doc.querySelector('#bad').textContent, '問題');
    assert.equal(engine.cache.get('問題'), undefined);
    await engine.tick(); assert.equal(calls, 1);
    engine.retryFailed(); await engine.tick();
    assert.equal(doc.querySelector('#bad').textContent, '题目');
    assert.equal(calls, 2);
  } finally { dom.window.close(); }
});

test('fresh AI results and cached standalone count units both render as 题', async () => {
  const { dom, engine, doc } = setup('<p id="total">763<span>問</span></p><p id="row">40問</p>', async texts => texts.map(t => t.replace('問', '问')));
  await engine.tick();
  assert.equal(doc.querySelector('#total').textContent, '763题');
  assert.equal(doc.querySelector('#row').textContent, '40题');
  doc.body.innerHTML = '<p>215問</p>';
  engine.cache.items.set('215問', { text: '215问' });
  engine.applyCached();
  assert.equal(doc.body.textContent, '215题');
  dom.window.close();
});
