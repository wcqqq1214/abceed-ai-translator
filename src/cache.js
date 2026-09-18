// Revisions describe translation behavior, not extension releases. Cosmetic updates keep caches.
export const PAGE_TRANSLATION_REVISION = 1;
export const WORD_TRANSLATION_REVISION = 2;
export function translationScope(config, kind = 'page') {
  const base = `${config.endpoint}\n${config.model}`;
  if (kind === 'word') return `${base}\nword-v${WORD_TRANSLATION_REVISION}`;
  // Keep the existing Japanese cache while its translation policy is unchanged.
  return PAGE_TRANSLATION_REVISION === 1 ? base : `${base}\npage-v${PAGE_TRANSLATION_REVISION}`;
}
export const wordCacheKey = (word, context = '') => context ? `context:${JSON.stringify([word, context])}` : word;

const CACHE_LIMIT = 1000;
const CACHE_CHAR_LIMIT = 1000000;

export class TranslationCache {
  constructor({ read = () => undefined, write = () => {}, limit = CACHE_LIMIT, maxChars = CACHE_CHAR_LIMIT } = {}) {
    Object.assign(this, { read, write, limit, maxChars });
    this.items = new Map();
    this.pending = new Map();
    this.scope = '';
  }

  decode(snapshot) {
    if (![1, 2].includes(snapshot?.version) || snapshot.scope !== this.scope || !Array.isArray(snapshot.entries)) return [];
    // Keep existing v1 translations, ignoring their former expiry timestamps.
    return snapshot.entries.filter(entry => Array.isArray(entry) &&
      entry.length === (snapshot.version === 1 ? 3 : 2) &&
      typeof entry[0] === 'string' && entry[0].length > 0 && entry[0].length <= 16000 &&
      typeof entry[1] === 'string' && entry[1].length > 0 && entry[1].length <= 48000 &&
      (snapshot.version === 2 || Number.isFinite(entry[2])))
      .map(([source, text]) => [source, text]);
  }

  load(scope) {
    this.scope = scope;
    this.items.clear();
    this.pending.clear();
    try {
      for (const [source, text] of this.decode(this.read())) this.items.set(source, { text });
    } catch { /* A storage failure must not prevent translation. */ }
    this.trim();
  }

  trim() {
    let chars = 0;
    for (const [source, entry] of this.items) {
      chars += source.length + entry.text.length;
    }
    while (this.items.size > this.limit || chars > this.maxChars) {
      const source = this.items.keys().next().value;
      chars -= source.length + this.items.get(source).text.length;
      this.items.delete(source);
      this.pending.delete(source);
    }
  }

  get(source) {
    const entry = this.items.get(source);
    if (!entry) return undefined;
    // Retain frequently used menu labels when the bounded cache fills up.
    this.items.delete(source);
    this.items.set(source, entry);
    return entry.text;
  }

  set(source, text) {
    const entry = { text };
    this.items.delete(source);
    this.items.set(source, entry);
    this.pending.set(source, entry);
    this.trim();
  }

  values() {
    this.trim();
    return [...this.items.values()].map(entry => entry.text);
  }

  flush() {
    if (!this.pending.size) return;
    try {
      // Merge only new results, so two tabs do not erase each other's translations.
      const merged = new Map(this.items);
      for (const [source, text] of this.decode(this.read())) merged.set(source, { text });
      for (const [source, entry] of this.pending) { merged.delete(source); merged.set(source, entry); }
      this.items = merged;
      this.trim();
      this.write({ version: 2, scope: this.scope, entries: [...this.items].map(([source, entry]) => [source, entry.text]) });
      this.pending.clear();
    } catch { /* Keep in-memory results if persistence is unavailable. */ }
  }

  clear() {
    this.items.clear();
    this.pending.clear();
    try { this.write({ version: 2, scope: this.scope, entries: [] }); }
    catch { /* In-memory clearing remains available. */ }
  }
}
