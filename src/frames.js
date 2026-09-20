import { wordCacheKey, translationScope } from './cache.js';
import { WordLookup } from './words.js';
import { TranslationEngine } from './engine.js';
import { MAX_TEXT, MAX_BATCH_ITEMS, MAX_BATCH_CHARS } from './core.js';

const FRAME_CHANNEL = 'abceed-ai-lookup-v1';
const APP_ORIGIN = 'https://app.abceed.com';
const CONTENT_ORIGIN = 'https://private.abceed.com';

export function attachFrameBridge({ win, doc, getConfig, translate, translateSelection, cache }) {
  const pending = new Map();
  const cancelAll = () => { for (const controller of pending.values()) controller.abort(); pending.clear(); };
  const onMessage = async event => {
    const data = event.data;
    if (event.origin !== CONTENT_ORIGIN || !data || data.channel !== FRAME_CHANNEL ||
      typeof data.id !== 'string' || data.id.length > 100 ||
      !Array.from(doc.querySelectorAll('iframe')).some(frame => frame.contentWindow === event.source)) return;
    if (data.type === 'cancel') { const current = pending.get(event.source); if (current?.requestId === data.id) { current.abort(); pending.delete(event.source); } return; }
    if (data.type !== 'request' || !['word', 'selection'].includes(data.mode) ||
      typeof data.text !== 'string' || !data.text.trim() || data.text.length > (data.mode === 'word' ? 60 : 3000) ||
      (data.context !== undefined && (typeof data.context !== 'string' || data.context.length > 600))) return;
    pending.get(event.source)?.abort();
    const controller = new AbortController();
    controller.requestId = data.id;
    pending.set(event.source, controller);
    const reply = payload => {
      if (!controller.signal.aborted && Array.from(doc.querySelectorAll('iframe')).some(frame => frame.contentWindow === event.source))
        event.source.postMessage({ channel: FRAME_CHANNEL, type: 'response', id: data.id, ...payload }, CONTENT_ORIGIN);
    };
    try {
      const config = getConfig();
      const scope = translationScope(config, 'word');
      if (cache.scope !== scope) cache.load(scope);
      const key = data.mode === 'word' ? wordCacheKey(data.text, data.context) : `selection:${data.text}`;
      let result = cache.get(key);
      if (result === undefined) {
        result = await (data.mode === 'word' ? translate : translateSelection)(data.text, config, controller.signal, data.context);
        if (controller.signal.aborted) return;
        cache.set(key, result); cache.flush();
      }
      reply({ result });
    } catch (error) { reply({ error: error.message }); }
    finally { if (pending.get(event.source) === controller) pending.delete(event.source); }
  };
  win.addEventListener('message', onMessage);
  return { cancelAll, destroy() { cancelAll(); win.removeEventListener('message', onMessage); } };
}

