import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { attachPlayerKeys } from '../src/player.js';

function fixture() {
  const dom = new JSDOM('<div class="sound-controller-main-component">' + '<a href="#" class="sound-controller_item"></a>'.repeat(5) + '</div><input><button>Other</button><div data-abceed-ai-ui tabindex="0"></div><iframe></iframe>', { url: 'https://app.abceed.com/' });
  const { document: doc } = dom.window;
  const buttons = [...doc.querySelectorAll('a')];
  const counts = [0, 0, 0, 0, 0];
  buttons.forEach((button, i) => {
    button.getBoundingClientRect = () => ({ width: 24, height: 24, top: 10, left: 10, bottom: 34, right: 34 });
    button.addEventListener('click', event => { event.preventDefault(); counts[i]++; });
  });
  const keys = attachPlayerKeys(doc, dom.window);
  const press = (key, target = doc.body, options = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...options });
    target.dispatchEvent(event); return event;
  };
  return { dom, doc, buttons, counts, press, finish() { keys.destroy(); dom.window.close(); } };
}

test('player shortcuts reuse only seek and toggle buttons, with Space repeat suppressed', () => {
  const f = fixture();
  for (const key of ['ArrowLeft', 'ArrowRight', ' ']) assert.equal(f.press(key).defaultPrevented, true);
  f.press(' ', f.doc.body, { repeat: true });
  f.press('ArrowRight', f.doc.body, { repeat: true });
  assert.deepEqual(f.counts, [0, 1, 1, 2, 0]);
  f.finish();
});

test('editable fields, script settings, focused controls and modifiers retain native behavior', () => {
  const f = fixture();
  for (const selector of ['input', '[data-abceed-ai-ui]']) {
    for (const key of ['ArrowLeft', ' ']) assert.equal(f.press(key, f.doc.querySelector(selector)).defaultPrevented, false);
  }
  assert.equal(f.press(' ', f.doc.querySelector('button')).defaultPrevented, false);
  assert.equal(f.press(' ', f.buttons[2]).defaultPrevented, false);
  assert.equal(f.press('ArrowRight', f.doc.body, { ctrlKey: true }).defaultPrevented, false);
  assert.equal(f.press('ArrowUp').defaultPrevented, false);
  assert.deepEqual(f.counts, [0, 0, 0, 0, 0]);
  f.finish();
});

test('missing, hidden, disabled or changed players do not consume keys', () => {
  const f = fixture();
  f.buttons[1].setAttribute('aria-disabled', 'true');
  assert.equal(f.press('ArrowLeft').defaultPrevented, false);
  f.doc.querySelector('.sound-controller-main-component').hidden = true;
  assert.equal(f.press(' ').defaultPrevented, false);
  f.doc.querySelector('.sound-controller-main-component').hidden = false;
  f.buttons[4].remove();
  assert.equal(f.press('ArrowRight').defaultPrevented, false);
  f.finish();
});

test('only attached trusted focused textbook frames can control the parent player', () => {
  const f = fixture();
  const frame = f.doc.querySelector('iframe');
  const message = (origin, source, action = 'forward') => f.dom.window.dispatchEvent(new f.dom.window.MessageEvent('message', {
    origin, source, data: { channel: 'abceed-player-keys-v1', type: 'action', action }
  }));
  message('https://private.abceed.com', frame.contentWindow);
  assert.equal(f.counts[3], 0);
  frame.focus();
  message('https://evil.example', frame.contentWindow);
  message('https://private.abceed.com', f.dom.window);
  message('https://private.abceed.com', frame.contentWindow, 'next');
  assert.equal(f.counts[3], 0);
  message('https://private.abceed.com', frame.contentWindow);
  assert.equal(f.counts[3], 1);
  f.finish();
});

test('embedded keyboard forwards keys only after trusted parent confirms available controls', () => {
  const dom = new JSDOM('<p>Textbook</p>', { url: 'https://private.abceed.com/contents/test' });
  const sent = [], parent = { postMessage: (...args) => sent.push(args) };
  const win = {
    top: parent, parent, location: dom.window.location,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window),
    setInterval: () => 1, clearInterval() {}
  };
  const keys = attachPlayerKeys(dom.window.document, win);
  const press = () => {
    const event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    dom.window.document.body.dispatchEvent(event); return event;
  };
  assert.equal(press().defaultPrevented, false);
  const state = origin => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { origin, source: parent, data: { channel: 'abceed-player-keys-v1', type: 'state', available: { forward: true } } }));
  state('https://evil.example'); assert.equal(press().defaultPrevented, false);
  state('https://app.abceed.com'); assert.equal(press().defaultPrevented, true);
  assert.deepEqual(sent.at(-1), [{ channel: 'abceed-player-keys-v1', type: 'action', action: 'forward' }, 'https://app.abceed.com']);
  keys.destroy(); dom.window.close();
});
