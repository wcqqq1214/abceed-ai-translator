// Adapt only known abceed graphics; other SVGs and canvases remain untouched.
export function adaptPlayerLabels(doc) {
  for (const svg of doc.querySelectorAll('.sound-controller-sub-component button svg')) {
    const glyph = [...svg.querySelectorAll('path')].find(path => path.getAttribute('d')?.startsWith('M6.66 15.26v-1.04h4.75'));
    if (!glyph) continue;
    const existing = svg.querySelector('[data-abceed-ai-label]');
    if (existing) {
      const fill = glyph.getAttribute('fill') || '#fff';
      if (existing.getAttribute('fill') !== fill) existing.setAttribute('fill', fill);
      continue;
    }
    const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('data-abceed-ai-label', '');
    text.setAttribute('x', '24'); text.setAttribute('y', '12');
    text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-size', '9'); text.setAttribute('font-family', 'sans-serif');
    text.setAttribute('fill', glyph.getAttribute('fill') || '#fff');
    text.setAttribute('pointer-events', 'none');
    text.textContent = '自動遷移';
    glyph.style.display = 'none';
    svg.append(text);
  }
}

export function attachCanvasTranslation(doc, win, pageWindow, engine) {
  const prototype = pageWindow.CanvasRenderingContext2D?.prototype;
  if (!prototype) return { destroy() {} };
  const entries = new Map();
  const pointers = new WeakMap();
  const frames = new Set();
  const isChart = canvas => win.location.pathname === '/learning-records' && canvas?.ownerDocument === doc && /(?:学習時間|学習問題数)の推移グラフ/.test(canvas.getAttribute('aria-label') || '');
  const pointer = event => { if (isChart(event.target)) pointers.set(event.target, { clientX: event.clientX, clientY: event.clientY }); };
  const leave = event => pointers.delete(event.target);
  doc.addEventListener('mousemove', pointer, true);
  doc.addEventListener('mouseout', leave, true);
  const redraw = canvas => {
    if (frames.has(canvas)) return;
    frames.add(canvas);
    win.requestAnimationFrame(() => {
      frames.delete(canvas);
      const point = pointers.get(canvas);
      if (point && canvas.isConnected && engine.active) canvas.dispatchEvent(new win.MouseEvent('mousemove', { ...point, bubbles: true }));
    });
  };
  const translate = (canvas, value) => {
    if (!engine.active || !isChart(canvas) || typeof value !== 'string' || value.length > 200 || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return value;
    const cached = engine.cache.get(value.trim());
    if (cached !== undefined) return value.replace(value.trim(), cached);
    for (const [oldCanvas, nodes] of entries) if (!oldCanvas.isConnected) {
      for (const node of nodes.values()) engine.extraNodes.delete(node);
      entries.delete(oldCanvas);
    }
    let nodes = entries.get(canvas);
    if (!nodes) { nodes = new Map(); entries.set(canvas, nodes); }
    const previous = nodes.get(value);
    if (previous && previous.nodeValue !== value) {
      previous.nodeValue = value;
      engine.written.delete(previous);
      engine.schedule();
    }
    if (!nodes.has(value) && nodes.size < 128) {
      // A virtual attribute lets the usual queue handle AI, cache, budget and retries.
      let current = value;
      const node = { nodeType: 2, ownerElement: canvas, get nodeValue() { return current; }, set nodeValue(text) { current = text; redraw(canvas); } };
      nodes.set(value, node);
      engine.extraNodes.add(node);
      engine.schedule();
    }
    return value;
  };
  const originals = new Map();
  for (const name of ['fillText', 'strokeText', 'measureText']) {
    const original = prototype[name];
    if (typeof original !== 'function') continue;
    const wrapped = function(text, ...args) { return Reflect.apply(original, this, [translate(this.canvas, text), ...args]); };
    prototype[name] = wrapped;
    originals.set(name, { original, wrapped });
  }
  return { destroy() {
    for (const [name, { original, wrapped }] of originals) if (prototype[name] === wrapped) prototype[name] = original;
    for (const nodes of entries.values()) for (const node of nodes.values()) engine.extraNodes.delete(node);
    entries.clear(); pointers.delete(doc.activeElement);
    doc.removeEventListener('mousemove', pointer, true);
    doc.removeEventListener('mouseout', leave, true);
  } };
}
