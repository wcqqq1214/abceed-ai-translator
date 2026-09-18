import { normalizeConfig, createTranslator } from './core.js';
import { TranslationEngine } from './engine.js';

(() => {
  if (document.querySelector('[data-abceed-ai-ui]')) return;
  const host = document.createElement('div');
  host.setAttribute('data-abceed-ai-ui', '');
  host.setAttribute('translate', 'no');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  // Keep API settings out of the page's DOM and avoid site CSS interference.
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial;color-scheme:light;font-family:system-ui,-apple-system,"PingFang SC",sans-serif;font-size:14px;color:#172b38}
    *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}
    .toggle{border:0;border-radius:24px;background:#173e3c;color:white;padding:12px 17px;box-shadow:0 4px 20px #1233;font-weight:650}
    .panel{width:min(370px,calc(100vw - 32px));max-height:calc(100vh - 95px);overflow:auto;background:#fff;border:1px solid #d9e3de;border-radius:18px;padding:20px;margin-bottom:12px;box-shadow:0 12px 44px #1233}
    [hidden]{display:none!important}h2{font-size:19px;margin:0 0 6px}p{font-size:12px;line-height:1.7;color:#5c6d70;margin:5px 0 14px}
    label{display:block;font-size:12px;font-weight:600;margin:13px 0 6px}
    input:not([type=checkbox]){width:100%;padding:10px 11px;border:1px solid #cbd6d2;border-radius:8px;background:#fafcfb;color:#172b38}
    input:focus{outline:2px solid #6baba0;outline-offset:1px}.check{display:flex;gap:8px;align-items:center;font-weight:400}
    .row{display:flex;gap:8px;margin-top:14px}.row button{border:1px solid #d9e3de;border-radius:8px;padding:9px 12px;background:#f5f8f6;color:#173e3c}
    .row .primary{flex:1;background:#173e3c;color:white;border-color:#173e3c}.status{padding:10px 11px;background:#edf4f0;border-radius:8px;font-size:12px;line-height:1.6;overflow-wrap:anywhere;margin-top:13px}
    .status[data-state=paused]{background:#fff4df}.foot{margin:14px 0 0;font-size:11px}.close{float:right;background:none;border:0;color:#536662;font-size:20px;padding:0 3px}
  `;
  root.append(style);
  const el = (tag, text, parent = root) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    parent.append(node);
    return node;
  };
  const panel = el('section');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'abceed AI 翻译设置');
  const close = el('button', '×', panel);
  close.className = 'close';
  close.setAttribute('aria-label', '关闭设置');
  el('h2', 'abceed AI 翻译', panel);
  el('p', '日文自动换成中文，英语保持原样。', panel);
  const field = (name, id, placeholder, type = 'text') => {
    const label = el('label', name, panel);
    label.htmlFor = id;
    const input = el('input', '', panel);
    Object.assign(input, { id, type, placeholder, spellcheck: false, autocomplete: 'off' });
    return input;
  };
  const endpoint = field('API 地址（Base URL 或完整接口地址）', 'endpoint', 'https://your-provider.example/v1', 'url');
  const model = field('模型 ID', 'model', '填写服务商提供的模型名称');
  const key = field('API Key', 'key', '只发送给你配置的 AI 服务商', 'password');
  const rememberLabel = el('label', '', panel);
  rememberLabel.className = 'check';
  const remember = el('input', '', rememberLabel);
  remember.type = 'checkbox';
  el('span', '在 Tampermonkey 中记住 Key', rememberLabel);
  const row = el('div', '', panel);
  row.className = 'row';
  const start = el('button', '保存并自动翻译', row);
  start.className = 'primary';
  const pause = el('button', '暂停', row);
  const status = el('div', '请先配置 AI 接口。', panel);
  status.className = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const foot = el('p', '开启后，可见日文会自动发送给所填服务商，可能产生 API 费用。请关闭 Chrome 自带的整页翻译。Key 不写入网页存储；译文只缓存在本标签页。', panel);
  foot.className = 'foot';
  const cleanup = el('div', '', panel);
  cleanup.className = 'row';
  const clear = el('button', '清除缓存', cleanup);
  const forget = el('button', '清除 Key', cleanup);
  const toggle = el('button', '中 · AI 翻译');
  toggle.className = 'toggle';
  toggle.setAttribute('aria-expanded', 'false');
  document.documentElement.append(host);

  const show = visible => {
    panel.hidden = !visible;
    toggle.setAttribute('aria-expanded', String(visible));
  };
  show(false);
  toggle.onclick = () => show(panel.hidden);
  close.onclick = () => show(false);
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { show(false); toggle.focus(); }
  });
  const setStatus = (text, state) => {
    // Avoid DOM observer churn caused by identical status updates.
    if (status.textContent !== text) status.textContent = text;
    status.dataset.state = state || '';
    toggle.textContent = state === 'running' ? '中 · AI 开启' : '中 · AI 设置';
    toggle.title = text;
  };
  const engine = new TranslationEngine({ doc: document, win: window, translate: createTranslator(GM_xmlhttpRequest), onStatus: setStatus });
  engine.attach();
  const saved = GM_getValue('config', {});
  endpoint.value = saved.endpoint || '';
  model.value = saved.model || '';
  key.value = GM_getValue('apiKey', '');
  remember.checked = Boolean(key.value);

  start.onclick = () => {
    engine.pause();
    GM_setValue('config', { ...GM_getValue('config', {}), enabled: false });
    try {
      const config = normalizeConfig({ endpoint: endpoint.value, model: model.value, key: key.value });
      GM_setValue('config', { endpoint: config.endpoint, model: config.model, enabled: true });
      if (remember.checked) GM_setValue('apiKey', config.key);
      else GM_deleteValue('apiKey');
      endpoint.value = config.endpoint;
      engine.start(config);
    } catch (error) { setStatus(error.message, 'paused'); }
  };
  pause.onclick = () => {
    engine.pause();
    GM_setValue('config', { ...GM_getValue('config', {}), enabled: false });
  };
  clear.onclick = () => { engine.clearCache(); setStatus('缓存已清除；当前中文保持不变。', engine.active ? 'running' : 'paused'); };
  forget.onclick = () => {
    engine.pause('Key 已清除，自动翻译已暂停。');
    engine.config = undefined;
    key.value = '';
    remember.checked = false;
    GM_deleteValue('apiKey');
    GM_setValue('config', { ...GM_getValue('config', {}), enabled: false });
  };
  GM_registerMenuCommand('abceed AI 翻译设置', () => show(true));
  if (saved.enabled && key.value) {
    try { engine.start(normalizeConfig({ ...saved, key: key.value })); }
    catch (error) { setStatus(error.message, 'paused'); }
  } else if (!saved.endpoint) show(true);
})();
