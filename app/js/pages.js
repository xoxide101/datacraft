/* DataCraft — page designer (invoices, record sheets, list reports), rendering with page breaks, printing. */
(function (DC) {
  'use strict';
  const { h, db, esc } = DC;
  const PX = 96 / 25.4; // CSS px per mm
  const SIZES = { letter: [215.9, 279.4, 'US Letter'], a4: [210, 297, 'A4'], legal: [215.9, 355.6, 'US Legal'] };
  const FONTS = { sans: 'Arial, Helvetica, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"Courier New", Consolas, monospace' };
  // Status-bar zoom (the same in every Craft app, like Word's): −, a slider with 100% in the middle (left half
  // 10–100%, right half 100% up to the most), +, the percentage (click to type) and Fit. Double-click the slider for 100%.
  // get() and set(percent) talk to the app; fit() fits the page. Returns { el, update }.
  function zoomBar({ get, set, fit, min = 10, max = 500 }) {
    if (!document.getElementById('zb-style')) {
      const st = document.createElement('style'); st.id = 'zb-style';
      st.textContent = '.zb{display:inline-flex;align-items:center;gap:4px;margin-left:auto;flex:none;font-size:12px}'
        + '.zb button{border:0;background:none;color:inherit;cursor:pointer;width:22px;height:22px;border-radius:5px;font:inherit;font-size:15px;line-height:1;display:grid;place-items:center;padding:0}'
        + '.zb button:hover{background:var(--line,rgba(0,0,0,.1))}.zb .zb-fit{width:auto;padding:0 6px;font-size:12px}'
        + '.zb input[type=range]{width:120px;height:4px;margin:0 2px;accent-color:var(--accent,#2f6fdd);cursor:pointer;background:linear-gradient(90deg,transparent calc(50% - 1px),currentColor calc(50% - 1px),currentColor calc(50% + 1px),transparent calc(50% + 1px))}'
        + '.zb .zb-pct{width:50px;height:22px;border:1px solid transparent;border-radius:5px;background:none;color:inherit;text-align:center;font:inherit;font-size:12px;font-variant-numeric:tabular-nums;padding:0}'
        + '.zb .zb-pct:hover,.zb .zb-pct:focus{border-color:var(--line,#bbb);background:var(--panel,#fff);outline:none}@media(max-width:700px){.zb input[type=range]{width:70px}}';
      document.head.append(st);
    }
    // slider position 0..1000 <-> percent: the middle (500) is always 100%
    const toPct = (v) => (v <= 500 ? min + (100 - min) * (v / 500) : 100 + (max - 100) * ((v - 500) / 500));
    const toPos = (p) => (p <= 100 ? ((p - min) / (100 - min)) * 500 : 500 + ((p - 100) / (max - 100)) * 500);
    const el = document.createElement('span'); el.className = 'zb'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Zoom'); el.dataset.rtSkip = '1';
    el.innerHTML = '<button type="button" class="zb-out" title="Zoom out" aria-label="Zoom out">−</button><input type="range" min="0" max="1000" step="1" aria-label="Zoom" title="Zoom (double-click for 100%)">'
      + '<button type="button" class="zb-in" title="Zoom in" aria-label="Zoom in">+</button><input class="zb-pct" type="text" inputmode="numeric" aria-label="Zoom percent" title="Type a zoom percent"><button type="button" class="zb-fit" title="Fit the whole page in the window">Fit</button>';
    const [out, r, inn, pct, fitB] = [el.querySelector('.zb-out'), el.querySelector('input[type=range]'), el.querySelector('.zb-in'), el.querySelector('.zb-pct'), el.querySelector('.zb-fit')];
    const clamp = (p) => Math.max(min, Math.min(max, Math.round(p)));
    const go = (p) => { set(clamp(p)); update(); };
    // + and − step through the usual zoom levels
    const STEPS = [10, 25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500, 600, 800].filter((s) => s >= min && s <= max);
    out.onclick = () => { const c = get(); go([...STEPS].reverse().find((s) => s < c - 0.5) ?? min); };
    inn.onclick = () => { const c = get(); go(STEPS.find((s) => s > c + 0.5) ?? max); };
    r.oninput = () => { let p = toPct(+r.value); if (Math.abs(+r.value - 500) < 12) p = 100; go(p); }; // snaps to 100% near the middle
    r.ondblclick = () => go(100);
    pct.onfocus = () => pct.select();
    pct.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { pct.blur(); } if (e.key === 'Escape') { update(); pct.blur(); } };
    pct.onchange = () => { const v = parseFloat(pct.value); if (isFinite(v)) go(v); else update(); };
    fitB.onclick = () => { fit(); update(); };
    function update() { const p = get(); if (!isFinite(p)) return; r.value = Math.round(toPos(Math.max(min, Math.min(max, p)))); if (document.activeElement !== pct) pct.value = Math.round(p) + '%'; }
    return { el, update };
  }
  // Fills and backgrounds (the same in every Craft app). A paint is { type, ... }:
  //   solid    { color }
  //   gradient { c1, c2, angle (deg), radial, dither }   dither adds fine noise so gradients do not show bands
  //   pattern  { pattern, fg, bg, size (tile size: mm in print apps, px in SiteCraft) }
  //   picture  { src, fit: cover | contain | tile | stretch, opacity }
  // Patterns are drawn on a small square tile, fg on bg (bg '' = see-through).
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const PATTERNS = [
    // dithers: ordered (Bayer) dots at a set darkness, a random dither and a halftone
    ...[12, 25, 37, 50, 62, 75, 88].map((p) => [`dither${p}`, `Dither ${p}%`, 'Dithers', (x, n, fg) => { const c = n / 4; x.fillStyle = fg; BAYER4.forEach((t, i) => { if ((t + 0.5) / 16 < p / 100) x.fillRect((i % 4) * c, Math.floor(i / 4) * c, c, c); }); }]),
    ['noise', 'Random dither 50%', 'Dithers', (x, n, fg) => { const c = n / 16; x.fillStyle = fg; let s = 12345; for (let i = 0; i < 256; i++) { s = (s * 16807) % 2147483647; if (s % 2) x.fillRect((i % 16) * c, Math.floor(i / 16) * c, c, c); } }],
    ['halftone', 'Halftone dots', 'Dithers', (x, n, fg) => { x.fillStyle = fg; [[0.25, 0.25], [0.75, 0.75]].forEach(([a, b]) => { x.beginPath(); x.arc(a * n, b * n, n * 0.2, 0, 7); x.fill(); }); }],
    // lines
    ['hstripes', 'Stripes across', 'Lines', (x, n, fg) => { x.fillStyle = fg; x.fillRect(0, 0, n, n / 2); }],
    ['vstripes', 'Stripes down', 'Lines', (x, n, fg) => { x.fillStyle = fg; x.fillRect(0, 0, n / 2, n); }],
    ['diag', 'Diagonal lines', 'Lines', (x, n, fg) => { x.strokeStyle = fg; x.lineWidth = n * 0.22; x.beginPath(); for (let k = -1; k <= 1; k++) { x.moveTo(k * n, n); x.lineTo(k * n + n, 0); } x.stroke(); }],
    ['diag2', 'Diagonal lines (other way)', 'Lines', (x, n, fg) => { x.strokeStyle = fg; x.lineWidth = n * 0.22; x.beginPath(); for (let k = -1; k <= 1; k++) { x.moveTo(k * n, 0); x.lineTo(k * n + n, n); } x.stroke(); }],
    ['pinstripe', 'Pinstripes', 'Lines', (x, n, fg) => { x.fillStyle = fg; x.fillRect(0, 0, Math.max(1, n * 0.1), n); }],
    ['grid', 'Grid', 'Lines', (x, n, fg) => { x.fillStyle = fg; const w = Math.max(1, n * 0.1); x.fillRect(0, 0, n, w); x.fillRect(0, 0, w, n); }],
    ['cross', 'Crosshatch', 'Lines', (x, n, fg) => { x.strokeStyle = fg; x.lineWidth = n * 0.12; x.beginPath(); for (let k = -1; k <= 1; k++) { x.moveTo(k * n, n); x.lineTo(k * n + n, 0); x.moveTo(k * n, 0); x.lineTo(k * n + n, n); } x.stroke(); }],
    ['zigzag', 'Zigzag', 'Lines', (x, n, fg) => { x.strokeStyle = fg; x.lineWidth = n * 0.14; x.beginPath(); x.moveTo(0, n * 0.7); x.lineTo(n / 2, n * 0.3); x.lineTo(n, n * 0.7); x.stroke(); }],
    ['waves', 'Waves', 'Lines', (x, n, fg) => { x.strokeStyle = fg; x.lineWidth = n * 0.12; x.beginPath(); x.moveTo(0, n / 2); x.bezierCurveTo(n * 0.25, n * 0.15, n * 0.25, n * 0.15, n / 2, n / 2); x.bezierCurveTo(n * 0.75, n * 0.85, n * 0.75, n * 0.85, n, n / 2); x.stroke(); }],
    // shapes
    ['checks', 'Checkerboard', 'Shapes', (x, n, fg) => { x.fillStyle = fg; x.fillRect(0, 0, n / 2, n / 2); x.fillRect(n / 2, n / 2, n / 2, n / 2); }],
    ['dots', 'Polka dots', 'Shapes', (x, n, fg) => { x.fillStyle = fg; x.beginPath(); x.arc(n / 2, n / 2, n * 0.18, 0, 7); x.fill(); }],
    ['bricks', 'Bricks', 'Shapes', (x, n, fg) => { x.fillStyle = fg; const w = Math.max(1, n * 0.08); x.fillRect(0, 0, n, w); x.fillRect(0, n / 2, n, w); x.fillRect(0, 0, w, n / 2); x.fillRect(n / 2, n / 2, w, n / 2); }],
    ['diamonds', 'Diamonds', 'Shapes', (x, n, fg) => { x.fillStyle = fg; x.beginPath(); x.moveTo(n / 2, n * 0.1); x.lineTo(n * 0.9, n / 2); x.lineTo(n / 2, n * 0.9); x.lineTo(n * 0.1, n / 2); x.fill(); }],
    ['scales', 'Fish scales', 'Shapes', (x, n, fg) => { x.strokeStyle = fg; x.lineWidth = n * 0.08; [[0, 0], [n, 0], [n / 2, n / 2], [0, n], [n, n]].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, n / 2, 0, Math.PI); x.stroke(); }); }],
    ['triangles', 'Triangles', 'Shapes', (x, n, fg) => { x.fillStyle = fg; x.beginPath(); x.moveTo(0, n); x.lineTo(n / 2, n * 0.15); x.lineTo(n, n); x.fill(); }],
    ['plus', 'Plus signs', 'Shapes', (x, n, fg) => { x.fillStyle = fg; const w = n * 0.12; x.fillRect(n / 2 - w / 2, n * 0.25, w, n / 2); x.fillRect(n * 0.25, n / 2 - w / 2, n / 2, w); }],
    ['stars', 'Little stars', 'Shapes', (x, n, fg) => { x.fillStyle = fg; x.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? n * 0.13 : n * 0.32, a = (i * Math.PI) / 5; x.lineTo(n / 2 + r * Math.sin(a), n / 2 - r * Math.cos(a)); } x.fill(); }],
    ['hearts', 'Little hearts', 'Shapes', (x, n, fg) => { x.fillStyle = fg; x.beginPath(); x.moveTo(n / 2, n * 0.78); x.bezierCurveTo(n * 0.1, n * 0.5, n * 0.2, n * 0.18, n / 2, n * 0.35); x.bezierCurveTo(n * 0.8, n * 0.18, n * 0.9, n * 0.5, n / 2, n * 0.78); x.fill(); }],
    ['weave', 'Basket weave', 'Shapes', (x, n, fg) => { x.fillStyle = fg; const h = n / 2, s = h / 6; for (let i = 0; i < 3; i++) { const o = i * (h / 3) + s / 2; x.fillRect(0, o, h, s); x.fillRect(h, h + o, h, s); x.fillRect(h + o, 0, s, h); x.fillRect(o, h, s, h); } }],
  ];
  const PATTERN_BY_ID = Object.fromEntries(PATTERNS.map((p) => [p[0], p]));
  // A pattern tile as a canvas `px` pixels square (crisp: no smoothing, whole pixels for dithers).
  function patternTile(id, fg = '#222222', bg = '#ffffff', px = 16) {
    // whole pixels per cell so dithers stay crisp: tiles are a multiple of 4 (16 for the random dither), at least 8 (24 for the weave)
    let n = Math.max(id === 'weave' ? 24 : 8, Math.round(px / 4) * 4); if (id === 'noise') n = Math.max(16, Math.round(n / 16) * 16);
    const c = document.createElement('canvas'); c.width = c.height = n;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, n, n); }
    (PATTERN_BY_ID[id] || PATTERNS[3])[3](x, n, fg || '#222222');
    return c;
  }
  // A gradient drawn into a canvas; with dither, a little noise (under one colour step) hides the bands of 8-bit colour.
  function gradientCanvas(w, h, f) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    const x = c.getContext('2d'), a = ((f.angle ?? 90) * Math.PI) / 180, cx = c.width / 2, cy = c.height / 2;
    let g;
    if (f.radial) g = x.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(cx, cy));
    else { const r = (Math.abs(Math.sin(a)) * c.width + Math.abs(Math.cos(a)) * c.height) / 2; g = x.createLinearGradient(cx - Math.sin(a) * r, cy + Math.cos(a) * r, cx + Math.sin(a) * r, cy - Math.cos(a) * r); }
    g.addColorStop(0, f.c1 || '#ffffff'); g.addColorStop(1, f.c2 || '#3f8be8');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    if (f.dither) ditherCanvas(c);
    return c;
  }
  // Fine dither: ordered noise of up to ±1 colour step, only where the colour changes smoothly (flat areas stay exact).
  function ditherCanvas(c) {
    const x = c.getContext('2d'), img = x.getImageData(0, 0, c.width, c.height), d = img.data, w = c.width;
    for (let i = 0; i < d.length; i += 4) {
      const p = i / 4, t = (BAYER4[(p % w) % 4 + ((Math.floor(p / w) % 4) * 4)] + 0.5) / 16 - 0.5;
      const right = i + 4 < d.length ? i + 4 : i - 4, down = i + w * 4 < d.length ? i + w * 4 : i - w * 4;
      for (let k = 0; k < 3; k++) { const v = d[i + k]; if (Math.abs(v - d[right + k]) <= 3 && Math.abs(v - d[down + k]) <= 3 && (v !== d[right + k] || v !== d[down + k])) d[i + k] = Math.max(0, Math.min(255, Math.round(v + t * 2.2))); }
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  // The whole fill painted into a w × h canvas (pixels). `img` is the loaded picture for picture fills; `unit` = tile pixels per size unit.
  function paintCanvas(w, h, f, img, unit = 1) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    const x = c.getContext('2d');
    if (!f || f.type === 'none') return c;
    if (f.type === 'solid') { x.fillStyle = f.color || '#ffffff'; x.fillRect(0, 0, c.width, c.height); }
    else if (f.type === 'gradient') x.drawImage(gradientCanvas(c.width, c.height, f), 0, 0);
    else if (f.type === 'pattern') { x.imageSmoothingEnabled = false; x.fillStyle = x.createPattern(patternTile(f.pattern, f.fg, f.bg, (f.size || 4) * unit), 'repeat'); x.fillRect(0, 0, c.width, c.height); }
    else if (f.type === 'picture' && img) {
      x.globalAlpha = f.opacity ?? 1;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, fit = f.fit || 'cover';
      if (fit === 'tile') { const k = ((f.size || 0) * unit) / iw || 1, t = document.createElement('canvas'); t.width = Math.max(1, iw * k); t.height = Math.max(1, ih * k); t.getContext('2d').drawImage(img, 0, 0, t.width, t.height); x.fillStyle = x.createPattern(t, 'repeat'); x.fillRect(0, 0, c.width, c.height); }
      else if (fit === 'stretch') x.drawImage(img, 0, 0, c.width, c.height);
      else { const k = (fit === 'cover' ? Math.max : Math.min)(c.width / iw, c.height / ih); x.drawImage(img, (c.width - iw * k) / 2, (c.height - ih * k) / 2, iw * k, ih * k); }
    }
    return c;
  }
  const paintImgCache = new Map();
  const loadPaintImg = (src) => { if (!src) return Promise.resolve(null); if (!paintImgCache.has(src)) paintImgCache.set(src, new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; })); return paintImgCache.get(src); };
  // A short description for lists and tooltips.
  const paintLabel = (f) => (!f || f.type === 'none' ? 'None' : f.type === 'solid' ? 'Colour' : f.type === 'gradient' ? (f.radial ? 'Round gradient' : 'Gradient') : f.type === 'pattern' ? (PATTERN_BY_ID[f.pattern] || ['', 'Pattern'])[1] : 'Picture');
  // Defaults when switching type, keeping the colours already chosen.
  function paintSwitch(f, type, base = '#3f8be8') {
    const c = (f && (f.color || f.c1 || f.fg)) || base;
    const light = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return false; const v = parseInt(m[1], 16); return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) > 200; };
    const ink = light(c) ? '#3f6fd8' : c, other = light(c) ? '#3f6fd8' : '#ffffff'; // a white page gets a colour that shows
    if (type === 'none') return { type: 'none' };
    if (type === 'solid') return { type, color: c };
    if (type === 'gradient') return { type, c1: c, c2: (f && f.c2) || other, angle: (f && f.angle) ?? 90, radial: !!(f && f.radial), dither: f && f.dither != null ? f.dither : true };
    if (type === 'pattern') return { type, pattern: (f && f.pattern) || 'dither50', fg: f && f.fg ? f.fg : ink, bg: (f && f.bg != null ? f.bg : '#ffffff'), size: (f && f.size) || 3 };
    return { type: 'picture', src: (f && f.src) || '', fit: (f && f.fit) || 'cover', opacity: (f && f.opacity) ?? 1, size: (f && f.size) || 20 };
  }
  // The fill picker as plain HTML (the same in every Craft app): none, colour, gradient, pattern or picture.
  // paintPicker(paint, apply, { none: 'None' | null, base, label, unit: 'mm' | 'px', sizeMax, pickPicture }) → element.
  // apply(newPaint) is called after every change; rebuild the picker from the new paint to show the new controls.
  function paintPicker(f, apply, o = {}) {
    if (!document.getElementById('pp-style')) {
      const st = document.createElement('style'); st.id = 'pp-style';
      st.textContent = '.pp{display:grid;gap:7px;margin:4px 0 8px}.pp-seg{display:flex;flex-wrap:wrap;gap:2px;padding:2px;border:1px solid var(--line,#ccc);border-radius:7px;background:var(--panel-2,#f3f3f3)}'
        + '.pp-seg button{flex:1 1 auto;min-width:0;white-space:nowrap;border:0;background:none;color:inherit;padding:4px 6px;border-radius:5px;cursor:pointer;font:inherit;font-size:12px}'
        + '.pp-seg button[aria-pressed=true]{background:var(--panel,#fff);color:var(--accent,#2f6fdd);box-shadow:0 1px 2px rgba(0,0,0,.12)}'
        + '.pp label{display:grid;gap:3px;font-size:12px;color:var(--muted,#666)}.pp .pp-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
        + '.pp input[type=color]{width:100%;height:28px;padding:2px;border:1px solid var(--line,#ccc);border-radius:6px;background:var(--panel,#fff)}'
        + '.pp select{height:28px;border:1px solid var(--line,#ccc);border-radius:6px;background:var(--panel,#fff);color:var(--fg,inherit);font:inherit;font-size:12px}'
        + '.pp .pp-check{display:flex;gap:6px;align-items:center;font-size:12px;color:inherit}.pp .pp-swatch{height:30px;border:1px solid var(--line,#ccc);border-radius:6px;image-rendering:pixelated}'
        + '.pp .pp-btn{height:28px;border:1px solid var(--line,#ccc);border-radius:6px;background:var(--panel,#fff);color:inherit;cursor:pointer;font:inherit;font-size:12px}';
      document.head.append(st);
    }
    f = f || { type: 'none' };
    const unit = o.unit || 'mm', set = (patch) => apply({ ...f, ...patch });
    const choose = o.pickPicture || (() => new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => { const fl = i.files[0]; if (!fl) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(fl); }; i.click(); }));
    const el = document.createElement('div'); el.className = 'pp';
    const mk = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); kids.flat().forEach((k) => k != null && e.append(k)); return e; };
    const color = (label, key, v) => mk('label', {}, label, mk('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#ffffff', onchange: (e) => set({ [key]: e.target.value }) }));
    const check = (label, v, on) => mk('label', { className: 'pp-check' }, mk('input', { type: 'checkbox', checked: !!v, onchange: (e) => on(e.target.checked) }), label);
    const range = (label, v, min, max, show, on) => { const b = mk('b', { textContent: show(v) }); const r = mk('input', { type: 'range', min, max, value: v, oninput: (e) => { b.textContent = show(+e.target.value); }, onchange: (e) => on(+e.target.value) }); return mk('label', {}, mk('span', {}, label + ': ', b), r); };
    const select = (label, v, opts, on) => mk('label', {}, label, mk('select', { onchange: (e) => on(e.target.value) }, opts.map(([a, b]) => mk('option', { value: a, textContent: b, selected: String(a) === String(v) }))));
    const TYPES = [...(o.none === null ? [] : [['none', o.none || 'None']]), ['solid', 'Colour'], ['gradient', 'Gradient'], ['pattern', 'Pattern'], ['picture', 'Picture']];
    const pick = async (type) => { const n = paintSwitch(f, type, o.base); if (unit === 'px' && type === 'pattern' && !(f && f.size)) n.size = 12; if (unit === 'px' && type === 'picture' && !(f && f.size)) n.size = 120; if (type === 'picture' && !n.src) { const src = await choose(); if (!src) return; n.src = src; } apply(n); };
    if (o.label) el.append(mk('span', { style: 'font-size:12px;color:var(--muted,#666)', textContent: o.label }));
    el.append(mk('div', { className: 'pp-seg', role: 'group' }, TYPES.map(([v, n]) => mk('button', { type: 'button', textContent: n, onclick: () => pick(v) }, null)).map((b, i) => { b.setAttribute('aria-pressed', String(f.type === TYPES[i][0])); return b; })));
    if (f.type === 'solid') el.append(color('Colour', 'color', f.color));
    if (f.type === 'gradient') {
      el.append(mk('div', { className: 'pp-row' }, color('From', 'c1', f.c1), color('To', 'c2', f.c2)));
      if (!f.radial) el.append(range('Angle', f.angle ?? 90, 0, 359, (v) => v + '°', (v) => set({ angle: v })));
      el.append(check('Round (from the middle out)', f.radial, (v) => set({ radial: v })));
      if (o.dither !== false) el.append(check('Smooth (dither): no colour bands', f.dither, (v) => set({ dither: v })));
    }
    if (f.type === 'pattern') {
      el.append(select('Pattern', f.pattern, PATTERNS.map(([v, n, g]) => [v, `${g}: ${n}`]), (v) => set({ pattern: v })));
      const sw = mk('div', { className: 'pp-swatch' }); sw.style.background = `url(${patternTile(f.pattern, f.fg, f.bg, 24).toDataURL()}) repeat`; sw.style.backgroundSize = '24px'; el.append(sw);
      el.append(mk('div', { className: 'pp-row' }, color('Ink', 'fg', f.fg), color('Background', 'bg', f.bg || '#ffffff')));
      el.append(check('See-through between the ink', !f.bg, (v) => set({ bg: v ? '' : '#ffffff' })));
      el.append(range('Pattern size', f.size || (unit === 'px' ? 12 : 3), 1, unit === 'px' ? 120 : 30, (v) => v + ' ' + unit, (v) => set({ size: v })));
    }
    if (f.type === 'picture') {
      el.append(select('Fit', f.fit || 'cover', [['cover', 'Fill (crop to fit)'], ['contain', 'Fit (whole picture)'], ['stretch', 'Stretch'], ['tile', 'Tile (repeat)']], (v) => set({ fit: v })));
      if (f.fit === 'tile') el.append(range('Tile width', f.size || (unit === 'px' ? 120 : 20), 3, unit === 'px' ? 1200 : 200, (v) => v + ' ' + unit, (v) => set({ size: v })));
      el.append(range('Picture strength', Math.round((f.opacity ?? 1) * 100), 5, 100, (v) => v + '%', (v) => set({ opacity: v / 100 })));
      el.append(mk('button', { type: 'button', className: 'pp-btn', textContent: 'Choose another picture…', onclick: async () => { const src = await choose(); if (src) set({ src }); } }));
    }
    return el;
  }
  // Fills as CSS in mm (pages print, so patterns are drawn at about 300 dots per inch).
  function paintCss(f) {
    if (!f || f.type === 'none') return {};
    if (f.type === 'solid') return { 'background-color': f.color || '#ffffff' };
    if (f.type === 'gradient') return { 'background-image': f.radial ? `radial-gradient(circle, ${f.c1}, ${f.c2})` : `linear-gradient(${f.angle ?? 90}deg, ${f.c1}, ${f.c2})` };
    if (f.type === 'pattern') { const t = patternTile(f.pattern, f.fg, f.bg, (f.size || 3) * 12), mm = (f.size || 3) * (t.width / ((f.size || 3) * 12)); return { 'background-image': `url(${t.toDataURL()})`, 'background-size': `${mm}mm ${mm}mm`, 'background-repeat': 'repeat' }; }
    const veil = 1 - (f.opacity ?? 1), fit = f.fit || 'cover';
    return { 'background-image': (veil > 0.01 ? `linear-gradient(rgba(255,255,255,${veil.toFixed(2)}), rgba(255,255,255,${veil.toFixed(2)})), ` : '') + `url(${f.src})`,
      'background-size': fit === 'stretch' ? '100% 100%' : fit === 'tile' ? `${f.size || 20}mm auto` : fit, 'background-repeat': fit === 'tile' ? 'repeat' : 'no-repeat', 'background-position': 'center' };
  }
  const putPaint = (node, f) => { const css = paintCss(f); Object.entries(css).forEach(([k, v]) => node.style.setProperty(k, v)); return node; };
  // The fill inside a shape's outline as SVG (units are mm, like the shape).
  function shapePaintDefs(f) {
    if (!f || f.type === 'none' || f.type === 'solid') return '';
    if (f.type === 'gradient') {
      if (f.radial) return `<defs><radialGradient id="pf" cx="0.5" cy="0.5" r="0.71"><stop offset="0" stop-color="${f.c1}"/><stop offset="1" stop-color="${f.c2}"/></radialGradient></defs>`;
      const a = ((f.angle ?? 90) * Math.PI) / 180;
      return `<defs><linearGradient id="pf" x1="${0.5 - Math.sin(a) / 2}" y1="${0.5 + Math.cos(a) / 2}" x2="${0.5 + Math.sin(a) / 2}" y2="${0.5 - Math.cos(a) / 2}"><stop offset="0" stop-color="${f.c1}"/><stop offset="1" stop-color="${f.c2}"/></linearGradient></defs>`;
    }
    if (f.type === 'pattern') { const n = f.size || 3, t = patternTile(f.pattern, f.fg, f.bg, n * 12), m = n * (t.width / (n * 12)); return `<defs><pattern id="pf" patternUnits="userSpaceOnUse" width="${m}" height="${m}"><image href="${t.toDataURL()}" width="${m}" height="${m}"/></pattern></defs>`; }
    const par = f.fit === 'contain' ? 'xMidYMid meet' : f.fit === 'stretch' ? 'none' : 'xMidYMid slice';
    return `<defs><pattern id="pf" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="${f.src}" width="1" height="1" preserveAspectRatio="${par}" opacity="${f.opacity ?? 1}"/></pattern></defs>`;
  }
  // Backgrounds print: tell the browser to keep them.
  if (!document.getElementById('dc-print-bg')) { const st = document.createElement('style'); st.id = 'dc-print-bg'; st.textContent = '.ppage, .ppage *, .dpage, .dpage * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }'; document.head.append(st); }
  const SPECIALS = ['Today', 'Time', 'Now', 'Page', 'Pages', 'Count', 'Subtotal', 'TaxRate', 'Tax', 'Total'];
  // Date and time (the same in every Craft app): Word-style formats and the Insert › Date and time dialog.
  // Static = the words are typed in once. Dynamic = a field that shows the current date or time whenever it is
  // opened, printed or exported. A stamp model is { fmt, before, after }.
  const DATE_FORMATS = [
    ['short', 'Short date', (d) => d.toLocaleDateString()],
    ['long', 'Long date', (d) => d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })],
    ['mdy', 'Month day, year', (d) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })],
    ['mdyShort', 'Short month', (d) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })],
    ['dmy', 'Day month year', (d) => `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'long' })} ${d.getFullYear()}`],
    ['iso', 'Year-month-day', (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`],
    ['monthYear', 'Month and year', (d) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })],
    ['weekday', 'Day of the week', (d) => d.toLocaleDateString(undefined, { weekday: 'long' })],
    ['year', 'Year', (d) => String(d.getFullYear())],
    ['time', 'Time', (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })],
    ['time24', 'Time (24-hour)', (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`],
    ['timeSec', 'Time with seconds', (d) => d.toLocaleTimeString()],
    ['dateTime', 'Date and time', (d) => `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`],
    ['stampDMY', 'Stamp: 14 OCT 2026', (d) => `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getFullYear()}`],
    ['stampMDY', 'Stamp: OCT 14 2026', (d) => `${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()} ${d.getFullYear()}`],
    ['stampFull', 'Stamp: date and time', (d) => `${DATE_FORMATS[5][2](d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`],
  ];
  const dateText = (fmt, d = new Date()) => (DATE_FORMATS.find((f) => f[0] === fmt) || DATE_FORMATS[0])[2](d);
  const stampText = (s, d = new Date()) => (s.before || '') + dateText(s.fmt, d) + (s.after || '');
  // The dialog: pick a format, add words before or after, choose fixed text or a field that updates itself.
  // Resolves to { fmt, before, after, dynamic, text } or null. `dynamicNote` explains what "updates" means in this app.
  function dateDialog({ title = 'Date and time', fmt = 'long', before = '', after = '', dynamic = false, allowDynamic = true, dynamicNote = 'Shows the current date or time every time you open, print or export.' } = {}) {
    return new Promise((res) => {
      if (!document.getElementById('dt-style')) {
        const st = document.createElement('style'); st.id = 'dt-style';
        st.textContent = '.dt-bd{position:fixed;inset:0;background:rgba(0,0,0,.4);display:grid;place-items:center;z-index:100000}'
          + '.dt-dlg{background:var(--panel,#fff);color:var(--fg,#222);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);width:min(560px,94vw);max-height:90vh;overflow:auto;padding:18px 20px;font:14px/1.4 system-ui,"Segoe UI",sans-serif}'
          + '.dt-dlg h2{margin:0 0 12px;font-size:17px}.dt-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}'
          + '.dt-list{border:1px solid var(--line,#ccc);border-radius:8px;max-height:300px;overflow:auto;padding:4px}'
          + '.dt-list button{display:block;width:100%;text-align:left;border:0;background:none;color:inherit;padding:5px 8px;border-radius:5px;cursor:pointer;font:inherit}'
          + '.dt-list button:hover{background:var(--panel-2,#f1f1f1)}.dt-list button[aria-pressed=true]{background:var(--accent,#2f6fdd);color:#fff}'
          + '.dt-dlg label{display:grid;gap:3px;font-size:12px;color:var(--muted,#666);margin-bottom:10px}'
          + '.dt-dlg input[type=text]{height:30px;padding:0 8px;border:1px solid var(--line,#ccc);border-radius:6px;background:var(--panel,#fff);color:var(--fg,#222);font:inherit}'
          + '.dt-dlg .dt-check{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:inherit}.dt-prev{padding:10px;border:1px dashed var(--line,#ccc);border-radius:8px;font-size:15px;min-height:22px;word-break:break-word}'
          + '.dt-acts{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.dt-acts button{min-width:80px;height:32px;border-radius:7px;border:1px solid var(--line,#ccc);background:var(--panel-2,#f4f4f4);color:inherit;cursor:pointer;font:inherit}'
          + '.dt-acts .dt-ok{background:var(--accent,#2f6fdd);border-color:var(--accent,#2f6fdd);color:#fff}@media(max-width:560px){.dt-grid{grid-template-columns:1fr}}';
        document.head.append(st);
      }
      const now = new Date(), esc2 = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const bd = document.createElement('div'); bd.className = 'dt-bd';
      bd.innerHTML = `<div class="dt-dlg" role="dialog" aria-modal="true" aria-label="${esc2(title)}"><h2>${esc2(title)}</h2><div class="dt-grid">
        <div><div class="dt-list" role="listbox" aria-label="Format">${DATE_FORMATS.map(([k, n, f]) => `<button type="button" data-f="${k}" aria-pressed="${k === fmt}" title="${esc2(n)}">${esc2(f(now))}</button>`).join('')}</div></div>
        <div><label>Words before<input type="text" data-b value="${esc2(before)}" placeholder="e.g. Printed on "></label><label>Words after<input type="text" data-a value="${esc2(after)}"></label>
        ${allowDynamic ? `<label class="dt-check"><input type="checkbox" data-dyn ${dynamic ? 'checked' : ''}><span><b>Update automatically</b><br><small>${esc2(dynamicNote)} Leave it off to type it in as fixed text.</small></span></label>` : ''}
        <label>Preview</label><div class="dt-prev" data-p></div></div></div>
        <div class="dt-acts"><button type="button" data-x>Cancel</button><button type="button" class="dt-ok" data-ok>Insert</button></div></div>`;
      document.body.append(bd);
      let f = fmt;
      const B = bd.querySelector('[data-b]'), A = bd.querySelector('[data-a]'), D = bd.querySelector('[data-dyn]');
      const prev = () => { bd.querySelector('[data-p]').textContent = stampText({ fmt: f, before: B.value, after: A.value }) + (D && D.checked ? '  (updates itself)' : ''); };
      bd.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { f = b.dataset.f; bd.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); prev(); }; b.ondblclick = () => bd.querySelector('[data-ok]').click(); });
      [B, A].forEach((i) => { i.oninput = prev; }); if (D) D.onchange = prev; prev();
      const done = (v) => { bd.remove(); res(v); };
      bd.querySelector('[data-x]').onclick = () => done(null);
      bd.querySelector('[data-ok]').onclick = () => { const s = { fmt: f, before: B.value, after: A.value }; done({ ...s, dynamic: !!(D && D.checked), text: stampText(s) }); };
      bd.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') bd.querySelector('[data-ok]').click(); });
      bd.onclick = (e) => { if (e.target === bd) done(null); };
      const sel = bd.querySelector('[aria-pressed=true]') || bd.querySelector('[data-f]'); sel.focus(); sel.scrollIntoView({ block: 'nearest' });
    });
  }
  // {Date:long}, {Date:time24}… show the date or time when the page is shown or printed (any format from DATE_FORMATS).
  const dateToken = (low) => { const m = /^date:(\w+)$/.exec(low); if (!m) return null; const f = DATE_FORMATS.find((x) => x[0].toLowerCase() === m[1]); return f ? f[2](new Date()) : null; };

  const uid = () => Math.random().toString(36).slice(2, 9);
  const round = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v ?? '');
  const dims = (p) => { const [w, hh] = SIZES[p.size] || SIZES.letter; return p.orient === 'landscape' ? [hh, w] : [w, hh]; };
  const numericF = (f) => f && (['number', 'currency'].includes(f.type) || f.type === 'formula');
  const moneyF = (f) => f && (f.type === 'currency' || (f.type === 'formula' && f.opts.currency));

  // Shapes with sharp or rounded corners. Sizes are in any unit; `round` 0 = sharp, 100 = as round as the shape allows.
  const SHAPES = [['rect', 'Box'], ['ellipse', 'Circle or oval'], ['triangle', 'Triangle'], ['diamond', 'Diamond'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['octagon', 'Octagon'], ['star', 'Star'], ['arrow', 'Arrow'], ['line', 'Line']];
  function shapePoints(type, w, h, points = 5) {
    const poly = (n, rot) => Array.from({ length: n }, (_, i) => { const a = ((rot + (360 * i) / n) * Math.PI) / 180; return [w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]; });
    switch (type) {
      case 'triangle': return [[w / 2, 0], [w, h], [0, h]];
      case 'diamond': return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
      case 'pentagon': return poly(5, -90);
      case 'hexagon': return poly(6, 0);
      case 'octagon': return poly(8, -67.5);
      case 'star': { const n = Math.max(3, points), out = []; for (let i = 0; i < 2 * n; i++) { const r = i % 2 ? 0.45 : 1, a = ((-90 + (180 * i) / n) * Math.PI) / 180; out.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]); } return out; }
      case 'arrow': return [[0, h * 0.3], [w * 0.6, h * 0.3], [w * 0.6, 0], [w, h / 2], [w * 0.6, h], [w * 0.6, h * 0.7], [0, h * 0.7]];
      default: return [[0, 0], [w, 0], [w, h], [0, h]];
    }
  }
  function shapePath(type, w, h, round = 0, points = 5) {
    const f = (v) => +v.toFixed(2);
    if (type === 'ellipse') return `M0 ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)}Z`;
    if (type === 'line') return `M0 ${f(h / 2)}L${f(w)} ${f(h / 2)}`;
    const pts = shapePoints(type, w, h, points), n = pts.length;
    // 100% rounds each corner to half of the shortest side, so every shape goes smoothly from sharp to fully round.
    const shortest = Math.min(...pts.map((q, i) => Math.hypot(pts[(i + 1) % n][0] - q[0], pts[(i + 1) % n][1] - q[1]))), R = ((Math.max(0, Math.min(100, round || 0)) / 100) * shortest) / 2;
    if (!R) return 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
    let d = '';
    pts.forEach((p, i) => {
      const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
      const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]), r = Math.min(R, la / 2, lb / 2);
      const p1 = [p[0] + ((a[0] - p[0]) * r) / la, p[1] + ((a[1] - p[1]) * r) / la], p2 = [p[0] + ((b[0] - p[0]) * r) / lb, p[1] + ((b[1] - p[1]) * r) / lb];
      d += `${i ? 'L' : 'M'}${f(p1[0])} ${f(p1[1])}Q${f(p[0])} ${f(p[1])} ${f(p2[0])} ${f(p2[1])}`;
    });
    return d + 'Z';
  }
  // Where words sit inside each shape: centre x, centre y and width, as parts of the shape.
  const shapeTextBox = (type) => ({ triangle: [0.5, 0.66, 0.55], diamond: [0.5, 0.5, 0.55], star: [0.5, 0.55, 0.42], arrow: [0.42, 0.5, 0.58], ellipse: [0.5, 0.5, 0.72], pentagon: [0.5, 0.56, 0.66], hexagon: [0.5, 0.5, 0.72], octagon: [0.5, 0.5, 0.75] }[type] || [0.5, 0.5, 1]);
  // Everything a shape draws, back to front: the 3-D sides, the face, and one border line or three (outer, middle, inner).
  // Three colours for 3-D: face (fill), side (depth) and edge (border). `k` turns mm (or px) into drawing units.
  // Returns [{ d, x, y, fill, stroke, sw, dash, face }]; the face size is the box less the 3-D depth.
  function shapeLayers(s, W, H, k) {
    const rnd = s.round || 0, pts = s.points || 5, depth = Math.max(0, (s.depth || 0) * k);
    const FW = Math.max(1, W - depth), FH = Math.max(1, H - depth);
    const at = (inset, x0, y0, fill, stroke, sw, dash, face) => ({ d: shapePath(s.type, Math.max(1, FW - 2 * inset), Math.max(1, FH - 2 * inset), rnd, pts), x: x0 + inset, y: y0 + inset, fill: fill || 'none', stroke: stroke || 'none', sw: sw || 0, dash: !!dash, face: !!face });
    const out = [];
    if (depth) {
      const n = Math.max(3, Math.ceil(depth / (0.35 * k)));
      for (let i = n; i >= 1; i--) out.push(at(0, (depth * i) / n, (depth * i) / n, s.side || '#6b6b6b', i === n && s.stroke ? s.stroke : null, i === n && s.stroke ? (s.sw || 0.4) * k : 0));
    }
    const L = s.lines;
    if (L) {
      out.push(at(0, 0, 0, s.fill, null, 0, false, true));
      const o = ((L.outer && L.outer.w) || 0) * k, m = ((L.middle && L.middle.w) || 0) * k, i = ((L.inner && L.inner.w) || 0) * k;
      if (o) out.push(at(o / 2, 0, 0, null, L.outer.color, o, s.dash));
      if (m && L.middle.color) out.push(at(o + m / 2, 0, 0, null, L.middle.color, m, s.dash));
      if (i) out.push(at(o + m + i / 2, 0, 0, null, L.inner.color, i, s.dash));
    } else out.push(at(0, 0, 0, s.fill, s.stroke, s.stroke ? (s.sw || 0.4) * k : 0, s.dash, true));
    return { layers: out, FW, FH };
  }
  const defaultLines = (base) => ({ outer: { color: base || '#222222', w: 1.2 }, middle: { color: '', w: 0.8 }, inner: { color: base || '#222222', w: 0.4 } });
  // Dingbats: classic symbol characters in groups (the same set in every Craft app). They are text, so colour,
  // size, shadow, outline, gradients and rotation all work on them. DINGBAT_FONT is a list of fonts that have them.
  const DINGBAT_FONT = "'Segoe UI Symbol', 'Noto Sans Symbols 2', 'Noto Sans Symbols', 'Apple Symbols', 'DejaVu Sans', 'Arial Unicode MS', sans-serif";
  const DINGBATS = [
    ['Arrows', '← → ↑ ↓ ↔ ↕ ↖ ↗ ↘ ↙ ⇐ ⇒ ⇑ ⇓ ⇔ ➔ ➜ ➙ ➛ ➝ ➞ ➟ ➠ ➡ ➢ ➣ ➤ ➥ ➦ ➧ ➨ ➩ ➪ ➫ ➬ ➭ ➮ ➯ ➱ ➲ ➳ ➵ ➸ ➺ ➻ ➼ ➽ ➾ ↩ ↪ ↺ ↻ ⟲ ⟳'],
    ['Checks and crosses', '✓ ✔ ✗ ✘ ☐ ☑ ☒ ✕ ✖ ✚ ✛ ✜ ✙ ✠ ✟ ✞ ✝'],
    ['Stars and flowers', '★ ☆ ✦ ✧ ✩ ✪ ✫ ✬ ✭ ✮ ✯ ✰ ✱ ✲ ✳ ✴ ✵ ✶ ✷ ✸ ✹ ✺ ✻ ✼ ✽ ✾ ✿ ❀ ❁ ❂ ❃ ❄ ❅ ❆ ❇ ❈ ❉ ❊ ❋ ❖ ⁂ ※'],
    ['Hands and faces', '☚ ☛ ☜ ☝ ☞ ☟ ✌ ✍ ☺ ☻ ☹ ☠'],
    ['Shapes', '● ○ ◉ ◎ ◐ ◑ ◒ ◓ ■ □ ▪ ▫ ▬ ▭ ▮ ▯ ◆ ◇ ◈ ◊ ▲ △ ▼ ▽ ◀ ▶ ◢ ◣ ◤ ◥ ❍ ❏ ❐ ❑ ❒ ⬟ ⬢ ⬣ ⬤ ⬛ ⬜'],
    ['Hearts and cards', '♥ ♡ ❤ ❥ ❦ ❧ ❣ ♠ ♣ ♦ ♤ ♧ ♢'],
    ['Weather and nature', '☀ ☁ ☂ ☃ ☄ ☾ ☽ ❄ ⚡ ☘ ⚘ ☔ ☼ ☇ ☈'],
    ['Office and signs', '✂ ✃ ✄ ✆ ✇ ✈ ✉ ✎ ✏ ✐ ✑ ✒ ☎ ☏ ⌚ ⌛ ⚑ ⚐ ⚠ ♻ ⚙ ⚖ ⚓ ☕ ♿ ⚕ ⚛ ☮ ☯ ☸ ⚜ ☢ ☣ ⌘ ⌨ ✉'],
    ['Music and games', '♩ ♪ ♫ ♬ ♭ ♮ ♯ ⚀ ⚁ ⚂ ⚃ ⚄ ⚅ ♔ ♕ ♖ ♗ ♘ ♙ ♚ ♛ ♜ ♝ ♞ ♟'],
    ['Ornaments and quotes', '❛ ❜ ❝ ❞ ❨ ❩ ❪ ❫ ❬ ❭ ❮ ❯ ❰ ❱ ❲ ❳ ❴ ❵ ❡ ❢ § ¶ † ‡ • ‣ ◦ ⁃ ⁌ ⁍ ☙ ❦ ⸙'],
    ['Numbers', '① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ ⑩ ❶ ❷ ❸ ❹ ❺ ❻ ❼ ❽ ❾ ❿ ➀ ➁ ➂ ➃ ➄ ➅ ➆ ➇ ➈ ➉ ➊ ➋ ➌ ➍ ➎ ➏ ➐ ➑ ➒ ➓'],
  ].map(([name, chars]) => [name, chars.split(/\s+/).filter(Boolean)]);
  // Colour fills for icons, pictures and text: the original, one solid colour (keeps transparency), a tint over the
  // original, a two-colour gradient at an angle, or a picture inside the shape. Works on any picture with a see-through background.
  const FILL_MODES = [['original', 'Original'], ['solid', 'One colour'], ['tint', 'Tint over it'], ['gradient', 'Gradient'], ['picture', 'Picture fill']];
  function recolorCanvas(img, f, pattern) {
    const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, c.width, c.height);
    if (!f || f.mode === 'original') return c;
    if (f.mode === 'tint') { x.globalCompositeOperation = 'source-atop'; x.globalAlpha = f.amount ?? 0.6; x.fillStyle = f.c1 || '#e8483f'; x.fillRect(0, 0, c.width, c.height); return c; }
    x.globalCompositeOperation = 'source-in';
    if (f.mode === 'gradient') {
      const a = ((f.angle ?? 90) * Math.PI) / 180, cx = c.width / 2, cy = c.height / 2, r = Math.hypot(c.width, c.height) / 2;
      const g = x.createLinearGradient(cx - Math.sin(a) * r, cy + Math.cos(a) * r, cx + Math.sin(a) * r, cy - Math.cos(a) * r);
      g.addColorStop(0, f.c1 || '#e8483f'); g.addColorStop(1, f.c2 || '#3f8be8'); x.fillStyle = g;
    } else if (f.mode === 'picture' && pattern) {
      const k = Math.max(c.width / pattern.width, c.height / pattern.height);
      x.drawImage(pattern, (c.width - pattern.width * k) / 2, (c.height - pattern.height * k) / 2, pattern.width * k, pattern.height * k); return c;
    } else x.fillStyle = f.c1 || '#222222';
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  // Colour fill for pictures with a see-through background, using the picture as a mask (the picture itself is unchanged).
  function fxLayer(el) {
    const f = el.fx, size = el.fit === 'cover' ? 'cover' : 'contain', mask = `url("${el.src}") center / ${size} no-repeat`;
    const a = f.angle ?? 90, alpha = Math.round((f.amount ?? 0.6) * 255).toString(16).padStart(2, '0');
    const bg = f.mode === 'gradient' ? `linear-gradient(${a}deg, ${f.c1}, ${f.c2})` : f.mode === 'picture' && f.src ? `url("${f.src}") center / cover no-repeat`
      : f.mode === 'tint' ? `linear-gradient(${f.c1}${alpha}, ${f.c1}${alpha}), url("${el.src}") center / ${size} no-repeat` : f.c1;
    return h('div', { style: { position: 'absolute', inset: 0, background: bg, WebkitMask: mask, mask } });
  }
  // Drop shadow as a CSS filter (it follows the shape or the letters). Sizes in mm.
  const shadowCss = (sh) => (sh ? `drop-shadow(${sh.x ?? 0.6}mm ${sh.y ?? 0.6}mm ${sh.blur ?? 1}mm ${sh.color || 'rgba(0,0,0,.35)'})` : '');
  const roundMm = (el) => ((el.round || 0) / 100) * Math.min(el.w, el.h) / 2;

  // Tables that link to this table (for invoice line items and the like).
  function childLinks(tblName) {
    const out = [];
    DC.project.schema.tables.forEach((t) => t.fields.forEach((f) => { if (f.type === 'link' && f.opts.link === tblName) out.push({ table: t.name, link: f.name, label: `${t.label} (by ${f.label})` }); }));
    return out;
  }

  // ---------- Data context ----------
  function context(page, rid) {
    const mainT = db.table(page.table);
    const ctx = { page, mainT, rec: null, maps: mainT ? db.linkMapsFor(mainT) : {}, rows: [], srcT: null, srcMaps: {}, sums: {}, count: 0 };
    if (!mainT) return ctx;
    if (page.kind === 'record' && rid) ctx.rec = db.getRow(mainT.name, rid);
    const T = page.elements.find((e) => e.type === 'table');
    if (T) {
      if (page.kind === 'list') {
        ctx.srcT = mainT;
        let rows = db.rows(mainT.name, { sort: page.sort ? { field: page.sort, dir: 'asc' } : null }).rows;
        if (page.group) {
          const gf = mainT.fields.find((f) => f.name === page.group);
          const key = (r) => (gf ? DC.fmtValue(gf, r[gf.name], ctx.maps) : '');
          rows = rows.map((r, i) => ({ r, i, k: key(r) })).sort((a, b) => (a.k === '') - (b.k === '') || a.k.localeCompare(b.k) || a.i - b.i).map((x) => x.r);
          ctx.groupKey = key;
        }
        ctx.rows = rows;
      } else if (T.source && db.table(T.source.table) && ctx.rec) {
        ctx.srcT = db.table(T.source.table);
        ctx.rows = db.rows(ctx.srcT.name, { where: { [T.source.link]: ctx.rec._rid } }).rows;
      } else if (T.source && db.table(T.source.table)) ctx.srcT = db.table(T.source.table);
      if (ctx.srcT) {
        ctx.srcMaps = db.linkMapsFor(ctx.srcT);
        T.columns.forEach((c) => { if (c.sum) ctx.sums[c.field] = ctx.rows.reduce((s, r) => s + (parseFloat(r[c.field]) || 0), 0); });
        const firstSum = T.columns.find((c) => c.sum);
        ctx.subtotal = firstSum ? ctx.sums[firstSum.field] : 0;
        ctx.subtotalField = firstSum ? ctx.srcT.fields.find((f) => f.name === firstSum.field) : null;
      }
      ctx.count = ctx.rows.length;
    }
    return ctx;
  }

  // ---------- {Placeholders} ----------
  function placeholders(page) {
    const t = db.table(page.table); if (!t) return SPECIALS;
    const out = [];
    if (page.kind === 'record') {
      t.fields.forEach((f) => {
        out.push(f.label);
        if (f.type === 'link' && db.table(f.opts.link)) db.table(f.opts.link).fields.forEach((g) => out.push(`${f.label}.${g.label}`));
      });
    }
    return [...out, ...SPECIALS];
  }
  function resolve(token, ctx, info) {
    const tk = token.trim(), low = tk.toLowerCase();
    const money = (n) => (ctx.subtotalField && !moneyF(ctx.subtotalField) ? DC.fmtNumber(n, 2) : DC.fmtCurrency(n));
    const rate = parseFloat(ctx.page.taxRate) || 0;
    const dt = dateToken(low); if (dt != null) return dt;
    switch (low) {
      case 'today': return DC.fmtDate(DC.todayIso());
      case 'time': return dateText('time');
      case 'now': return dateText('dateTime');
      case 'page': return String(info ? info.page : 1);
      case 'pages': return String(info ? info.pages : 1);
      case 'count': return String(ctx.count || 0);
      case 'subtotal': return money(ctx.subtotal || 0);
      case 'taxrate': return DC.fmtNumber(rate);
      case 'tax': return money((ctx.subtotal || 0) * rate / 100);
      case 'total': return money((ctx.subtotal || 0) * (1 + rate / 100));
    }
    if (!ctx.rec || !ctx.mainT) return '';
    const byLabel = (t, l) => t.fields.find((f) => f.label.toLowerCase() === l.toLowerCase());
    const dot = tk.indexOf('.');
    if (dot > 0) {
      const lf = byLabel(ctx.mainT, tk.slice(0, dot));
      if (lf && lf.type === 'link' && ctx.rec[lf.name] != null) {
        const tt = db.table(lf.opts.link); const tr = tt && db.getRow(tt.name, ctx.rec[lf.name]);
        const g = tt && byLabel(tt, tk.slice(dot + 1));
        if (tr && g) return DC.fmtValue(g, tr[g.name], db.linkMapsFor(tt));
        return '';
      }
    }
    const f = byLabel(ctx.mainT, tk);
    if (f) return DC.fmtValue(f, ctx.rec[f.name], ctx.maps);
    return null; // unknown
  }
  function fillText(text, ctx, info) {
    return esc(text).replace(/\{([^{}]+)\}/g, (m, tok) => {
      const v = resolve(tok.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'), ctx, info);
      return v == null ? `<span class="unknown">${m}</span>` : esc(v);
    });
  }
  const designText = (text) => esc(text).replace(/\{([^{}]+)\}/g, '<span class="ph">{$1}</span>');

  // ---------- Element DOM ----------
  function elementEl(el, ctx, info, design) {
    const d = h('div', { class: 're re-' + el.type, style: { left: el.x + 'mm', top: el.y + 'mm', width: el.w + 'mm', height: el.h + 'mm' } });
    if (el.opacity != null && el.opacity < 1) d.style.opacity = el.opacity; // see-through, so items can overlap
    if (el.shadow) d.style.filter = shadowCss(el.shadow);
    if (el.type === 'text') {
      Object.assign(d.style, { fontSize: el.size + 'pt', fontWeight: el.bold ? '700' : '400', fontStyle: el.italic ? 'italic' : 'normal', textAlign: el.align || 'left', color: el.color || '#000', fontFamily: FONTS[el.font] || FONTS.sans, background: el.fill || 'transparent' });
      if (el.paint) putPaint(d, el.paint);
      if (el.fill || el.paint) d.style.padding = '1.2mm 2mm';
      if (el.pad != null) d.style.padding = el.pad + 'mm';
      if (el.border) d.style.border = `${el.border}mm ${el.dash ? 'dashed' : 'solid'} ${el.stroke || '#000000'}`;
      if (el.round) d.style.borderRadius = roundMm(el) + 'mm';
      if (el.valign === 'middle') Object.assign(d.style, { display: 'flex', flexDirection: 'column', justifyContent: 'center' });
      const inner = design ? designText(el.text) : fillText(el.text, ctx, info);
      d.innerHTML = el.valign === 'middle' ? `<div>${inner}</div>` : inner;
    } else if (el.type === 'image') {
      if (el.src && el.fx && el.fx.mode !== 'original') d.append(fxLayer(el));
      else if (el.src) d.append(h('img', { src: el.src, alt: '', style: { objectFit: el.fit || 'contain' } }));
      else if (design) d.append(h('span', { class: 'ph-box' }, 'Image'));
    } else if (el.type === 'line') {
      const vertical = el.h > el.w;
      const c = el.color || '#000', bg = el.dash ? `repeating-linear-gradient(${vertical ? '180deg' : '90deg'}, ${c} 0 2mm, transparent 2mm 3.5mm)` : c;
      d.append(h('div', { class: 'line-in', style: vertical ? { left: '50%', top: 0, bottom: 0, width: el.thick + 'mm', background: bg, transform: 'translateX(-50%)', borderRadius: el.round ? el.thick / 2 + 'mm' : 0 } : { top: '50%', left: 0, right: 0, height: el.thick + 'mm', background: bg, transform: 'translateY(-50%)', borderRadius: el.round ? el.thick / 2 + 'mm' : 0 } }));
    } else if (el.type === 'box') {
      // A shape (box, circle, triangle, diamond, polygons, star, arrow) with sharp or round corners and words inside.
      const shape = el.shape || 'rect', sw = el.thick || 0;
      const rnd = el.round ?? (el.radius ? Math.min(100, (el.radius / (Math.min(el.w, el.h) / 2)) * 100) : 0);
      // 3-D sides, the face and one or three border lines (outer, middle, inner), in mm.
      const L = shapeLayers({ type: shape, round: rnd, points: el.points || 5, fill: el.fill, stroke: sw ? el.stroke || '#000000' : null, sw, dash: el.dash, depth: el.depth, side: el.side, lines: el.lines }, el.w, el.h, 1);
      d.style.overflow = 'visible';
      const defs = shapePaintDefs(el.paint), pid = 'pf' + (el.id || '').replace(/\W/g, '');
      d.innerHTML = `<svg viewBox="0 0 ${el.w} ${el.h}" width="100%" height="100%" preserveAspectRatio="none" style="position:absolute;inset:0;overflow:visible">` + defs.replace('id="pf"', `id="${pid}"`)
        + L.layers.map((l) => `<path d="${l.d}" transform="translate(${l.x} ${l.y})" fill="${defs && l.face ? `url(#${pid})` : l.fill}" stroke="${l.stroke}" stroke-width="${l.sw}" stroke-linejoin="${rnd ? 'round' : 'miter'}" ${l.dash ? 'stroke-dasharray="2 1.5"' : ''}/>`).join('') + '</svg>';
      const FW = L.FW, FH = L.FH;
      if (el.text) {
        const [cx, cy, tw] = shapeTextBox(shape), pad = el.pad ?? 1.5;
        const t = h('div', { class: 'shape-text', style: { position: 'absolute', left: (FW * cx - (FW * tw) / 2 + pad) + 'mm', width: (FW * tw - 2 * pad) + 'mm', top: el.valign === 'top' && shape === 'rect' ? pad + 'mm' : (FH * cy) + 'mm', transform: el.valign === 'top' && shape === 'rect' ? 'none' : 'translateY(-50%)',
          fontSize: (el.size || 10) + 'pt', fontWeight: el.bold ? '700' : '400', fontStyle: el.italic ? 'italic' : 'normal', textAlign: el.align || 'center', color: el.color || '#000', fontFamily: FONTS[el.font] || FONTS.sans, lineHeight: 1.25, whiteSpace: 'pre-wrap', wordWrap: 'break-word' } });
        t.innerHTML = design ? designText(el.text) : fillText(el.text, ctx, info);
        d.append(t);
      }
    } else if (el.type === 'table') {
      const shell = tableShell(el, ctx);
      if (el.bgPaint) putPaint(shell.table, el.bgPaint);
      d.style.height = design ? el.h + 'mm' : 'auto';
      d.append(shell.table);
      if (design) {
        const sample = ctx && ctx.rows.length ? ctx.rows.slice(0, 4) : [];
        if (sample.length) sample.forEach((r) => shell.tbody.append(rowEl(el, ctx, { kind: 'row', r })));
        else for (let i = 0; i < 3; i++) shell.tbody.append(h('tr', null, el.columns.map(() => h('td', null, ' '))));
        if (!el.columns.length) d.append(h('span', { class: 'ph-box' }, 'Table: add columns on the right'));
      }
      d._tbody = shell.tbody;
    }
    return d;
  }
  function tableShell(T, ctx) {
    const fieldOf = (c) => ctx && ctx.srcT && ctx.srcT.fields.find((f) => f.name === c.field);
    const total = T.columns.reduce((s, c) => s + (+c.width || 1), 0) || 1;
    const table = h('table', { class: `rt head-${T.head || 'dark'} lines-${T.lines || 'rows'}${T.stripes ? ' stripes' : ''}`, style: { fontSize: (T.size || 9) + 'pt' } },
      h('colgroup', null, T.columns.map((c) => h('col', { style: { width: ((+c.width || 1) / total * 100) + '%' } }))),
      T.head === 'none' ? null : h('thead', null, h('tr', null, T.columns.map((c) => h('th', { style: { textAlign: c.align || (numericF(fieldOf(c)) ? 'right' : 'left') } }, c.label ?? (fieldOf(c) || { label: c.field }).label)))));
    const tbody = h('tbody'); table.append(tbody);
    return { table, tbody };
  }
  function rowEl(T, ctx, item) {
    const fieldOf = (c) => ctx.srcT && ctx.srcT.fields.find((f) => f.name === c.field);
    const align = (c) => c.align || (numericF(fieldOf(c)) ? 'right' : 'left');
    if (item.kind === 'group') return h('tr', { class: 'grp' }, h('td', { colspan: T.columns.length }, item.label || '(none)'));
    if (item.kind === 'sub' || item.kind === 'total') {
      return h('tr', { class: item.kind }, T.columns.map((c, i) => {
        const f = fieldOf(c);
        const v = c.sum ? (moneyF(f) ? DC.fmtCurrency(item.sums[c.field]) : DC.fmtNumber(item.sums[c.field], f && f.opts.decimals)) : i === 0 ? item.label : '';
        return h('td', { style: { textAlign: c.sum ? align(c) : 'left' } }, v);
      }));
    }
    return h('tr', null, T.columns.map((c) => {
      const f = fieldOf(c);
      return h('td', { style: { textAlign: align(c) } }, f ? DC.fmtValue(f, item.r[f.name], ctx.srcMaps) : '');
    }));
  }
  function flowItems(T, ctx) {
    const items = [];
    const sumCols = T.columns.filter((c) => c.sum);
    const add = (acc, r) => sumCols.forEach((c) => { acc[c.field] = (acc[c.field] || 0) + (parseFloat(r[c.field]) || 0); });
    if (ctx.groupKey) {
      let cur = null, acc = {};
      ctx.rows.forEach((r) => {
        const k = ctx.groupKey(r);
        if (k !== cur) {
          if (cur !== null && sumCols.length) items.push({ kind: 'sub', label: `${cur || '(none)'} subtotal`, sums: acc });
          cur = k; acc = {};
          items.push({ kind: 'group', label: k });
        }
        add(acc, r); items.push({ kind: 'row', r });
      });
      if (cur !== null && sumCols.length) items.push({ kind: 'sub', label: `${cur || '(none)'} subtotal`, sums: acc });
    } else ctx.rows.forEach((r) => items.push({ kind: 'row', r }));
    if (sumCols.length && T.totalRow !== false) items.push({ kind: 'total', label: 'Total', sums: ctx.sums });
    return items;
  }

  // ---------- Rendering with page breaks ----------
  function measureRoot() {
    let m = DC.$('#measure');
    if (!m) { m = h('div', { id: 'measure', 'aria-hidden': 'true' }); document.body.append(m); }
    return m;
  }
  function renderDoc(page, rid) {
    const ctx = context(page, rid);
    const [W, H] = dims(page);
    const T = page.elements.find((e) => e.type === 'table');
    const flow = T && ctx.srcT ? flowItems(T, ctx) : [];
    const measure = measureRoot();
    const pages = [];
    let i = 0;
    do {
      const pg = putPaint(h('div', { class: 'ppage', style: { width: W + 'mm', height: H + 'mm' } }), page.paint);
      measure.append(pg); pages.push(pg);
      if (T) {
        const wrap = elementEl(T, ctx, null, false);
        pg.append(wrap);
        const limit = T.h * PX;
        let added = 0;
        while (i < flow.length) {
          const tr = rowEl(T, ctx, flow[i]);
          wrap._tbody.append(tr);
          if (wrap.offsetHeight > limit + 1 && added > 0) { tr.remove(); break; }
          i++; added++;
        }
        // Don't leave a group heading alone at the bottom of a page.
        const last = wrap._tbody.lastElementChild;
        if (i < flow.length && last && last.classList.contains('grp') && added > 1) { last.remove(); i--; }
      }
    } while (T && i < flow.length && pages.length < 500);
    pages.forEach((pg, n) => {
      const first = n === 0, lastPage = n === pages.length - 1;
      const info = { page: n + 1, pages: pages.length };
      page.elements.forEach((el) => {
        if (el.type === 'table') return;
        const pos = !T ? 'any' : el.y + el.h <= T.y + 0.5 ? 'above' : el.y >= T.y + T.h - 0.5 ? 'below' : 'side';
        const show = el.every || pos === 'any' || ((pos === 'above' || pos === 'side') && first) || (pos === 'below' && lastPage);
        if (show) pg.append(elementEl(el, ctx, info, false));
      });
    });
    return pages;
  }
  function recordIds(page) { const t = db.table(page.table); return t ? db.rows(t.name, {}).rows.map((r) => r._rid) : []; }

  function printPages(pages, page) {
    if (DC.inFrame) { DC.modal({ title: 'Print', body: h('p', null, 'Printing is not available in this viewer. Open DataCraft from app\\index.html on your computer to print or save PDFs.'), actions: [{ label: 'Close', primary: true }] }); return; }
    const [W, H] = dims(page);
    let root = DC.$('#print-root');
    if (root) root.remove();
    root = h('div', { id: 'print-root' }, h('style', null, `@page { size: ${W}mm ${H}mm; margin: 0; }`));
    pages.forEach((p) => root.append(p));
    document.body.append(root);
    const done = () => { root.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  }

  // ---------- New page ----------
  async function newPageDialog(preset = {}) {
    const tables = DC.project.schema.tables;
    if (!tables.length) { DC.toast('Create a table first. Pages show data from a table.'); return; }
    const v = await DC.formDialog({
      title: 'New page', ok: 'Create page',
      intro: 'Pages turn your data into printable documents. You can move and change everything afterwards.',
      fields: [
        { id: 'kind', label: 'What kind of page?', type: 'select', value: preset.kind || 'record', options: [['record', 'One record per page (invoice, record sheet, letter)'], ['list', 'List of records (report, price list, catalogue)']] },
        { id: 'table', label: 'Data from table', type: 'select', value: preset.table || tables[0].name, options: tables.map((t) => [t.name, t.label]) },
        { id: 'name', label: 'Page name', value: preset.name || '', placeholder: 'e.g. Invoice' },
        { id: 'size', label: 'Paper', type: 'select', value: DC.project.settings.pageSize || 'letter', options: Object.entries(SIZES).map(([k, v]) => [k, v[2]]) },
      ],
      validate: (v) => !v.name.trim() && 'Enter a page name.',
    });
    if (!v) return;
    const page = autoLayout({ name: v.name.trim(), kind: v.kind, table: v.table, size: v.size, orient: 'portrait', taxRate: DC.project.settings.taxRate || '0', elements: [] });
    const id = db.savePage(page);
    DC.go({ view: 'page', id });
  }

  // A sensible starting layout from the table's fields.
  function autoLayout(page) {
    const t = db.table(page.table);
    const [W, H] = dims(page);
    const M = 15, CW = W - 2 * M;
    const els = [];
    const text = (x, y, w, hh, txt, o = {}) => els.push({ id: uid(), type: 'text', x, y, w, h: hh, text: txt, size: 10, align: 'left', font: 'sans', color: '#000000', ...o });
    text(M, M, CW * 0.55, 18, 'Your Company Name\n123 Main Street\nYour City', { size: 10, every: false });
    text(M + CW * 0.55, M, CW * 0.45, 12, page.name.toUpperCase(), { size: 22, bold: true, align: 'right' });
    els.push({ id: uid(), type: 'line', x: M, y: M + 21, w: CW, h: 2, thick: 0.4, color: '#000000' });
    if (page.kind === 'record') {
      const own = t.fields.filter((f) => f.type !== 'longtext').slice(0, 8);
      const left = own.slice(0, 4), right = own.slice(4);
      const lines = (fs) => fs.map((f) => `${f.label}: {${f.label}}`).join('\n');
      text(M, M + 26, CW / 2 - 4, 26, lines(left));
      if (right.length) text(M + CW / 2, M + 26, CW / 2, 26, lines(right));
      const kids = childLinks(t.name);
      let y = M + 58;
      if (kids.length) {
        const src = kids[0], st = db.table(src.table);
        const cols = st.fields.filter((f) => f.name !== src.link).slice(0, 6).map((f, i) => ({ field: f.name, label: f.label, width: i === 0 && !numericF(f) ? 3 : numericF(f) ? 1.2 : 2, sum: false }));
        const lastMoney = [...cols].reverse().find((c) => moneyF(st.fields.find((f) => f.name === c.field))) || [...cols].reverse().find((c) => numericF(st.fields.find((f) => f.name === c.field)));
        if (lastMoney) lastMoney.sum = true;
        els.push({ id: uid(), type: 'table', x: M, y, w: CW, h: H - y - 60, source: { table: src.table, link: src.link }, columns: cols, size: 9.5, head: 'dark', lines: 'rows', stripes: false, totalRow: false });
        if (lastMoney) text(M + CW * 0.5, H - 55, CW * 0.5, 22, 'Subtotal: {Subtotal}\nTax ({TaxRate}%): {Tax}\nTotal: {Total}', { align: 'right', size: 11, bold: true });
        text(M, H - 55, CW * 0.48, 22, 'Thank you for your business.', { size: 9, color: '#444444' });
      } else {
        const notes = t.fields.filter((f) => f.type === 'longtext');
        if (notes.length) text(M, y, CW, 40, notes.map((f) => `${f.label}:\n{${f.label}}`).join('\n\n'));
      }
    } else {
      text(M, M + 25, CW, 6, 'Printed {Today}', { size: 9, color: '#444444' });
      const cols = t.fields.filter((f) => f.type !== 'longtext').slice(0, 6).map((f) => ({ field: f.name, label: f.label, width: numericF(f) ? 1.2 : 2, sum: false }));
      const cat = t.fields.find((f) => f.type === 'category');
      if (cat) page.group = cat.name;
      els.push({ id: uid(), type: 'table', x: M, y: M + 33, w: CW, h: H - M - 33 - 14, source: null, columns: cols.filter((c) => c.field !== page.group), size: 9.5, head: 'dark', lines: 'rows', stripes: true, totalRow: true });
    }
    text(M, H - 12, CW, 5, 'Page {Page} of {Pages}', { size: 8, align: 'center', color: '#666666', every: true });
    page.elements = els;
    return page;
  }

  // ---------- Designer view ----------
  function pageView(root, id, st) {
    const stored = DC.project.schema.pages.find((p) => p.id === id);
    if (!stored) { root.append(h('p', { class: 'empty' }, 'This page no longer exists.')); return; }
    if (!st.page || st.page.id !== id) st.page = JSON.parse(JSON.stringify(stored));
    const page = st.page;
    st.mode = st.mode || 'design';
    const t = db.table(page.table);
    const [W, H] = dims(page);
    const save = st.save || (st.save = DC.debounce(() => { db.savePage(page); DC.renderSidebar(); }, 400));
    const rerender = () => DC.render();
    const ids = page.kind === 'record' ? recordIds(page) : [];
    if (page.kind === 'record' && (!st.rid || !ids.includes(st.rid))) st.rid = ids[0] || null;
    const recLabel = (rid) => { const m = t ? db.linkMap(t.name) : new Map(); return m.get(rid) || '#' + rid; };

    // Header
    const recordPicker = page.kind === 'record' && t ? h('label', { class: 'inline' }, h('span', { class: 'muted' }, 'Record'),
      h('select', { class: 'input', disabled: !ids.length, onchange: (e) => { st.rid = +e.target.value; rerender(); } },
        ids.length ? (() => { const m = db.linkMap(t.name); return ids.map((r) => h('option', { value: r, selected: r === st.rid }, m.get(r) || '#' + r)); })() : h('option', null, 'No records yet'))) : null;
    root.append(h('div', { class: 'view-head' }, h('div', { class: 'title-row' },
      h('h1', null, page.name), h('span', { class: 'badge' }, page.kind === 'record' ? 'One record per page' : 'List report'),
      h('span', { class: 'muted' }, t ? `from ${t.label}` : 'table missing'),
      h('span', { class: 'spacer' }),
      h('div', { class: 'seg' }, ['design', 'preview'].map((m) => h('button', { class: 'btn', 'aria-pressed': String(st.mode === m), onclick: () => { st.mode = m; rerender(); } }, m === 'design' ? 'Design' : 'Preview'))),
      recordPicker,
      h('button', { class: 'btn primary', disabled: page.kind === 'record' && !st.rid, onclick: () => printPages(renderDoc(page, st.rid), page) }, page.kind === 'record' ? 'Print this' : 'Print'),
      page.kind === 'record' ? h('button', { class: 'btn', disabled: !ids.length, title: 'One document for every record', onclick: () => printPages(ids.flatMap((r) => renderDoc(page, r)), page) }, `Print all (${ids.length})`) : null,
      h('button', { class: 'btn ghost danger-text', onclick: async () => {
        if (!(await DC.ask({ title: `Delete the “${page.name}” page?`, body: 'Only the page design is deleted. Your data is not affected.', ok: 'Delete page', danger: true }))) return;
        db.deletePage(id); DC.go({ view: 'home-project' });
      } }, 'Delete'))));

    if (st.mode === 'preview') {
      const wrap = h('div', { class: 'preview-wrap' });
      root.append(wrap);
      if (page.kind === 'record' && !st.rid) { wrap.append(h('p', { class: 'empty' }, `Add a record to ${t ? t.label : 'the table'} to see this page with data.`)); return; }
      const pages = renderDoc(page, st.rid);
      const zoom = Math.min(1.4, Math.max(0.3, (root.clientWidth - 60) / (W * PX)));
      wrap.append(h('p', { class: 'muted center' }, `${pages.length} page${pages.length === 1 ? '' : 's'}${page.kind === 'record' && t ? ' · ' + recLabel(st.rid) : ''} · use your browser’s print window to save as PDF`));
      pages.forEach((p) => { p.style.zoom = zoom; wrap.append(p); });
      return;
    }

    const designer = h('div', { class: 'designer' });
    root.append(designer);
    const ctx = context(page, st.rid);
    const selEl = () => page.elements.find((e) => e.id === st.sel);

    // Toolbox
    const addEl = (el) => { el.id = uid(); page.elements.push(el); st.sel = el.id; save(); rerender(); };
    const M = 15;
    const tool = (label, title, fn, disabled) => h('button', { class: 'tool', title, disabled, onclick: fn }, label);
    const phs = placeholders(page).filter((p) => !SPECIALS.includes(p));
    designer.append(h('aside', { class: 'toolbox' },
      h('span', { class: 'label' }, 'Add'),
      tool('Text', 'A text box. Type fixed text and {fields}.', () => addEl({ type: 'text', x: M, y: M + 40, w: 70, h: 8, text: 'New text', size: 10, align: 'left', font: 'sans', color: '#000000' })),
      tool('Image / logo', 'A picture from your computer', () => addEl({ type: 'image', x: M, y: M, w: 40, h: 20, src: '', fit: 'contain' })),
      tool('Line', 'A horizontal line', () => addEl({ type: 'line', x: M, y: M + 60, w: W - 2 * M, h: 2, thick: 0.3, color: '#000000' })),
      tool('Dingbat', 'A symbol (arrows, stars, checks, hands, ornaments…) you can size and colour like text', () => addEl({ type: 'text', x: M, y: M + 40, w: 20, h: 20, text: '★', size: 36, align: 'center', font: 'sans', color: '#000000', valign: 'middle' })),
      tool('Text box', 'Words in a box that wrap, with a border, background, padding and shadow', () => addEl({ type: 'text', x: M, y: M + 40, w: 70, h: 25, text: 'Type here. Words wrap inside the box.', size: 10, align: 'left', font: 'sans', color: '#000000', border: 0.3, stroke: '#000000', pad: 2, round: 0 })),
      tool('Shape', 'A box, circle, triangle, diamond, pentagon, hexagon, octagon, star or arrow, with sharp or round corners and words inside', () => addEl({ type: 'box', shape: 'rect', x: M, y: M + 60, w: 60, h: 25, thick: 0.3, stroke: '#000000', fill: '', round: 0 })),
      tool('Table', page.elements.some((e) => e.type === 'table') ? 'A page can have one table' : 'A table of records that flows onto more pages',
        () => {
          const src = page.kind === 'list' ? null : childLinks(page.table)[0] || null;
          const st2 = src ? db.table(src.table) : t;
          addEl({ type: 'table', x: M, y: 90, w: W - 2 * M, h: H - 160, source: src, columns: (st2 ? st2.fields.filter((f) => !src || f.name !== src.link).slice(0, 5) : []).map((f) => ({ field: f.name, label: f.label, width: numericF(f) ? 1.2 : 2, sum: false })), size: 9.5, head: 'dark', lines: 'rows', stripes: false, totalRow: page.kind === 'list' });
        }, page.elements.some((e) => e.type === 'table')),
      page.kind === 'record' && phs.length ? [h('span', { class: 'label' }, 'Fields'), h('div', { class: 'field-list' }, phs.map((p) => h('button', { class: 'tool small', title: `Add {${p}} to the page`, onclick: () => addEl({ type: 'text', x: M, y: M + 40, w: 60, h: 6, text: `{${p}}`, size: 10, align: 'left', font: 'sans', color: '#000000' }) }, p)))] : null));

    // Canvas
    const canvasWrap = h('div', { class: 'canvas-wrap' });
    designer.append(canvasWrap);
    const dpage = putPaint(h('div', { class: 'dpage', style: { width: W + 'mm', height: H + 'mm' } },
      h('div', { class: 'margin-guide', style: { left: '10mm', top: '10mm', right: '10mm', bottom: '10mm' } })), page.paint);
    canvasWrap.append(dpage);
    const fitZoom = () => Math.min(1.5, Math.max(0.35, (canvasWrap.clientWidth - 48) / (W * PX)));
    st.zoom = st.zoom || 0;
    const applyZoom = () => { dpage.style.zoom = st.zoom || fitZoom(); zb.update(); };
    // zoom at the bottom of the page area, like a status bar: 100% = real size on screen
    const zb = zoomBar({ get: () => (st.zoom || fitZoom()) * 100, set: (pct) => { st.zoom = pct / 100; dpage.style.zoom = st.zoom; }, fit: () => { st.zoom = 0; applyZoom(); }, min: 25, max: 300 });
    canvasWrap.append(h('div', { class: 'dc-zoom' }, zb.el));
    const fitHeight = () => { const top = designer.getBoundingClientRect().top; if (top > 0 && innerWidth > 1100) designer.style.height = Math.max(480, innerHeight - top - 16) + 'px'; };
    requestAnimationFrame(fitHeight); if (!window.__dcFitH) { window.__dcFitH = true; addEventListener('resize', () => { const d = document.querySelector('.designer'); if (d && innerWidth > 1100) d.style.height = Math.max(480, innerHeight - d.getBoundingClientRect().top - 16) + 'px'; }); }
    if (!document.getElementById('dc-zoom-css')) document.head.append(h('style', { id: 'dc-zoom-css' }, '.dc-zoom{position:sticky;bottom:0;display:flex;justify-content:flex-end;padding:4px 10px;margin-top:8px;background:var(--panel,#fff);border-top:1px solid var(--line,#ddd);z-index:5}'));
    requestAnimationFrame(applyZoom);
    const T = page.elements.find((e) => e.type === 'table');
    page.elements.forEach((el) => {
      const d = elementEl(el, ctx, { page: 1, pages: 1 }, true);
      d.classList.add('del');
      if (el.id === st.sel) d.classList.add('sel');
      if (T && el !== T && !el.every) { const pos = el.y >= T.y + T.h - 0.5 ? 'last' : null; if (pos) d.title = 'Shown on the last page only'; }
      d.append(h('span', { class: 'handle', 'data-h': 'se' }));
      d.addEventListener('pointerdown', (e) => startDrag(e, el, d));
      dpage.append(d);
    });
    dpage.addEventListener('pointerdown', (e) => { if (e.target === dpage || e.target.classList.contains('margin-guide')) { st.sel = null; rerender(); } });

    function startDrag(e, el, d) {
      e.preventDefault(); e.stopPropagation();
      if (st.sel !== el.id) { st.sel = el.id; DC.$$('.del.sel', dpage).forEach((x) => x.classList.remove('sel')); d.classList.add('sel'); renderProps(); }
      const resize = e.target.dataset.h === 'se';
      const z = parseFloat(dpage.style.zoom) || 1;
      const sx = e.clientX, sy = e.clientY, o = { x: el.x, y: el.y, w: el.w, h: el.h };
      const snap = (v) => Math.round(v * 2) / 2;
      let moved = false;
      const move = (ev) => {
        const dx = (ev.clientX - sx) / (PX * z), dy = (ev.clientY - sy) / (PX * z);
        if (Math.abs(dx) + Math.abs(dy) > 0.3) moved = true;
        if (resize) { el.w = Math.max(2, snap(o.w + dx)); el.h = Math.max(el.type === 'line' ? 1 : 3, snap(o.h + dy)); }
        else { el.x = Math.min(W - 2, Math.max(-el.w + 2, snap(o.x + dx))); el.y = Math.min(H - 2, Math.max(-el.h + 2, snap(o.y + dy))); }
        Object.assign(d.style, { left: el.x + 'mm', top: el.y + 'mm', width: el.w + 'mm', height: el.h + 'mm' });
        updatePos();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) { save(); if (el.type === 'table') rerender(); } };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }

    // Properties
    const props = h('aside', { class: 'props' });
    designer.append(props);
    let updatePos = () => {};
    // Shared pieces of the properties panel: corners, colour-or-none, the text box look and the drop shadow.
    const corners = (el, set) => { const v = h('b', null, el.round ? el.round + '%' : 'sharp'); const r = h('input', { type: 'range', min: 0, max: 100, value: el.round ?? 0 }); r.oninput = () => { v.textContent = +r.value ? r.value + '%' : 'sharp'; el.round = +r.value; delete el.radius; redrawSel(); }; r.onchange = () => { save(); rerender(); }; return h('label', { class: 'field' }, h('span', null, 'Corners, sharp to round: ', v), r); };
    const colorOrNone = (label, value, on) => h('label', { class: 'field' }, h('span', null, label), h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
      h('input', { class: 'input', type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff', onchange: (e) => on(e.target.value) }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !value, onchange: (e) => on(e.target.checked ? '' : '#ffffff') }), ' None')));
    const boxLook = (el, set, num) => [h('h3', null, 'Box around the words'),
      paintPicker(el.paint || (el.fill ? { type: 'solid', color: el.fill } : { type: 'none' }), (f) => set(f.type === 'none' ? { fill: '', paint: null } : f.type === 'solid' ? { fill: f.color, paint: null, pad: el.pad ?? 2 } : { fill: '', paint: f, pad: el.pad ?? 2 }, true), { unit: 'mm', dither: false, label: 'Background' }),
      num('Border mm', 'border', 0.1, el, 0),
      h('div', { class: 'row2' }, h('label', { class: 'field' }, h('span', null, 'Border colour'), h('input', { class: 'input', type: 'color', value: el.stroke || '#000000', onchange: (e) => set({ stroke: e.target.value }, true) })), num('Padding mm', 'pad', 0.5, el, 0)),
      corners(el, set),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!el.dash, onchange: (e) => set({ dash: e.target.checked }, true) }), ' Dashed border'),
      h('div', { class: 'seg' }, [['top', 'Top'], ['middle', 'Middle']].map(([v, n]) => h('button', { class: 'btn', 'aria-pressed': String((el.valign || 'top') === v), onclick: () => set({ valign: v }, true) }, n)))];
    const shadowProps = (el, set) => {
      const sh = el.shadow, out = [h('h3', null, 'Drop shadow'), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!sh, onchange: (e) => set({ shadow: e.target.checked ? { blur: 1, x: 0.6, y: 0.6, color: 'rgba(0,0,0,.35)' } : null }, true) }), ' Drop shadow')];
      if (sh) {
        const slider = (label, key, max, both) => { const v = h('b', null, (sh[key] ?? 0) + ' mm'); const r = h('input', { type: 'range', min: 0, max, step: 0.1, value: sh[key] ?? 0 }); r.oninput = () => { v.textContent = r.value + ' mm'; sh[key] = +r.value; if (both) sh.y = +r.value; redrawSel(); }; r.onchange = () => { save(); rerender(); }; return h('label', { class: 'field' }, h('span', null, label + ': ', v), r); };
        out.push(h('div', { class: 'row2' }, slider('Softness', 'blur', 6), slider('Distance', 'x', 5, true)));
      }
      return out;
    };
    function renderProps() {
      props.textContent = '';
      if (!props.__safe) { props.__safe = true; const append = props.append.bind(props); props.append = (...k) => append(...k.flat(Infinity).filter((x) => x != null && x !== false)); } // skip empty items (they would show as "null")
      const el = selEl();
      const set = (patch, full) => { Object.assign(el || page, patch); save(); if (full) rerender(); else redrawSel(); };
      const num = (label, key, step = 0.5, obj = el, min) => { const i = h('input', { class: 'input', type: 'number', step, min, value: round(obj[key]) }); i.onchange = () => { obj[key] = parseFloat(i.value) || 0; save(); rerender(); }; return h('label', { class: 'field' }, h('span', null, label), i); };
      const sel = (label, value, options, onChange) => h('label', { class: 'field' }, h('span', null, label), h('select', { class: 'input', onchange: (e) => onChange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, l))));
      if (!el) {
        props.append(h('h3', null, 'Page'),
          (() => { const i = h('input', { class: 'input', value: page.name }); i.onchange = () => { if (i.value.trim()) { page.name = i.value.trim(); save(); rerender(); } }; return h('label', { class: 'field' }, h('span', null, 'Name'), i); })(),
          paintPicker(page.paint || { type: 'none' }, (f) => { page.paint = f.type === 'none' ? null : f; save(); rerender(); }, { unit: 'mm', dither: false, none: 'Plain', label: 'Page background', base: '#ffffff' }),
          h('div', { class: 'row2' }, sel('Paper', page.size, Object.entries(SIZES).map(([k, v]) => [k, v[2]]), (v) => { page.size = v; save(); st.zoom = 0; rerender(); }),
            sel('Orientation', page.orient, [['portrait', 'Portrait'], ['landscape', 'Landscape']], (v) => { page.orient = v; save(); st.zoom = 0; rerender(); })),
          page.kind === 'list' && t ? [
            sel('Group by', page.group, [['', 'No grouping'], ...t.fields.filter((f) => ['category', 'text', 'link', 'yesno', 'date'].includes(f.type)).map((f) => [f.name, f.label])], (v) => { page.group = v; save(); rerender(); }),
            sel('Sort by', page.sort, [['', 'Order added'], ...t.fields.filter((f) => f.type !== 'formula').map((f) => [f.name, f.label])], (v) => { page.sort = v; save(); rerender(); })] : null,
          T && T.columns.some((c) => c.sum) ? num('Tax rate (%) for {Tax} and {Total}', 'taxRate', 0.1, page, 0) : null,
          h('p', { class: 'hint' }, 'Click an item on the page to change it. Drag to move it; drag the corner dot to resize.'),
          h('h3', null, 'Fields you can type'),
          h('p', { class: 'hint' }, 'Put a field name in {curly brackets} in any text box.'),
          h('div', { class: 'ph-list' }, placeholders(page).map((p) => h('code', null, `{${p}}`))));
        updatePos = () => {};
        return;
      }
      const names = { text: el.border || el.pad != null ? 'Text box' : 'Text', image: 'Image', line: 'Line', box: 'Shape', table: 'Table' };
      const pos = h('div', { class: 'row4' }, num('X mm', 'x'), num('Y mm', 'y'), num('Width', 'w', 0.5, el, 1), num(el.type === 'table' ? 'Height (per page)' : 'Height', 'h', 0.5, el, 1));
      updatePos = () => { const ins = pos.querySelectorAll('input'); ['x', 'y', 'w', 'h'].forEach((k, i) => { ins[i].value = round(el[k]); }); };
      props.append(h('h3', null, names[el.type]), pos);
      if (el.type !== 'table') props.append(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!el.every, onchange: (e) => set({ every: e.target.checked }) }), ' Show on every page'));

      if (el.type === 'text') {
        const ta = h('textarea', { class: 'input', rows: 5 }, el.text);
        ta.oninput = () => { el.text = ta.value; save(); redrawSel(); };
        const ins = h('select', { class: 'input', onchange: () => {
          if (!ins.value) return;
          const tok = `{${ins.value}}`, a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
          ta.value = ta.value.slice(0, a) + tok + ta.value.slice(b); el.text = ta.value; save(); redrawSel();
          ta.focus(); ta.setSelectionRange(a + tok.length, a + tok.length); ins.value = '';
        } }, h('option', { value: '' }, 'Insert a field…'), placeholders(page).map((p) => h('option', { value: p }, p)));
        const dingSel = h('select', { class: 'input', onchange: () => {
          if (!dingSel.value) return;
          const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a, ch = dingSel.value;
          ta.value = ta.value.slice(0, a) + ch + ta.value.slice(b); el.text = ta.value; save(); redrawSel(); dingSel.value = '';
        } }, h('option', { value: '' }, 'Insert a dingbat…'), DINGBATS.map(([n, list]) => h('optgroup', { label: n }, list.map((ch) => h('option', { value: ch }, ch)))));
        const dateBtn = h('button', { class: 'btn outline', type: 'button', title: 'Fixed words, or a field that shows the date or time whenever the page is shown or printed', onclick: async () => {
          const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
          const r = await dateDialog({ dynamicNote: 'Shows the date or time whenever the page is shown or printed.' });
          if (!r) return;
          const tok = r.dynamic ? `${r.before}{Date:${r.fmt}}${r.after}` : r.text;
          ta.value = ta.value.slice(0, a) + tok + ta.value.slice(b); el.text = ta.value; save(); redrawSel();
          ta.focus(); ta.setSelectionRange(a + tok.length, a + tok.length);
        } }, 'Date and time…');
        props.append(h('label', { class: 'field' }, h('span', null, 'Text'), ta), ins, dingSel, dateBtn,
          h('div', { class: 'row2' }, num('Size (pt)', 'size', 0.5, el, 4), sel('Font', el.font, [['sans', 'Sans (Arial)'], ['serif', 'Serif (Georgia)'], ['mono', 'Typewriter']], (v) => set({ font: v }))),
          h('div', { class: 'seg' },
            h('button', { class: 'btn', 'aria-pressed': String(!!el.bold), onclick: () => set({ bold: !el.bold }, true) }, h('b', null, 'B')),
            h('button', { class: 'btn', 'aria-pressed': String(!!el.italic), onclick: () => set({ italic: !el.italic }, true) }, h('i', null, 'I')),
            ['left', 'center', 'right'].map((a) => h('button', { class: 'btn', 'aria-pressed': String((el.align || 'left') === a), onclick: () => set({ align: a }, true) }, a[0].toUpperCase() + a.slice(1)))),
          h('div', { class: 'row2' },
            h('label', { class: 'field' }, h('span', null, 'Colour'), h('input', { class: 'input', type: 'color', value: el.color || '#000000', oninput: (e) => set({ color: e.target.value }) }))));
        props.append(...boxLook(el, set, num, sel));
      } else if (el.type === 'image') {
        const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => {
          const f = fileIn.files[0]; if (!f) return;
          if (f.size > 3e6) { DC.toast('Pick an image under 3 MB.'); return; }
          const r = new FileReader(); r.onload = () => set({ src: r.result }, true); r.readAsDataURL(f);
        } });
        props.append(fileIn, h('button', { class: 'btn', onclick: () => fileIn.click() }, el.src ? 'Replace image…' : 'Choose image…'),
          sel('Fit', el.fit, [['contain', 'Fit inside the box'], ['cover', 'Fill the box (may crop)']], (v) => set({ fit: v }, true)));
        if (el.src) {
          const f = el.fx || { mode: 'original', c1: '#000000', c2: '#3f8be8', angle: 90, amount: 0.6 }, fx = (patch) => set({ fx: { ...f, ...patch } }, true);
          const picIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => { const file = picIn.files[0]; if (!file) return; const r = new FileReader(); r.onload = () => fx({ mode: 'picture', src: r.result }); r.readAsDataURL(file); } });
          props.append(h('h3', null, 'Colour fill (icons and see-through pictures)'), picIn,
            h('div', { class: 'seg', style: { flexWrap: 'wrap' } }, FILL_MODES.map(([v, n]) => h('button', { class: 'btn', 'aria-pressed': String(f.mode === v), onclick: () => (v === 'picture' && !f.src ? picIn.click() : fx({ mode: v })) }, n))),
            ['solid', 'tint', 'gradient'].includes(f.mode) ? h('div', { class: 'row2' },
              h('label', { class: 'field' }, h('span', null, f.mode === 'gradient' ? 'From' : 'Colour'), h('input', { class: 'input', type: 'color', value: f.c1, onchange: (e) => fx({ c1: e.target.value }) })),
              f.mode === 'gradient' ? h('label', { class: 'field' }, h('span', null, 'To'), h('input', { class: 'input', type: 'color', value: f.c2, onchange: (e) => fx({ c2: e.target.value }) })) : null) : null,
            f.mode === 'gradient' ? (() => { const v = h('b', null, (f.angle ?? 90) + '°'); const r = h('input', { type: 'range', min: 0, max: 359, value: f.angle ?? 90 }); r.oninput = () => { v.textContent = r.value + '°'; }; r.onchange = () => fx({ angle: +r.value }); return h('label', { class: 'field' }, h('span', null, 'Gradient angle: ', v), r); })() : null,
            f.mode === 'tint' ? (() => { const v = h('b', null, Math.round((f.amount ?? 0.6) * 100) + '%'); const r = h('input', { type: 'range', min: 5, max: 100, value: Math.round((f.amount ?? 0.6) * 100) }); r.oninput = () => { v.textContent = r.value + '%'; }; r.onchange = () => fx({ amount: +r.value / 100 }); return h('label', { class: 'field' }, h('span', null, 'How strong: ', v), r); })() : null,
            f.mode === 'picture' ? h('button', { class: 'btn', onclick: () => picIn.click() }, 'Choose another fill picture…') : null);
        }
      } else if (el.type === 'line') {
        props.append(h('div', { class: 'row2' }, num('Thickness mm', 'thick', 0.1, el, 0.1),
          h('label', { class: 'field' }, h('span', null, 'Colour'), h('input', { class: 'input', type: 'color', value: el.color || '#000000', oninput: (e) => set({ color: e.target.value }) }))),
          h('div', { class: 'seg' }, ['Square ends', 'Round ends'].map((n, k) => h('button', { class: 'btn', 'aria-pressed': String(!!el.round === !!k), onclick: () => set({ round: k ? 100 : 0 }, true) }, n))),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!el.dash, onchange: (e) => set({ dash: e.target.checked }, true) }), ' Dashed'),
          h('p', { class: 'hint' }, 'Make the box taller than it is wide for a vertical line.'));
      } else if (el.type === 'box') {
        const shape = el.shape || 'rect';
        props.append(sel('Shape', shape, SHAPES.filter(([v]) => v !== 'line'), (v) => set({ shape: v }, true)),
          shape === 'ellipse' ? null : corners(el, set),
          shape === 'star' ? num('Star points', 'points', 1, el, 3) : null,
          paintPicker(el.paint || (el.fill ? { type: 'solid', color: el.fill } : { type: 'none' }), (f) => set(f.type === 'none' ? { fill: '', paint: null } : f.type === 'solid' ? { fill: f.color, paint: null } : { fill: el.fill || '#ffffff', paint: f }, true), { unit: 'mm', dither: false, none: 'No fill', label: 'Fill' }),
          num('Border mm', 'thick', 0.1, el, 0),
          h('div', { class: 'row2' }, h('label', { class: 'field' }, h('span', null, 'Border colour'), h('input', { class: 'input', type: 'color', value: el.stroke || '#000000', onchange: (e) => set({ stroke: e.target.value }, true) })),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!el.dash, onchange: (e) => set({ dash: e.target.checked }, true) }), ' Dashed')),
          h('h3', null, 'Border lines'),
          h('div', { class: 'seg' }, h('button', { class: 'btn', 'aria-pressed': String(!el.lines), onclick: () => set({ lines: null }, true) }, 'One line'),
            h('button', { class: 'btn', 'aria-pressed': String(!!el.lines), title: 'Outer, middle and inner lines, each with its own colour', onclick: () => set({ lines: defaultLines(el.stroke || '#000000') }, true) }, 'Three lines')),
          el.lines ? ['outer', 'middle', 'inner'].map((k) => h('div', { class: 'row2' },
            h('label', { class: 'field' }, h('span', null, k[0].toUpperCase() + k.slice(1) + ' line'), h('input', { class: 'input', type: 'color', value: el.lines[k].color || '#ffffff', onchange: (e) => { el.lines[k].color = e.target.value; save(); rerender(); } })),
            h('label', { class: 'field' }, h('span', null, 'Width mm' + (k === 'middle' ? ', 0 = gap' : '')), h('input', { class: 'input', type: 'number', min: 0, step: 0.1, value: el.lines[k].color || k !== 'middle' ? el.lines[k].w : 0, onchange: (e) => { const v = Math.max(0, +e.target.value || 0); el.lines[k].w = v; if (k === 'middle' && v && !el.lines[k].color) el.lines[k].color = '#ffffff'; save(); rerender(); } })))) : null,
          h('h3', null, '3-D (face, side and edge colours)'),
          (() => { const v = h('b', null, el.depth ? el.depth + ' mm' : 'flat'); const r = h('input', { type: 'range', min: 0, max: 8, step: 0.2, value: el.depth || 0 }); r.oninput = () => { v.textContent = +r.value ? r.value + ' mm' : 'flat'; }; r.onchange = () => set({ depth: +r.value, side: el.side || '#6b6b6b' }, true); return h('label', { class: 'field' }, h('span', null, '3-D depth: ', v), r); })(),
          el.depth ? h('label', { class: 'field' }, h('span', null, 'Side colour (face = fill, edge = border colour)'), h('input', { class: 'input', type: 'color', value: el.side || '#6b6b6b', onchange: (e) => set({ side: e.target.value }, true) })) : null,
          h('h3', null, 'Words inside'),
          (() => { const ta = h('textarea', { class: 'input', rows: 3, placeholder: 'Words inside the shape (fields in {curly brackets} work too)' }, el.text || ''); ta.oninput = () => { el.text = ta.value; save(); redrawSel(); }; return ta; })(),
          h('div', { class: 'row2' }, num('Size (pt)', 'size', 0.5, el, 4), sel('Font', el.font || 'sans', [['sans', 'Sans (Arial)'], ['serif', 'Serif (Georgia)'], ['mono', 'Typewriter']], (v) => set({ font: v }, true))),
          h('div', { class: 'seg' },
            h('button', { class: 'btn', 'aria-pressed': String(!!el.bold), onclick: () => set({ bold: !el.bold }, true) }, h('b', null, 'B')),
            h('button', { class: 'btn', 'aria-pressed': String(!!el.italic), onclick: () => set({ italic: !el.italic }, true) }, h('i', null, 'I')),
            ['left', 'center', 'right'].map((a) => h('button', { class: 'btn', 'aria-pressed': String((el.align || 'center') === a), onclick: () => set({ align: a }, true) }, a[0].toUpperCase() + a.slice(1)))),
          h('div', { class: 'row2' }, h('label', { class: 'field' }, h('span', null, 'Text colour'), h('input', { class: 'input', type: 'color', value: el.color || '#000000', onchange: (e) => set({ color: e.target.value }, true) })), num('Padding mm', 'pad', 0.5, el, 0)),
          shape === 'rect' ? h('div', { class: 'seg' }, [['top', 'Top'], ['middle', 'Middle']].map(([v, n]) => h('button', { class: 'btn', 'aria-pressed': String((el.valign || 'middle') === v), onclick: () => set({ valign: v }, true) }, n))) : null);
      } else if (el.type === 'table') tableProps(el);
      if (el.type !== 'table') props.append(...shadowProps(el, set));

      // Opacity for every kind of item: lower lets what is behind show through.
      const opV = h('b', null, Math.round((el.opacity ?? 1) * 100) + '%');
      const opIn = h('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round((el.opacity ?? 1) * 100), 'aria-label': 'Opacity' });
      opIn.oninput = () => { el.opacity = +opIn.value / 100; opV.textContent = opIn.value + '%'; redrawSel(); };
      opIn.onchange = () => { el.opacity = +opIn.value / 100; save(); rerender(); };
      props.append(h('label', { class: 'field' }, h('span', null, 'Opacity (lower to see through): ', opV), opIn));
      props.append(h('div', { class: 'row2 actions' },
        h('button', { class: 'btn', onclick: () => { const c = JSON.parse(JSON.stringify(el)); c.id = uid(); c.x += 3; c.y += 3; page.elements.push(c); st.sel = c.id; save(); rerender(); }, disabled: el.type === 'table' }, 'Duplicate'),
        h('button', { class: 'btn danger', onclick: () => removeSel() }, 'Delete')),
        h('div', { class: 'row2' },
          h('button', { class: 'btn sm', onclick: () => { page.elements = [...page.elements.filter((x) => x !== el), el]; save(); rerender(); } }, 'Bring to front'),
          h('button', { class: 'btn sm', onclick: () => { page.elements = [el, ...page.elements.filter((x) => x !== el)]; save(); rerender(); } }, 'Send to back')));
    }
    function tableProps(el) {
      const sources = page.kind === 'list' ? [] : childLinks(page.table);
      const srcT = page.kind === 'list' ? t : el.source && db.table(el.source.table);
      if (page.kind === 'record') {
        props.append(h('label', { class: 'field' }, h('span', null, 'Rows come from'),
          h('select', { class: 'input', onchange: (e) => { const s = sources[+e.target.value]; el.source = s ? { table: s.table, link: s.link } : null; const st2 = s && db.table(s.table); el.columns = st2 ? st2.fields.filter((f) => f.name !== s.link).slice(0, 5).map((f) => ({ field: f.name, label: f.label, width: numericF(f) ? 1.2 : 2 })) : []; save(); rerender(); } },
            h('option', { value: '' }, sources.length ? 'Choose…' : 'No table links to ' + (t ? t.label : 'this table')),
            sources.map((s, i) => h('option', { value: i, selected: el.source && el.source.table === s.table && el.source.link === s.link }, s.label)))));
        if (!sources.length) props.append(h('p', { class: 'hint' }, `To list line items, make a table with a “Link to another table” field pointing at ${t ? t.label : 'this table'}.`));
      } else props.append(h('p', { class: 'hint' }, `Lists every record in ${t ? t.label : 'the table'}. Set grouping and sorting under Page (click an empty spot).`));
      if (srcT) {
        const fields = srcT.fields;
        props.append(h('span', { class: 'label' }, 'Columns'));
        el.columns.forEach((c, i) => {
          const f = fields.find((x) => x.name === c.field);
          const lab = h('input', { class: 'input', value: c.label ?? (f ? f.label : ''), 'aria-label': 'Column heading' });
          lab.onchange = () => { c.label = lab.value; save(); rerender(); };
          const w = h('input', { class: 'input', type: 'number', min: 0.2, step: 0.1, value: c.width || 1, title: 'Relative width', 'aria-label': 'Relative width' });
          w.onchange = () => { c.width = parseFloat(w.value) || 1; save(); rerender(); };
          props.append(h('div', { class: 'colrow' },
            h('select', { class: 'input', 'aria-label': 'Column field', onchange: (e) => { c.field = e.target.value; const nf = fields.find((x) => x.name === c.field); c.label = nf ? nf.label : c.label; if (!numericF(nf)) c.sum = false; save(); rerender(); } }, fields.map((x) => h('option', { value: x.name, selected: x.name === c.field }, x.label))),
            lab, w,
            numericF(f) ? h('label', { class: 'check', title: 'Add up this column' }, h('input', { type: 'checkbox', checked: !!c.sum, onchange: (e) => { c.sum = e.target.checked; save(); rerender(); } }), ' Σ') : h('span'),
            h('span', { class: 'nowrap' },
              h('button', { class: 'btn ghost sm', disabled: i === 0, 'aria-label': 'Move left', onclick: () => { [el.columns[i - 1], el.columns[i]] = [el.columns[i], el.columns[i - 1]]; save(); rerender(); } }, '↑'),
              h('button', { class: 'btn ghost sm danger-text', 'aria-label': 'Remove column', onclick: () => { el.columns.splice(i, 1); save(); rerender(); } }, '×'))));
        });
        props.append(h('button', { class: 'btn sm', onclick: () => { const f = fields.find((x) => !el.columns.some((c) => c.field === x.name)) || fields[0]; if (f) { el.columns.push({ field: f.name, label: f.label, width: numericF(f) ? 1.2 : 2 }); save(); rerender(); } } }, '+ Add column'),
          h('p', { class: 'hint' }, 'Σ adds up a column. The first Σ column feeds {Subtotal}, {Tax} and {Total}.'));
      }
      const sel = (label, value, options, key) => h('label', { class: 'field' }, h('span', null, label), h('select', { class: 'input', onchange: (e) => { el[key] = e.target.value; save(); rerender(); } }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))));
      props.append(h('div', { class: 'row2' },
        (() => { const i = h('input', { class: 'input', type: 'number', step: 0.5, min: 5, value: el.size || 9 }); i.onchange = () => { el.size = parseFloat(i.value) || 9; save(); rerender(); }; return h('label', { class: 'field' }, h('span', null, 'Text size (pt)'), i); })(),
        sel('Heading row', el.head || 'dark', [['dark', 'Dark'], ['light', 'Light'], ['none', 'Hidden']], 'head')),
        h('div', { class: 'row2' }, sel('Lines', el.lines || 'rows', [['rows', 'Between rows'], ['grid', 'Full grid'], ['none', 'None']], 'lines'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!el.stripes, onchange: (e) => { el.stripes = e.target.checked; save(); rerender(); } }), ' Striped rows')),
        paintPicker(el.bgPaint || { type: 'none' }, (f) => { el.bgPaint = f.type === 'none' ? null : f; save(); rerender(); }, { unit: 'mm', dither: false, label: 'Table background', base: '#e8f0fe' }),
        el.columns.some((c) => c.sum) ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: el.totalRow !== false, onchange: (e) => { el.totalRow = e.target.checked; save(); rerender(); } }), ' Show a total row at the end') : null,
        h('p', { class: 'hint' }, 'The table fills its box, then continues on a new page. Items above it show on the first page, items below it on the last page.'));
    }
    function redrawSel() {
      const el = selEl(); if (!el) return;
      const old = dpage.querySelector('.del.sel');
      const d = elementEl(el, ctx, { page: 1, pages: 1 }, true);
      d.classList.add('del', 'sel'); d.append(h('span', { class: 'handle', 'data-h': 'se' }));
      d.addEventListener('pointerdown', (e) => startDrag(e, el, d));
      if (old) old.replaceWith(d);
    }
    function removeSel() { page.elements = page.elements.filter((e) => e.id !== st.sel); st.sel = null; save(); rerender(); }
    renderProps();

    // Keyboard: delete and nudge the selected item.
    if (DC._pageKeys) document.removeEventListener('keydown', DC._pageKeys);
    DC._pageKeys = (e) => {
      if (DC.state.view !== 'page' || st.mode !== 'design' || !st.sel || DC.$('.backdrop')) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const el = selEl(); if (!el) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); return; }
      if (e.key === 'Escape') { st.sel = null; rerender(); return; }
      const step = e.shiftKey ? 5 : 0.5;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) { e.preventDefault(); el.x += mv[0]; el.y += mv[1]; save(); const d = dpage.querySelector('.del.sel'); if (d) { d.style.left = el.x + 'mm'; d.style.top = el.y + 'mm'; } updatePos(); }
    };
    document.addEventListener('keydown', DC._pageKeys);
  }

  Object.assign(DC, { pageView, newPageDialog, autoLayout, renderDoc, printPages, childLinks, PAGE_SIZES: SIZES, _uid: uid });
})(window.DC);
