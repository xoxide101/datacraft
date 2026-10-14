/* Craft title bar: the Office-style strip above everything, shared by the Craft apps.
   Left: the app's logo and quick buttons (Save, Undo, Redo…). Middle: the file name and whether it is saved.
   A command search (Alt+Q) finds anything in the menus and ribbon. Right: small app info, theme and help.
   Each app calls CraftTitlebar({...}) with its own buttons, info and commands. Same file in every app. */
window.CraftTitlebar = function (cfg) {
  'use strict';
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ICONS = {
    save: '<path d="M5 3h11l3 3v15H5Z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    open: '<path d="M3 6h6l2 2h10v11H3Z"/>',
    new: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7Z"/>',
    preview: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    export: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M4 15v5h16v-5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || k || ''}</svg>`;

  if (!document.getElementById('craft-titlebar-css')) {
    const s = mk('style'); s.id = 'craft-titlebar-css';
    s.textContent = `
.ctb { --ctb-a: #2f5bea; --ctb-b: #7b4fd6; position: relative; z-index: 60; display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 8px; background: linear-gradient(90deg, var(--ctb-a), var(--ctb-b)); color: #fff; min-width: 0; user-select: none; }
.ctb button { font: inherit; color: inherit; }
.ctb-left, .ctb-right { display: flex; align-items: center; gap: 2px; flex: none; }
.ctb-right { gap: 6px; }
.ctb-q, .ctb-icon { width: 30px; height: 28px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; display: grid; place-items: center; padding: 0; }
.ctb-q:hover, .ctb-icon:hover { background: rgba(255,255,255,.2); }
.ctb-q:disabled { opacity: .45; cursor: default; background: transparent; }
.ctb-q svg, .ctb-icon svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.ctb-sep { width: 1px; height: 18px; background: rgba(255,255,255,.35); margin: 0 5px; }
.ctb-app { font-weight: 700; letter-spacing: .01em; margin: 0 4px; white-space: nowrap; }
.ctb-mid { flex: 1; min-width: 0; display: flex; align-items: baseline; justify-content: center; gap: 8px; white-space: nowrap; overflow: hidden; }
.ctb-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.ctb-status { font-size: 11.5px; opacity: .85; }
.ctb-status.dirty::before { content: "● "; color: #ffe066; }
.ctb-search { position: relative; flex: 0 1 330px; min-width: 150px; }
.ctb-search > svg { position: absolute; left: 8px; top: 50%; width: 15px; height: 15px; transform: translateY(-50%); fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; opacity: .85; pointer-events: none; }
.ctb-search input { width: 100%; height: 27px; box-sizing: border-box; border: 0; border-radius: 7px; padding: 0 10px 0 29px; background: rgba(255,255,255,.2); color: #fff; font: inherit; font-size: 12.5px; }
.ctb-search input::placeholder { color: rgba(255,255,255,.85); }
.ctb-search input:focus { outline: none; background: #fff; color: #1d2330; }
.ctb-search input:focus + .ctb-kbd { display: none; }
.ctb-search:focus-within > svg { color: #1d2330; }
.ctb-kbd { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 10.5px; opacity: .75; pointer-events: none; }
.ctb-list { position: absolute; top: calc(100% + 6px); left: 0; min-width: 100%; width: max(100%, 380px); max-height: 64vh; overflow: auto; box-sizing: border-box; background: var(--panel, #fff); color: var(--fg, #1d2330); border: 1px solid var(--line, #d5d9e1); border-radius: 10px; box-shadow: 0 16px 38px rgba(0,0,0,.28); padding: 6px; z-index: 3000; user-select: none; }
.ctb-list h6 { margin: 6px 8px 4px; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; opacity: .6; }
.ctb-item { display: grid; grid-template-columns: 1fr auto; gap: 1px 12px; width: 100%; text-align: left; border: 0; background: transparent; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.ctb-item b { font-weight: 500; }
.ctb-item small { grid-column: 1; font-size: 11px; opacity: .65; }
.ctb-item kbd { grid-row: 1 / span 2; grid-column: 2; align-self: center; font: 11px ui-monospace, Consolas, monospace; opacity: .7; }
.ctb-item.on { background: var(--accent, #2f5bea); color: var(--accent-ink, #fff); }
.ctb-item.on small, .ctb-item.on kbd { opacity: .9; }
.ctb-item[aria-disabled="true"] { opacity: .45; }
.ctb-empty { padding: 10px; opacity: .7; }
.ctb-info { display: flex; gap: 5px; }
.ctb-chip { font-size: 11.5px; padding: 2px 9px; border-radius: 999px; background: rgba(255,255,255,.18); white-space: nowrap; border: 0; cursor: default; }
button.ctb-chip { cursor: pointer; }
.ctb .ctb-chip { font-size: 11.5px; line-height: 1.5; }
button.ctb-chip:hover { background: rgba(255,255,255,.3); }
.ctb-right .theme-btn, .ctb-right > .btn { color: #fff !important; background: transparent !important; border: 0 !important; box-shadow: none !important; width: 30px; height: 28px; }
.ctb-right .theme-btn:hover { background: rgba(255,255,255,.2) !important; }
@media (max-width: 1100px) { .ctb-info { display: none; } }
@media (max-width: 820px) { .ctb-status { display: none; } .ctb-search { flex-basis: 200px; } }
@media (max-width: 620px) { .ctb-mid { display: none; } .ctb-search { flex: 1; } }
@media print { .ctb { display: none !important; } }`;
    document.head.append(s);
  }

  const bar = mk('div', 'ctb');
  bar.setAttribute('role', 'banner');
  if (cfg.colors) { bar.style.setProperty('--ctb-a', cfg.colors[0]); bar.style.setProperty('--ctb-b', cfg.colors[1] || cfg.colors[0]); }

  // ---- Left: logo (or the app's own elements) and quick buttons ----
  const left = mk('div', 'ctb-left');
  (cfg.leftEls || []).filter(Boolean).forEach((e) => left.append(e));
  if (!cfg.leftEls || !cfg.leftEls.length) left.append(mk('span', 'ctb-app', cfg.appName));
  if ((cfg.quick || []).length) left.append(mk('span', 'ctb-sep'));
  const quickBtns = (cfg.quick || []).map((q) => {
    const b = mk('button', 'ctb-q'); b.type = 'button';
    b.innerHTML = icon(q.icon);
    b.title = q.title + (q.key ? ` (${q.key})` : '');
    b.setAttribute('aria-label', q.title);
    b.addEventListener('mousedown', (e) => e.preventDefault());   // keep the selection where it is
    b.addEventListener('click', () => q.run());
    left.append(b);
    return [b, q];
  });

  // ---- Middle: file name and save state ----
  const mid = mk('div', 'ctb-mid');
  const title = mk('span', 'ctb-title'), status = mk('span', 'ctb-status');
  mid.append(title, status);

  // ---- Search ----
  const sw = mk('div', 'ctb-search');
  sw.innerHTML = icon('search');
  const input = mk('input'); input.type = 'search'; input.placeholder = 'Search commands';
  input.setAttribute('aria-label', 'Search for a command'); input.autocomplete = 'off'; input.spellcheck = false;
  const kbd = mk('span', 'ctb-kbd', 'Alt+Q');
  sw.append(input, kbd);
  let list = null, items = [], cur = 0;
  const RECENT = (cfg.storageKey || 'craft') + '-recent-commands';
  const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]'); } catch (e) { return []; } };
  const remember = (label) => { try { localStorage.setItem(RECENT, JSON.stringify([label, ...recent().filter((x) => x !== label)].slice(0, 6))); } catch (e) {} };
  function commands() {
    const seen = new Set();
    return (cfg.getCommands ? cfg.getCommands() : []).filter((c) => c && c.label && c.run && !seen.has(c.label + '|' + (c.path || '')) && seen.add(c.label + '|' + (c.path || '')));
  }
  function search(q) {
    const all = commands();
    q = q.trim().toLowerCase();
    if (!q) { const r = recent(); return r.map((l) => all.find((c) => c.label === l)).filter(Boolean); }
    const words = q.split(/\s+/);
    return all.map((c) => {
      const label = c.label.toLowerCase(), hay = (label + ' ' + (c.path || '') + ' ' + (c.words || '')).toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      const score = (label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2) + (c.disabled && c.disabled() ? 3 : 0);
      return [score, c];
    }).filter(Boolean).sort((a, b) => a[0] - b[0] || a[1].label.length - b[1].label.length).slice(0, 14).map((x) => x[1]);
  }
  function close() { if (list) { list.remove(); list = null; } }
  function draw() {
    close();
    items = search(input.value); cur = 0;
    list = mk('div', 'ctb-list'); list.setAttribute('role', 'listbox');
    if (!input.value.trim()) list.append(mk('h6', null, items.length ? 'Recently used' : 'Type what you want to do, like “bold”, “print” or “save”'));
    if (input.value.trim() && !items.length) list.append(mk('div', 'ctb-empty', 'No command matches that. Try another word.'));
    items.forEach((c, i) => {
      const b = mk('button', 'ctb-item' + (i === 0 ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'option');
      const off = c.disabled && c.disabled();
      if (off) b.setAttribute('aria-disabled', 'true');
      b.append(mk('b', null, c.label));
      if (c.path) b.append(mk('small', null, c.path + (off ? ' · not available right now' : '')));
      if (c.key) b.append(mk('kbd', null, c.key));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => runItem(i));
      b.addEventListener('mouseenter', () => mark(i));
      list.append(b);
    });
    sw.append(list);
  }
  function mark(i) { cur = i; [...list.querySelectorAll('.ctb-item')].forEach((b, j) => b.classList.toggle('on', j === i)); list.querySelectorAll('.ctb-item')[i]?.scrollIntoView({ block: 'nearest' }); }
  function runItem(i) {
    const c = items[i]; if (!c) return;
    if (c.disabled && c.disabled()) { if (cfg.toast) cfg.toast(`“${c.label}” is not available right now.`); return; }
    remember(c.label);
    close(); input.value = ''; input.blur();
    setTimeout(() => c.run(), 0);
  }
  input.addEventListener('focus', draw);
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) mark((cur + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) mark((cur - 1 + items.length) % items.length); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(cur); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); input.value = ''; input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));

  // ---- Right: app info, the app's own buttons (theme…), help ----
  const right = mk('div', 'ctb-right');
  const info = mk('div', 'ctb-info');
  right.append(info);
  (cfg.rightEls || []).filter(Boolean).forEach((e) => right.append(e));
  if (cfg.onHelp) {
    const h = mk('button', 'ctb-icon'); h.type = 'button'; h.innerHTML = icon('help'); h.title = 'Help'; h.setAttribute('aria-label', 'Help');
    h.addEventListener('click', cfg.onHelp);
    right.append(h);
  }
  bar.append(left, mid, sw, right);

  // ---- Keeping it current ----
  let lastInfo = '';
  function update() {
    title.textContent = cfg.getTitle ? cfg.getTitle() : cfg.appName;
    const st = cfg.getStatus ? cfg.getStatus() : null;
    status.textContent = st ? st.text : '';
    status.classList.toggle('dirty', !!(st && st.dirty));
    document.title = `${title.textContent} – ${cfg.appName}`;
    quickBtns.forEach(([b, q]) => { b.disabled = !!(q.disabled && q.disabled()); });
    const chips = cfg.getInfo ? cfg.getInfo() : [];
    const sig = JSON.stringify(chips.map((c) => [c.text, c.title]));
    if (sig !== lastInfo) {
      lastInfo = sig; info.textContent = '';
      chips.forEach((c) => {
        const el = mk(c.run ? 'button' : 'span', 'ctb-chip', c.text);
        if (c.title) el.title = c.title;
        if (c.run) { el.type = 'button'; el.addEventListener('click', c.run); }
        info.append(el);
      });
    }
  }
  setInterval(update, 700);
  const focusSearch = () => { input.focus(); input.select(); };
  const altQ = (e) => { if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'q' || e.key === 'Q')) { e.preventDefault(); focusSearch(); } };
  document.addEventListener('keydown', altQ);

  (cfg.mount || document.body).prepend(bar);
  update();
  return { el: bar, update, focusSearch, listenTo: (doc) => doc.addEventListener('keydown', altQ) };
};
