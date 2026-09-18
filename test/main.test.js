import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const sources = await Promise.all(['core', 'cache', 'engine', 'words', 'frames', 'main'].map(async name =>
  (await readFile(new URL(`../src/${name}.js`, import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '')));

function setup(saved = {}) {
  const dom = new JSDOM('<body></body>', { url: 'https://app.abceed.com', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window, memory = new Map(Object.entries(saved));
  let root;
  const attach = win.Element.prototype.attachShadow;
  win.Element.prototype.attachShadow = function(options) { root = attach.call(this, options); return root; };
  win.GM_getValue = (key, fallback) => memory.has(key) ? memory.get(key) : fallback;
  win.GM_setValue = (key, value) => memory.set(key, value);
  win.GM_deleteValue = key => memory.delete(key);
  win.GM_registerMenuCommand = () => {};
  win.GM_xmlhttpRequest = () => { throw new Error('No requests expected'); };
  win.eval(`(() => {${sources.join('\n')} })()`);
  return { dom, root, memory };
}

test('configured menu folds credentials and switch pauses/resumes automatic translation', () => {
  const { dom, root, memory } = setup({ config: { endpoint: 'https://test.example/chat/completions', model: 'test', enabled: true }, apiKey: 'test-key' });
  try {
    assert.equal(root.querySelector('details').open, false);
    const toggle = root.querySelector('[role=switch]');
    assert.equal(toggle.getAttribute('aria-checked'), 'true');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-checked'), 'false');
    assert.equal(memory.get('config').enabled, false);
    assert.equal(memory.get('apiKey'), 'test-key');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-checked'), 'true');
    assert.equal(memory.get('config').enabled, true);
    assert.equal(root.querySelector('details').open, false);
  } finally { dom.window.close(); }
});

test('first-time setup opens automatically, validation stays visible, valid save folds settings', () => {
  const { dom, root, memory } = setup();
  try {
    const details = root.querySelector('details');
    assert.equal(details.open, true);
    assert.equal(root.querySelector('.panel').hidden, false);
    root.querySelector('.primary').click();
    assert.equal(details.open, true);
    assert.equal(root.querySelector('[role=switch]').getAttribute('aria-checked'), 'false');
    root.querySelector('#endpoint').value = 'https://test.example';
    root.querySelector('#model').value = 'test';
    root.querySelector('#key').value = 'test-key';
    root.querySelector('.primary').click();
    assert.equal(details.open, false);
    assert.equal(root.querySelector('[role=switch]').getAttribute('aria-checked'), 'true');
    assert.equal(memory.has('apiKey'), false);
  } finally { dom.window.close(); }
});
