import { normalizeConfig, createTranslator } from './core.js';
import { TranslationEngine } from './engine.js';
import { TranslationCache } from './cache.js';

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
    :host{all:initial;color-scheme:light;font-family:"PingFang SC",-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;font-weight:400;line-height:1.5;color:#262932;-webkit-font-smoothing:antialiased}
    *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;transition:background .16s,box-shadow .16s,transform .16s}button:focus-visible,summary:focus-visible{outline:3px solid #fda4af;outline-offset:3px}button:active{transform:translateY(1px)}
    [hidden]{display:none!important}svg{display:block;flex:none;width:18px;height:18px}h2,p{margin:0}
    .toggle{display:flex;align-items:center;gap:9px;margin-left:auto;padding:11px 15px;border:1px solid #e6e7eb;border-radius:15px;background:#fff;color:#333640;box-shadow:0 3px 8px #17203308,0 8px 28px #17203312;font-weight:500;font-size:14px;letter-spacing:.01em}
    .toggle:hover{background:#fff8f9;border-color:#fecdd3}.toggle>svg{color:#e74764}.toggle .dot{margin-left:3px}
    .dot{display:inline-block;flex:none;width:7px;height:7px;border-radius:50%;background:#a0a5af}.toggle[data-state=running] .dot,.status-card[data-state=running] .dot{background:#27a779;box-shadow:0 0 0 3px #27a77910}
    .panel{width:min(380px,calc(100vw - 32px));max-height:calc(100dvh - 94px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#dadde3 transparent;background:#fff;border:1px solid #e7e8ed;border-radius:22px;margin-bottom:12px;box-shadow:0 12px 48px #1720331c,0 2px 8px #17203306;text-align:left}
    .header{display:flex;align-items:center;gap:11px;padding:18px 22px 15px}.brand{display:grid;place-items:center;width:38px;height:38px;border:1px solid #ffe1e7;border-radius:12px;background:#fff3f5;color:#e74764}.brand svg{width:21px;height:21px}h2{font-size:17px;font-weight:600;letter-spacing:.01em}.subtitle{font-size:12px;color:#7d8490;margin-top:3px}
    .close{display:grid;place-items:center;margin-left:auto;align-self:flex-start;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:#969ba5}.close:hover{background:#f3f4f6;color:#333640}.close svg{width:16px;height:16px}
    .content{padding:0 22px 20px}.status-card{padding:11px 13px;background:#f6f7f9;border:1px solid #eceef2;border-radius:12px;margin-bottom:15px}.status-card[data-state=running]{background:#f3faf7;border-color:#e2f1e9}.status-heading{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500}.status-detail{font-size:12px;line-height:1.7;color:#717a87;margin-top:4px;overflow-wrap:anywhere}
    .field{margin-top:10px}.field:first-of-type{margin-top:0}label{display:block;font-size:13px;font-weight:500;color:#505663;margin-bottom:6px}
    input:not([type=checkbox]){display:block;width:100%;height:38px;padding:8px 11px;border:1px solid #e4e6ec;border-radius:9px;background:#fcfcfd;color:#333946;font-size:13px;outline:none;transition:border .15s,box-shadow .15s}input:not([type=checkbox]):focus{border-color:#ee8da0;box-shadow:0 0 0 3px #fdf0f3;background:#fff}input::placeholder{color:#b0b5bf}.field-hint{font-size:11px;color:#858d99;margin-top:5px;line-height:1.6}
    .check{display:flex;align-items:center;gap:7px;margin:12px 0 15px;font-size:12px;font-weight:400;color:#737c89;cursor:pointer}.check input{appearance:auto;accent-color:#e74764;width:13px;height:13px;margin:0}
    .actions{display:flex;gap:8px}.actions button{height:39px;border:1px solid #e4e6ec;border-radius:9px;padding:0 14px;background:#fff;color:#667080;font-size:13px;font-weight:500}.actions button:hover{background:#f7f8fa}.actions .primary{flex:1;background:#e74764;color:#fff;border-color:#e74764;box-shadow:0 3px 7px #e7476414}.actions .primary:hover{background:#d73b57;border-color:#d73b57}
    .cache-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding-top:13px;border-top:1px solid #f0f1f4}.cache-title{font-size:12px;color:#666e7c;font-weight:500}.cache-note{font-size:11px;color:#858e9b;margin-top:2px}.text-button{padding:5px 0;border:0;background:none;color:#737e8d;font-size:12px}.text-button:hover{color:#d73b57}.footer{display:flex;align-items:center;gap:12px;padding:12px 22px;background:#fafafb;border-top:1px solid #f0f1f4}.foot{flex:1;font-size:11px;line-height:1.7;color:#858e9b}.footer .text-button{font-size:11px;flex:none}
    @media(prefers-reduced-motion:reduce){button,input{transition:none}button:active{transform:none}}
    @media(max-width:420px){.header{padding:17px 18px 15px}.content{padding:0 18px 17px}.footer{padding:11px 18px}.panel{border-radius:18px}}
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
  el('h2', '翻译设置', heading);
  el('p', '日文转中文，英语保持原样', heading, 'subtitle');
  const close = el('button', '', header, 'close');
  icon('close', close);
  close.setAttribute('aria-label', '关闭设置');
  const content = el('div', '', panel, 'content');
  const statusCard = el('div', '', content, 'status-card');
  const statusHeading = el('div', '', statusCard, 'status-heading');
  el('span', '', statusHeading, 'dot');
  const statusTitle = el('span', '等待配置', statusHeading);
  const status = el('p', '连接 AI 服务后，即可自动翻译。', statusCard, 'status-detail');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const field = (name, id, placeholder, type = 'text', hint = '') => {
    const group = el('div', '', content, 'field');
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
  const rememberLabel = el('label', '', content, 'check');
  const remember = el('input', '', rememberLabel);
  remember.type = 'checkbox';
  el('span', '记住密钥，下次自动连接', rememberLabel);
  const row = el('div', '', content, 'actions');
  const start = el('button', '保存并开启', row, 'primary');
  const pause = el('button', '暂停', row);
  const cacheRow = el('div', '', content, 'cache-row');
  const cacheInfo = el('div', '', cacheRow);
  el('p', '本地翻译缓存', cacheInfo, 'cache-title');
  el('p', '不自动过期 · 再次访问直接显示', cacheInfo, 'cache-note');
  const clear = el('button', '清除缓存', cacheRow, 'text-button');
  const footer = el('div', '', panel, 'footer');
  el('p', '新内容由 AI 处理并可能计费，请关闭浏览器整页翻译。', footer, 'foot');
  const forget = el('button', '移除密钥', footer, 'text-button');
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
    const detail = text.replace(/^自动翻译中 · /, '');
    if (status.textContent !== detail) status.textContent = detail;
    statusCard.dataset.state = state || '';
    toggle.dataset.state = state || '';
    statusTitle.textContent = state === 'running' ? '自动翻译中' : state === 'paused' ? '已暂停' : '等待配置';
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
  clear.onclick = () => { engine.clearCache(); setStatus('本地译文缓存已清除；当前中文保持不变。', engine.active ? 'running' : 'paused'); };
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