export function createFrameRequester(win) {
  return (mode, text, config, signal, context = '') => new Promise((resolve, reject) => {
    const id = win.crypto.randomUUID();
    let timer;
    const finish = (error, result) => {
      win.clearTimeout(timer);
      win.removeEventListener('message', receive);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => {
      win.parent.postMessage({ channel: FRAME_CHANNEL, type: 'cancel', id }, APP_ORIGIN);
      finish(new Error('翻译已暂停。'));
    };
    const receive = event => {
      const data = event.data;
      if (event.source !== win.parent || event.origin !== APP_ORIGIN || data?.channel !== FRAME_CHANNEL || data.type !== 'response' || data.id !== id) return;
      if (typeof data.error === 'string') finish(new Error(data.error));
      else if (typeof data.result === 'string' || (mode === 'auto' && Array.isArray(data.result) && data.result.every(text => text === null || typeof text === 'string')) || (mode === 'state' && data.result && typeof data.result.enabled === 'boolean')) finish(null, data.result);
    };
    if (signal?.aborted) { finish(new Error('翻译已暂停。')); return; }
    win.addEventListener('message', receive);
    signal?.addEventListener('abort', abort, { once: true });
    timer = win.setTimeout(() => { abort(); }, 75000);
    win.parent.postMessage({ channel: FRAME_CHANNEL, type: 'request', id, mode, text, context }, APP_ORIGIN);
  });
}

export function attachContentLookup(doc, win) {
  if (win.location.origin !== CONTENT_ORIGIN) return;
  const host = doc.createElement('div');
  host.setAttribute('data-abceed-ai-ui', '');
  host.style.cssText = 'position:fixed;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = ':host{all:initial;font:13px/1.5 "PingFang SC",sans-serif;color-scheme:light}*{box-sizing:border-box}[hidden]{display:none!important}p{margin:0}button{font:inherit;cursor:pointer}';
  root.append(style);
  doc.documentElement.append(host);
  const request = createFrameRequester(win);
  // Persistent cache and provider settings stay in the parent; frames never receive keys.
  const cache = { scope: '', load(scope) { this.scope = scope; }, get() {}, set() {}, flush() {}, clear() {} };
  const words = new WordLookup({ doc, win, root, cache, getConfig: () => ({ endpoint: APP_ORIGIN, model: 'parent' }),
    translate: (text, config, signal, context) => request('word', text, config, signal, context),
    translateSelection: (text, config, signal) => request('selection', text, config, signal)
  });
  const automatic = attachContentAutoTranslation(doc, win, request);
  return { words, automatic };
}


export function attachAutoFrameBridge({ win, doc, engine }) {
  const pending = new Map();
  const cancelAll = () => { for (const item of pending.values()) item.controller.abort(); pending.clear(); };
  const onMessage = async event => {
    const data = event.data;
    if (event.origin !== CONTENT_ORIGIN || data?.channel !== FRAME_CHANNEL || typeof data.id !== 'string' || data.id.length > 100 ||
      !Array.from(doc.querySelectorAll('iframe')).some(frame => frame.contentWindow === event.source)) return;
    const reply = payload => event.source.postMessage({ channel: FRAME_CHANNEL, type: 'response', id: data.id, ...payload }, CONTENT_ORIGIN);
    if (data.type === 'cancel') {
      const item = pending.get(event.source);
      if (item?.id === data.id) { item.controller.abort(); pending.delete(event.source); }
      return;
    }
    if (data.type !== 'request') return;
    if (data.mode === 'state') {
      reply({ result: { enabled: engine.active, revision: engine.generation, scope: engine.cache.scope } });
      return;
    }
    if (data.mode !== 'auto' || !Array.isArray(data.text) || !data.text.length || data.text.length > MAX_BATCH_ITEMS ||
      !data.text.every(text => typeof text === 'string' && text.trim() && text.length <= MAX_TEXT) ||
      (data.text.length > 1 && data.text.reduce((sum, text) => sum + text.length, 0) > MAX_BATCH_CHARS)) return;
    pending.get(event.source)?.controller.abort();
    const controller = new AbortController();
    pending.set(event.source, { id: data.id, controller });
    const generation = engine.generation;
    try {
      if (!engine.active || !engine.config) throw new Error('自动翻译已暂停。');
      const missing = [...new Set(data.text.filter(text => engine.cache.get(text) === undefined))];
      const size = missing.reduce((sum, text) => sum + text.length, 0);
      if (engine.used + size > engine.budget) throw new Error('本标签页已达到翻译额度，请刷新后继续。');
      engine.used += size;
      const translated = missing.length ? await engine.translate(missing, engine.config, controller.signal) : [];
      if (controller.signal.aborted || !engine.active || engine.generation !== generation ||
        !Array.from(doc.querySelectorAll('iframe')).some(frame => frame.contentWindow === event.source)) throw new Error('自动翻译已暂停。');
      const results = new Map(missing.map((text, index) => [text, translated[index]]));
      const output = data.text.map(text => results.has(text) ? results.get(text) : engine.cache.get(text));
      for (const [text, result] of results) {
        if (result === null) { engine.failed?.add(text); continue; }
        engine.cache.set(text, result);
      }
      engine.cache.flush();
      reply({ result: output });
    } catch (error) {
      // Surface transport failures in the parent, where the user can explicitly retry.
      // Canceled, superseded or detached frames must not pause a newer session.
      if (!controller.signal.aborted && engine.active && engine.generation === generation &&
        Array.from(doc.querySelectorAll('iframe')).some(frame => frame.contentWindow === event.source)) {
        for (const text of data.text) engine.failed.add(text);
        engine.pause(`教材翻译失败：${error.message} · 部分内容未翻译，可重试`);
      }
      reply({ error: error.message });
    }
    finally { if (pending.get(event.source)?.controller === controller) pending.delete(event.source); }
  };
  win.addEventListener('message', onMessage);
  return { cancelAll, destroy() { cancelAll(); win.removeEventListener('message', onMessage); } };
}

export function attachContentAutoTranslation(doc, win, request) {
  const engine = new TranslationEngine({ doc, win, translate: (texts, config, signal) => request('auto', texts, config, signal) });
  engine.attach();
  let lastRevision, polling = false, destroyed = false;
  const controller = new AbortController();
  const sync = async () => {
    if (polling || destroyed) return;
    polling = true;
    try {
      const state = await request('state', '', {}, controller.signal);
      if (destroyed) return;
      if (!state.enabled) { if (engine.active) engine.pause(); lastRevision = undefined; return; }
      const revision = `${state.scope}\n${state.revision}`;
      if (revision !== lastRevision) {
        engine.pause(); engine.cache.clear();
        engine.start({ endpoint: APP_ORIGIN, model: state.scope || 'parent' });
        lastRevision = revision;
      }
    } catch {
      if (!destroyed) {
        if (engine.active) engine.pause();
        // A failed state poll is a connection interruption, not a failed AI batch.
        lastRevision = undefined;
      }
    }
    finally { polling = false; }
  };
  void sync();
  const timer = win.setInterval(sync, 1500);
  return { engine, sync, destroy() { destroyed = true; controller.abort(); win.clearInterval(timer); engine.destroy(); } };
}
