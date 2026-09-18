const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 1000;
const CACHE_CHAR_LIMIT = 1000000;

export class TranslationCache {
  constructor({ read = () => undefined, write = () => {}, now = Date.now, ttl = CACHE_TTL, limit = CACHE_LIMIT, maxChars = CACHE_CHAR_LIMIT } = {}) {
    Object.assign(this, { read, write, now, ttl, limit, maxChars });
    this.items = new Map();
    this.pending = new Map();
    this.scope = '';
  }

  decode(snapshot) {
    if (snapshot?.version !== 1 || snapshot.scope !== this.scope || !Array.isArray(snapshot.entries)) return [];
    const now = this.now();
    return snapshot.entries.filter(entry => Array.isArray(entry) && entry.length === 3 &&
      typeof entry[0] === 'string' && entry[0].length > 0 && entry[0].length <= 16000 &&
      typeof entry[1] === 'string' && entry[1].length > 0 && entry[1].length <= 48000 &&
      Number.isFinite(entry[2]) && entry[2] > now && entry[2] <= now + this.ttl);
  }

  load(scope) {
    this.scope = scope;
    this.items.clear();
    this.pending.clear();
    try {
      for (const [source, text, expires] of this.decode(this.read())) this.items.set(source, { text, expires });
    } catch { /* A storage failure must not prevent translation. */ }
    this.trim();
  }

  trim() {
    let chars = 0;
    for (const [source, entry] of this.items) {
      if (entry.expires <= this.now()) { this.items.delete(source); this.pending.delete(source); }
      else chars += source.length + entry.text.length;
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
    if (entry.expires <= this.now()) { this.items.delete(source); return undefined; }
    // Retain frequently used menu labels when the bounded cache fills up.
    this.items.delete(source);
    this.items.set(source, entry);
    return entry.text;
  }

  set(source, text) {
    const entry = { text, expires: this.now() + this.ttl };
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
      for (const [source, text, expires] of this.decode(this.read())) merged.set(source, { text, expires });
      for (const [source, entry] of this.pending) { merged.delete(source); merged.set(source, entry); }
      this.items = merged;
      this.trim();
      this.write({ version: 1, scope: this.scope, entries: [...this.items].map(([source, entry]) => [source, entry.text, entry.expires]) });
      this.pending.clear();
    } catch { /* Keep in-memory results if persistence is unavailable. */ }
  }

  clear() {
    this.items.clear();
    this.pending.clear();
    try { this.write({ version: 1, scope: this.scope, entries: [] }); }
    catch { /* In-memory clearing remains available. */ }
  }
}
