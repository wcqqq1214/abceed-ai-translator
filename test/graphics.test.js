import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { adaptPlayerLabels, attachCanvasTranslation } from '../src/graphics.js';
import { TranslationEngine, visibleTextNode } from '../src/engine.js';

const glyph = 'M6.66 15.26v-1.04h4.75';
test('SVG automatic-transition label becomes translatable without replacing its clickable control or background', async () => {
  const dom = new JSDOM(`<div class="sound-controller-sub-component"><button><svg><rect fill="red"/><path d="${glyph}" fill="white"/></svg></button></div>`, { pretendToBeVisual: true });
  const doc = dom.window.document, button = doc.querySelector('button');
  let clicks = 0; button.onclick = () => clicks++;
  adaptPlayerLabels(doc); adaptPlayerLabels(doc);
  assert.equal(doc.querySelectorAll('text').length, 1);
  assert.equal(doc.querySelector('text').textContent, '自動遷移');
  const engine = new TranslationEngine({ doc, win: dom.window, isVisible: () => true, translate: async texts => texts.map(() => '自动切题') });
  engine.config = {}; engine.active = true;
  await engine.tick();
  assert.equal(doc.querySelector('text').textContent, '自动切题');
  assert.equal(doc.querySelector('rect').getAttribute('fill'), 'red');
  button.click(); assert.equal(clicks, 1);
  doc.querySelector('path').setAttribute('fill', 'gray'); adaptPlayerLabels(doc);
  assert.equal(doc.querySelector('text').getAttribute('fill'), 'gray');
  engine.pause(); dom.window.close();
});

test('canvas labels use engine AI queue/cache while dates, numbers and other canvases stay unchanged', async () => {
  const dom = new JSDOM('<canvas aria-label="学習問題数の推移グラフ"></canvas><canvas id="other"></canvas>', { url: 'https://app.abceed.com/learning-records', pretendToBeVisual: true });
  const doc = dom.window.document, canvas = doc.querySelector('canvas');
  const calls = [];
  class Context {
    constructor(canvas) { this.canvas = canvas; }
    fillText(text, x, y) { return [text, x, y]; }
    measureText(text) { return { width: text.length }; }
  }
  const engine = new TranslationEngine({ doc, win: dom.window, isVisible: () => true, translate: async texts => { calls.push(texts); return texts.map(s => s.replace('問', '题')); } });
  engine.active = true; engine.config = {};
  const original = Context.prototype.fillText;
  const adapter = attachCanvasTranslation(doc, dom.window, { CanvasRenderingContext2D: Context }, engine);
  const context = new Context(canvas);
  assert.deepEqual(context.fillText('215問', 12, 24), ['215問', 12, 24]);
  context.measureText('215問');
  context.fillText('09/18', 0, 0); context.fillText('215', 0, 0);
  new Context(doc.querySelector('#other')).fillText('別の図', 0, 0);
  assert.equal(engine.extraNodes.size, 1);
  await engine.tick();
  assert.deepEqual(calls, [['215問']]);
  assert.deepEqual(context.fillText('215問', 12, 24), ['215题', 12, 24]);
  assert.equal(context.measureText('215問').width, 4);
  engine.cache.clear(); context.fillText('215問', 0, 0); await engine.tick();
  assert.equal(calls.length, 2);
  engine.pause(); assert.equal(context.fillText('215問', 0, 0)[0], '215問');
  adapter.destroy(); assert.equal(Context.prototype.fillText, original);
  dom.window.close();
});
