import { hasJapanese, MAX_TEXT, MAX_BATCH_CHARS, MAX_BATCH_ITEMS, SESSION_BUDGET } from './core.js';
import { TranslationCache } from './cache.js';

const EXCLUDE = 'script,style,noscript,textarea,input,select,option,code,pre,svg,math,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-abceed-ai-ui]';

export function visibleTextNode(node, win) {
  const element = node.parentElement;
  if (!element || element.closest(EXCLUDE)) return false;
  for (let parent = element; parent; parent = parent.parentElement) {
    if (parent.hidden || parent.getAttribute('aria-hidden') === 'true') return false;
    const style = win.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  const range = node.ownerDocument.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= win.innerHeight && rect.right >= 0 && rect.left <= win.innerWidth);
}

export class TranslationEngine {
  constructor({ doc, win, translate, onStatus = () => {}, isVisible = visibleTextNode, budget = SESSION_BUDGET, cache = new TranslationCache() }) {
    Object.assign(this, { doc, win, translate, onStatus, isVisible, budget });
    this.written = new WeakMap();
    this.cache = cache;
    this.cacheHits = 0;
    this.active = false;
    this.busy = false;
    this.generation = 0;
    this.used = 0;
    this.count = 0;
    this.lastURL = win.location.href;
  }

  attach() {
    this.observer = new this.win.MutationObserver(() => this.schedule());
    this.observer.observe(this.doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'class', 'style'] });
    this.onScroll = () => this.schedule();
    this.win.addEventListener('scroll', this.onScroll, true);
    this.win.addEventListener('resize', this.onScroll);
    this.doc.addEventListener('visibilitychange', this.onScroll);
    // Handles history changes and content becoming visible without a DOM mutation.
    this.interval = this.win.setInterval(() => {
      if (this.lastURL !== this.win.location.href) {
        this.lastURL = this.win.location.href;
        this.generation++;
        this.controller?.abort();
      }
      this.schedule();
    }, 1500);
  }

  start(config) {
    this.pause();
    const scope = `${config.endpoint}\n${config.model}`;
    if (scope !== this.cacheScope) this.cache.load(scope);
    this.cacheScope = scope;
    this.config = config;
    this.active = true;
    this.onStatus('自动翻译已开启，等待页面日文…', 'running');
    this.applyCached();
    this.schedule();
  }

  pause(message = '已暂停；已显示的中文保持不变。') {
    this.active = false;
    this.generation++;
    this.controller?.abort();
    this.win.clearTimeout(this.timer);
    this.timer = undefined;
    this.win.cancelAnimationFrame(this.cacheFrame);
    this.cacheFrame = undefined;
    this.onStatus(message, 'paused');
  }

  clearCache() {
    const config = this.config;
    const wasActive = this.active;
    // Prevent an in-flight result from repopulating a cache the user just cleared.
    this.pause();
    this.cache.clear();
    this.cacheHits = 0;
    if (wasActive) this.start(config);
  }

  applyCached() {
    if (!this.active || this.doc.hidden) return;
    const walker = this.doc.createTreeWalker(this.doc.body, this.win.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const source = node.nodeValue;
      if (this.written.get(node) === source || !hasJapanese(source)) continue;
      const cached = this.cache.get(source.trim());
      if (cached !== undefined && this.isVisible(node, this.win)) { this.write(node, source, cached); this.cacheHits++; }
    }
  }

  schedule() {
    if (!this.active) return;
    // Local hits have a separate fast path, including while AI requests are pending.
    if (!this.cacheFrame) this.cacheFrame = this.win.requestAnimationFrame(() => {
      this.cacheFrame = undefined;
      this.applyCached();
    });
    if (this.busy || this.timer) return;
    this.timer = this.win.setTimeout(() => {
      this.timer = undefined;
      this.tick();
    }, 750);
  }

  write(node, source, translated) {
    if (!node.isConnected || node.nodeValue !== source || !this.isVisible(node, this.win)) return;
    const leading = source.match(/^\s*/)[0];
    const trailing = source.match(/\s*$/)[0];
    const value = leading + translated + trailing;
    this.written.set(node, value);
    node.nodeValue = value;
    this.count++;
  }

  async tick() {
    if (!this.active || this.busy || this.doc.hidden) return;
    const generation = this.generation;
    const url = this.win.location.href;
    const groups = new Map();
    const translatedValues = new Set(this.cache.values());
    let size = 0, oversized = 0;
    const walker = this.doc.createTreeWalker(this.doc.body, this.win.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const source = node.nodeValue;
      if (this.written.get(node) === source || !hasJapanese(source) || !this.isVisible(node, this.win)) continue;
      const text = source.trim();
      if (translatedValues.has(text)) continue;
      if (text.length > MAX_TEXT) { oversized++; continue; }
      const cached = this.cache.get(text);
      if (cached !== undefined) { this.write(node, source, cached); this.cacheHits++; continue; }
      if (groups.has(text)) { groups.get(text).push({ node, source }); continue; }
      if (groups.size >= MAX_BATCH_ITEMS || (groups.size && size + text.length > MAX_BATCH_CHARS)) continue;
      groups.set(text, [{ node, source }]);
      size += text.length;
    }
    if (!groups.size) {
      this.onStatus(`自动翻译中${oversized ? ` · ${oversized} 处文本过长，未发送` : ''}`, 'running');
      return;
    }
    if (this.used + size > this.budget) {
      this.pause('本标签页已达到 50,000 字符额度，已暂停。需要继续时请刷新页面。');
      return;
    }
    this.busy = true;
    this.used += size;
    const controller = new AbortController();
    this.controller = controller;
    this.onStatus(`AI 正在翻译 ${groups.size} 段日文…`, 'running');
    try {
      const texts = [...groups.keys()];
      const results = await this.translate(texts, this.config, controller.signal);
      if (!this.active || generation !== this.generation || url !== this.win.location.href) return;
      if (!Array.isArray(results) || results.length !== texts.length) throw new Error('译文数量不正确。');
      for (let i = 0; i < texts.length; i++) {
        this.cache.set(texts[i], results[i]);
        for (const { node, source } of groups.get(texts[i])) this.write(node, source, results[i]);
      }
      this.cache.flush();
    } catch (error) {
      if (generation === this.generation && this.active) this.pause(error.message);
    } finally {
      this.busy = false;
      if (this.controller === controller) this.controller = undefined;
      this.schedule();
    }
  }

  destroy() {
    this.pause();
    this.observer?.disconnect();
    this.win.clearInterval(this.interval);
    this.win.removeEventListener('scroll', this.onScroll, true);
    this.win.removeEventListener('resize', this.onScroll);
    this.doc.removeEventListener('visibilitychange', this.onScroll);
  }
}
