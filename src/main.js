import { attachFrameBridge, attachContentLookup, attachAutoFrameBridge } from './frames.js';
import { normalizeConfig, createTranslator } from './core.js';
import { TranslationEngine } from './engine.js';
import { TranslationCache } from './cache.js';
import { WordLookup, createWordTranslator, createSelectionTranslator } from './words.js';

(() => {
  if (document.querySelector('[data-abceed-ai-ui]')) return;
  if (window.top !== window) { attachContentLookup(document, window); return; }
  // The site's selection toolbar duplicates the AI lookup popup.
  const selectionStyle = document.createElement('style');
  selectionStyle.textContent = '.selected-word:has(> .selected-word__inner),.selected-word:has(> .selected-word__inner) ~ .arrow-icon{display:none!important}';
  document.documentElement.append(selectionStyle);
  const host = document.createElement('div');
  host.setAttribute('data-abceed-ai-ui', '');
  host.setAttribute('translate', 'no');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  // Keep API settings out of the page's DOM and avoid site CSS interference.
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial;color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;font-weight:400;line-height:1.5;color:#262932;-webkit-font-smoothing:antialiased}
    *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;transition:background .16s,box-shadow .16s,transform .16s}button:focus-visible,summary:focus-visible{outline:3px solid #fda4af;outline-offset:3px}button:active{transform:translateY(1px)}
    [hidden]{display:none!important}svg{display:block;flex:none;width:18px;height:18px}h2,p{margin:0}
    .toggle{display:flex;align-items:center;gap:7px;margin-left:auto;padding:9px 12px;border:1px solid #e6e7eb;border-radius:15px;background:#fff;color:#333640;box-shadow:0 3px 8px #17203308,0 8px 28px #17203312;font-weight:400;font-size:13px;letter-spacing:.01em}
    .toggle:hover{background:#fff8f9;border-color:#fecdd3}.toggle>svg{color:#e74764}.toggle .dot{margin-left:3px}
    .dot{display:inline-block;flex:none;width:7px;height:7px;border-radius:50%;background:#a0a5af}.toggle[data-state=running] .dot,.status-card[data-state=running] .dot{background:#27a779;box-shadow:0 0 0 3px #27a77910}
    .panel{width:min(340px,calc(100vw - 32px));max-height:calc(100dvh - 94px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#dadde3 transparent;background:#fff;border:1px solid #e7e8ed;border-radius:18px;margin-bottom:10px;box-shadow:0 8px 32px #17203314,0 2px 6px #17203306;text-align:left}
    .header{display:flex;align-items:center;gap:11px;padding:16px 20px 14px}.brand{display:grid;place-items:center;width:32px;height:32px;border:1px solid #ffe1e7;border-radius:12px;background:#fff3f5;color:#e74764}.brand svg{width:21px;height:21px}h2{font-size:15px;font-weight:500;letter-spacing:.01em}.subtitle{font-size:12px;color:#7d8490;margin-top:3px}
    .close{display:grid;place-items:center;margin-left:auto;align-self:flex-start;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:#969ba5}.close:hover{background:#f3f4f6;color:#333640}.close svg{width:16px;height:16px}
    .content{padding:0 20px 16px}.status-card{padding:11px 13px;background:#f6f7f9;border:1px solid #eceef2;border-radius:12px;margin-bottom:10px}.status-card[data-state=running]{background:#f3faf7;border-color:#e2f1e9}.status-heading{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500}.status-detail{font-size:12px;line-height:1.7;color:#717a87;margin-top:4px;overflow-wrap:anywhere}
    .field{margin-top:10px}.field:first-of-type{margin-top:0}label{display:block;font-size:13px;font-weight:500;color:#505663;margin-bottom:6px}
    input:not([type=checkbox]){display:block;width:100%;height:38px;padding:8px 11px;border:1px solid #e4e6ec;border-radius:9px;background:#fcfcfd;color:#333946;font-size:13px;outline:none;transition:border .15s,box-shadow .15s}input:not([type=checkbox]):focus{border-color:#ee8da0;box-shadow:0 0 0 3px #fdf0f3;background:#fff}input::placeholder{color:#b0b5bf}.field-hint{font-size:11px;color:#858d99;margin-top:5px;line-height:1.6}
    .check{display:flex;align-items:center;gap:7px;margin:12px 0 15px;font-size:12px;font-weight:400;color:#737c89;cursor:pointer}.check input{appearance:auto;accent-color:#e74764;width:13px;height:13px;margin:0}
    .actions{display:flex;gap:8px}.actions button{height:39px;white-space:nowrap;border:1px solid #e4e6ec;border-radius:9px;padding:0 10px;background:#fff;color:#667080;font-size:13px;font-weight:500}.actions button:hover{background:#f7f8fa}.actions .primary{flex:1;background:#e74764;color:#fff;border-color:#e74764;box-shadow:0 3px 7px #e7476414}.actions .primary:hover{background:#d73b57;border-color:#d73b57}
    .control-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.control-state{font-size:11px;color:#7d8792;margin-top:3px}.auto-switch{position:relative;flex:none;width:34px;height:20px;border:0;border-radius:12px;background:#c8cdd4;padding:0}.auto-switch::after{content:"";position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transition:transform .15s}.auto-switch[aria-checked=true]{background:#27a779}.auto-switch[aria-checked=true]::after{transform:translateX(14px)}.manual-hint{font-size:11px;color:#929aa5;line-height:1.6;margin:0 1px 13px}.connection{border-top:1px solid #eef0f3}.connection summary{display:flex;align-items:center;justify-content:space-between;padding:12px 0;cursor:pointer;list-style:none;color:#667080;font-size:12px}.connection summary::-webkit-details-marker{display:none}.connection summary::after{content:"⌄";font-size:15px;color:#9aa1aa}.connection[open] summary::after{transform:rotate(180deg)}.connection-body{padding-bottom:13px}.cache-footer{display:flex;justify-content:flex-end;border-top:1px solid #eef0f3;padding-top:10px}.cache-clear{border:0;background:none;padding:3px 0;font-size:11px;color:#949ba5}.cache-clear:hover{color:#d73b57}
    @media(prefers-reduced-motion:reduce){button,input{transition:none}button:active{transform:none}}
    @media(max-width:420px){.header{padding:17px 18px 15px}.content{padding:0 18px 17px}.actions{gap:6px}.actions button{padding:0 10px}.panel{border-radius:18px}}
  `;
  root.append(style);
  const el = (tag, text, parent = root, className = '') => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    parent.append(node);
    return node;
  };
  const icon = (name, parent) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
    const paths = name === 'close' ? ['M6 6l12 12M18 6L6 18'] : ['M3 5h12M9 3v2M5 5c1 5 4 8 8 10M13 5c-1 5-4 8-8 10', 'm13 21 4-10 4 10M14.5 17h5'];
    for (const d of paths) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path); }
    parent.append(svg);
  };
  const panel = el('section', '', root, 'panel');
  panel.id = 'abceed-ai-settings';
  panel.setAttribute('aria-label', 'AI 翻译设置');
  const header = el('div', '', panel, 'header');
  icon('translate', el('div', '', header, 'brand'));
  const heading = el('div', '', header);
  el('h2', 'AI 翻译', heading);
  el('p', '自动翻译 · 双击查词 · 划选翻译', heading, 'subtitle');
  const close = el('button', '', header, 'close');
  icon('close', close);
  close.setAttribute('aria-label', '关闭设置');
  const content = el('div', '', panel, 'content');
  const statusCard = el('div', '', content, 'status-card');
  const controlRow = el('div', '', statusCard, 'control-row');
  const controlText = el('div', '', controlRow);
  el('p', '日文自动翻译', controlText, 'status-heading');
  const statusTitle = el('p', '等待配置', controlText, 'control-state');
  const autoSwitch = el('button', '', controlRow, 'auto-switch');
  autoSwitch.setAttribute('role', 'switch');
  autoSwitch.setAttribute('aria-label', '日文自动翻译');
  autoSwitch.setAttribute('aria-checked', 'false');
  const status = el('p', '连接 AI 服务后，即可自动翻译。', statusCard, 'status-detail');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  el('p', '暂停自动翻译后，双击查词和划选翻译仍可使用。', content, 'manual-hint');
  const connection = el('details', '', content, 'connection');
  el('summary', '接口设置', connection);
  const connectionBody = el('div', '', connection, 'connection-body');
  const field = (name, id, placeholder, type = 'text', hint = '') => {
    const group = el('div', '', connectionBody, 'field');
    const label = el('label', name, group);
    label.htmlFor = id;
    const input = el('input', '', group);
    Object.assign(input, { id, type, placeholder, spellcheck: false, autocomplete: 'off' });
    if (hint) { const help = el('p', hint, group, 'field-hint'); help.id = `${id}-hint`; input.setAttribute('aria-describedby', help.id); }
    return input;
  };
  const endpoint = field('接口地址', 'endpoint', 'https://api.deepseek.com', 'url', '支持 OpenAI 兼容接口与完整请求地址');
  const model = field('模型', 'model', '例如 deepseek-flash');
  const key = field('API 密钥', 'key', '填写服务商提供的 API Key', 'password');
  const rememberLabel = el('label', '', connectionBody, 'check');
  const remember = el('input', '', rememberLabel);
  remember.type = 'checkbox';
  el('span', '记住密钥，下次自动连接', rememberLabel);
  const row = el('div', '', connectionBody, 'actions');
  const start = el('button', '保存并开启', row, 'primary');
  const cacheFooter = el('div', '', content, 'cache-footer');
  const clear = el('button', '清除缓存', cacheFooter, 'cache-clear');
  const toggle = el('button', '', root, 'toggle');
  icon('translate', toggle);
  el('span', 'AI 翻译', toggle);
  el('span', '', toggle, 'dot');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', panel.id);
  toggle.setAttribute('aria-label', '打开翻译设置');
  document.documentElement.append(host);

  const show = visible => {
    panel.hidden = !visible;
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.setAttribute('aria-label', visible ? '收起翻译设置' : '打开翻译设置');
  };
  show(false);
  toggle.onclick = () => show(panel.hidden);
  close.onclick = () => show(false);
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { show(false); toggle.focus(); }
  });
  const setStatus = (text, state) => {
    // Avoid DOM observer churn caused by identical status updates.
    const detail = text.replace(/^自动翻译中(?: · |$)/, '').replace(/^已暂停；已显示的中文保持不变。$/, '');
    if (status.textContent !== detail) status.textContent = detail;
    status.hidden = !detail;
    statusCard.dataset.state = state || '';
    toggle.dataset.state = state || '';
    statusTitle.textContent = state === 'running' ? '已开启' : state === 'paused' ? '已暂停' : '等待配置';
    autoSwitch.setAttribute('aria-checked', String(state === 'running'));
    autoSwitch.title = state === 'running' ? '暂停自动翻译' : '开启自动翻译';
    toggle.title = text;
  };
  const cache = new TranslationCache({ read: () => GM_getValue('translationCache', undefined), write: snapshot => GM_setValue('translationCache', snapshot) });
  const engine = new TranslationEngine({ doc: document, win: window, translate: createTranslator(GM_xmlhttpRequest), onStatus: setStatus, cache });
  engine.attach();
  const saved = GM_getValue('config', {});
  endpoint.value = saved.endpoint || '';
  model.value = saved.model || '';
  key.value = GM_getValue('apiKey', '');
  remember.checked = Boolean(key.value);

  const words = new WordLookup({ doc: document, win: window, root,
    getConfig: () => normalizeConfig({ endpoint: endpoint.value, model: model.value, key: key.value }),
    translate: createWordTranslator(GM_xmlhttpRequest),
    translateSelection: createSelectionTranslator(GM_xmlhttpRequest),
    cache: new TranslationCache({ read: () => GM_getValue('wordCache', undefined), write: snapshot => GM_setValue('wordCache', snapshot) })
  });

  const autoFrameBridge = attachAutoFrameBridge({ win: window, doc: document, engine });
  const frameBridge = attachFrameBridge({ win: window, doc: document, getConfig: words.getConfig,
    translate: words.translate, translateSelection: words.translateSelection, cache: words.cache });

  start.onclick = () => {
    autoFrameBridge.cancelAll();
    frameBridge.cancelAll();
    words.hide();
    engine.pause();
    GM_setValue('config', { ...GM_getValue('config', {}), enabled: false });
    try {
      const config = normalizeConfig({ endpoint: endpoint.value, model: model.value, key: key.value });
      GM_setValue('config', { endpoint: config.endpoint, model: config.model, enabled: true });
      if (remember.checked) GM_setValue('apiKey', config.key);
      else GM_deleteValue('apiKey');
      endpoint.value = config.endpoint;
      engine.start(config);
      connection.open = false;
    } catch (error) { connection.open = true; setStatus(error.message, 'paused'); }
  };
  autoSwitch.onclick = () => {
    if (!engine.active) { start.onclick(); return; }
    autoFrameBridge.cancelAll();
    engine.pause();
    GM_setValue('config', { ...GM_getValue('config', {}), enabled: false });
  };
  clear.onclick = () => { autoFrameBridge.cancelAll(); frameBridge.cancelAll(); words.clearCache(); engine.clearCache(); setStatus('本地译文缓存已清除；当前中文保持不变。', engine.active ? 'running' : 'paused'); };
  GM_registerMenuCommand('abceed AI 翻译设置', () => show(true));
  if (saved.enabled && key.value) {
    try { engine.start(normalizeConfig({ ...saved, key: key.value })); }
    catch (error) { setStatus(error.message, 'paused'); }
  }
  if (!saved.endpoint || !saved.model || !key.value) { connection.open = true; show(true); }
})();
