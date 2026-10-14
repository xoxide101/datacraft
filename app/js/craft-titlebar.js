/* Craft title bar and ribbon, shared by the Craft apps (the same file in every app).
   CraftTitlebar: the Office-style strip at the very top. Logo (opens every menu side by side), quick buttons
   (people can hide them or add any command), file name and save state, command search (Alt+Q), info, theme, help.
   CraftRibbon: tabs of labelled buttons in named groups, one color per tab. Apps describe their tabs in a few lines. */
(function () {
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
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
    more: '<path d="m7 10 5 5 5-5"/>',
    // Ribbon icons (24 × 24; parts with class "fill" are tinted with the tab color)
    copy: '<rect x="9" y="9" width="11" height="11" rx="2" class="fill"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
    paste: '<rect x="5" y="4" width="14" height="17" rx="2" class="fill"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
    cut: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8 16 18 4M16 16 6 4"/>',
    duplicate: '<rect x="3" y="3" width="12" height="12" rx="2" class="fill"/><rect x="9" y="9" width="12" height="12" rx="2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    selectAll: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2"/><path d="m8 12 3 3 5-6"/>',
    clear: '<path d="m7 21-4-4 10-10 8 8-6 6Z" class="fill"/><path d="M11 9l6 6M7 21h13"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2" class="fill"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    day: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><rect x="7" y="13" width="4" height="4" rx="1" class="fill"/>',
    week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M6 15h12" stroke-width="3"/>',
    prev: '<path d="m14 6-6 6 6 6"/>',
    next: '<path d="m10 6 6 6-6 6"/>',
    move: '<path d="M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
    severalDays: '<rect x="2" y="7" width="7" height="10" rx="1.5" class="fill"/><path d="M12 12h3M18 9l3 3-3 3"/><rect x="13" y="4" width="0" height="0"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2" class="fill"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
    timeline: '<path d="M3 20h18"/><rect x="4" y="5" width="9" height="3" rx="1.5" class="fill"/><rect x="8" y="10" width="11" height="3" rx="1.5" class="fill"/><rect x="5" y="15" width="7" height="3" rx="1.5" class="fill"/>',
    person: '<circle cx="12" cy="8" r="4" class="fill"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
    team: '<circle cx="9" cy="8" r="3.5" class="fill"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.8-3.5 3.6-5.5 6.5-5.5s5.7 2 6.5 5.5M15.5 14.5c2.6.2 4.6 2 5.2 4.5"/>',
    checklist: '<path d="m4 6 1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2" class="fill"/><path d="m3 7 9 6 9-6"/>',
    share: '<circle cx="6" cy="12" r="2.5" class="fill"/><circle cx="18" cy="6" r="2.5" class="fill"/><circle cx="18" cy="18" r="2.5" class="fill"/><path d="m8.2 11 7.6-3.8M8.2 13l7.6 3.8"/>',
    picture: '<rect x="3" y="5" width="18" height="14" rx="2" class="fill"/><circle cx="9" cy="10" r="1.8"/><path d="m3 17 5-4 4 3 3-2 6 4"/>',
    screen: '<rect x="2" y="4" width="20" height="13" rx="1.5" class="fill"/><path d="M8 21h8M12 17v4"/>',
    gear: '<circle cx="12" cy="12" r="3" class="fill"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    store: '<path d="M4 10h16v10H4Z" class="fill"/><path d="M3 10 5 4h14l2 6M9 20v-5h6v5"/>',
    textFile: '<path d="M6 3h8l4 4v14H6Z" class="fill"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3Z" class="fill"/>',
    import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v5h16v-5"/>',
    exportUp: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v5h16v-5"/>',
    page: '<path d="M6 3h8l4 4v14H6Z" class="fill"/><path d="M14 3v4h4M9 12h6M9 16h4"/>',
    newPage: '<path d="M6 3h8l4 4v14H6Z" class="fill"/><path d="M14 3v4h4M12 11v6M9 14h6"/>',
    db: '<ellipse cx="12" cy="6" rx="7" ry="3" class="fill"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"/>',
    console: '<rect x="3" y="4" width="18" height="16" rx="2" class="fill"/><path d="m7 9 3 3-3 3M12 15h5"/>',
    globe: '<circle cx="12" cy="12" r="9" class="fill"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4Z" class="fill"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    barcode: '<path d="M4 5v14M7 5v14M9.5 5v14M13 5v14M15 5v14M18 5v14M20 5v14"/>',
    qr: '<rect x="4" y="4" width="6" height="6" class="fill"/><rect x="14" y="4" width="6" height="6" class="fill"/><rect x="4" y="14" width="6" height="6" class="fill"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
    box: '<rect x="4" y="6" width="16" height="12" rx="1" class="fill"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6" class="fill"/>',
    line: '<path d="M4 18 20 6"/>',
    rotL: '<path d="M3 4v6h6"/><path d="M3.5 10A9 9 0 1 1 6 17"/>',
    rotR: '<path d="M21 4v6h-6"/><path d="M20.5 10A9 9 0 1 0 18 17"/>',
    rot180: '<path d="M4 12a8 8 0 0 1 15-4M20 12a8 8 0 0 1-15 4"/><path d="M19 4v4h-4M5 20v-4h4"/>',
    front: '<rect x="3" y="3" width="11" height="11" rx="1.5"/><rect x="10" y="10" width="11" height="11" rx="1.5" class="fill"/>',
    back: '<rect x="3" y="3" width="11" height="11" rx="1.5" class="fill"/><rect x="10" y="10" width="11" height="11" rx="1.5"/>',
    turn: '<rect x="4" y="7" width="12" height="9" rx="1.5" class="fill"/><path d="M20 9v8a2 2 0 0 1-2 2H9M18 6l2 3 2-3"/>',
    zoomIn: '<circle cx="10.5" cy="10.5" r="6.5" class="fill"/><path d="m15.5 15.5 5 5M8 10.5h5M10.5 8v5"/>',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6.5" class="fill"/><path d="m15.5 15.5 5 5M8 10.5h5"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1" class="fill"/>',
    actual: '<circle cx="10.5" cy="10.5" r="6.5" class="fill"/><path d="m15.5 15.5 5 5M9 8.5l1.5-1v6"/>',
    safe: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1" stroke-dasharray="2 2" class="fill"/>',
    snap: '<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="3" class="fill"/>',
    ruler: '<rect x="2" y="8" width="20" height="8" rx="1.5" class="fill"/><path d="M6 8v3M10 8v4M14 8v3M18 8v4"/>',
    sun: '<circle cx="12" cy="12" r="4" class="fill"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" class="fill"/>',
    desktop: '<rect x="2" y="4" width="20" height="13" rx="1.5" class="fill"/><path d="M8 21h8M12 17v4"/>',
    clock: '<circle cx="12" cy="12" r="9" class="fill"/><path d="M12 7v5l3 2"/>',
  };
  window.CraftIcons = ICONS;
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || k || ''}</svg>`;
  const store = {
    get(key, def) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} },
  };

  // ---------- Styles ----------
  if (!document.getElementById('craft-titlebar-css')) {
    const s = mk('style'); s.id = 'craft-titlebar-css';
    s.textContent = `
.ctb { --ctb-a: #2f5bea; --ctb-b: #7b4fd6; position: relative; z-index: 60; display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 8px; background: linear-gradient(90deg, var(--ctb-a), var(--ctb-b)); color: #fff; min-width: 0; user-select: none; box-sizing: border-box; }
.ctb button { font: inherit; color: inherit; }
.ctb-left, .ctb-right { display: flex; align-items: center; gap: 2px; flex: none; }
.ctb-right { gap: 6px; }
.ctb-logo { width: 32px; height: 32px; padding: 0; border: 0; border-radius: 9px; background: transparent; cursor: pointer; display: grid; place-items: center; box-shadow: 0 0 0 1.5px rgba(255,255,255,.55); transition: transform .15s; margin-right: 2px; }
.ctb-logo:hover { transform: translateY(-1px) rotate(-3deg); }
.ctb-logo[aria-expanded="true"] { box-shadow: 0 0 0 3px rgba(255,255,255,.7); }
.ctb-logo svg { width: 32px; height: 32px; display: block; border-radius: 9px; }
.ctb-q, .ctb-icon { min-width: 30px; height: 28px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; display: inline-grid; grid-auto-flow: column; align-items: center; justify-content: center; gap: 5px; padding: 0 6px; }
.ctb-q.text { font-size: 12px; padding: 0 8px; background: rgba(255,255,255,.12); }
.ctb-q:hover, .ctb-icon:hover, .ctb-q[aria-expanded="true"] { background: rgba(255,255,255,.2); }
.ctb-q:disabled { opacity: .45; cursor: default; background: transparent; }
.ctb-q svg, .ctb-icon svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.ctb-q.ctb-more { min-width: 20px; padding: 0 2px; }
.ctb-q.ctb-more svg { width: 13px; height: 13px; }
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
.ctb-list, .ctb-pop { position: absolute; top: calc(100% + 6px); left: 0; min-width: 100%; width: max(100%, 380px); max-height: 64vh; overflow: auto; box-sizing: border-box; background: var(--panel, #fff); color: var(--fg, #1d2330); border: 1px solid var(--line, #d5d9e1); border-radius: 10px; box-shadow: 0 16px 38px rgba(0,0,0,.28); padding: 6px; z-index: 3000; user-select: none; font-size: 13px; }
.ctb-pop { position: fixed; width: 340px; min-width: 0; max-width: calc(100vw - 16px); padding: 10px; }
.ctb-list h6, .ctb-pop h6 { margin: 6px 8px 4px; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; opacity: .6; }
.ctb-item { display: grid; grid-template-columns: 1fr auto; gap: 1px 12px; width: 100%; text-align: left; border: 0; background: transparent; padding: 6px 10px; border-radius: 6px; cursor: pointer; color: inherit; font: inherit; }
.ctb-item b { font-weight: 500; }
.ctb-item small { grid-column: 1; font-size: 11px; opacity: .65; }
.ctb-item kbd { grid-row: 1 / span 2; grid-column: 2; align-self: center; font: 11px ui-monospace, Consolas, monospace; opacity: .7; }
.ctb-item.on { background: var(--accent, #2f5bea); color: var(--accent-ink, #fff); }
.ctb-item.on small, .ctb-item.on kbd { opacity: .9; }
.ctb-item[aria-disabled="true"] { opacity: .45; }
.ctb-empty { padding: 10px; opacity: .7; }
.ctb-pop label.ctb-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 6px; cursor: pointer; }
.ctb-pop label.ctb-row:hover { background: rgba(127,127,127,.12); }
.ctb-pop .ctb-row button { margin-left: auto; border: 0; background: transparent; cursor: pointer; color: inherit; opacity: .7; font-size: 15px; }
.ctb-pop input[type="search"] { width: 100%; box-sizing: border-box; height: 30px; padding: 0 10px; border: 1px solid var(--line, #d5d9e1); border-radius: 7px; background: var(--panel-2, #f3f4f6); color: inherit; font: inherit; margin: 4px 0; }
.ctb-pop .ctb-hint { font-size: 11.5px; opacity: .65; padding: 2px 8px 6px; }
.ctb-info { display: flex; gap: 5px; }
.ctb-chip { font-size: 11.5px; padding: 2px 9px; border-radius: 999px; background: rgba(255,255,255,.18); white-space: nowrap; border: 0; cursor: default; }
button.ctb-chip { cursor: pointer; }
button.ctb-chip:hover { background: rgba(255,255,255,.3); }
.ctb .ctb-chip { font-size: 11.5px; line-height: 1.5; }
.ctb-right .theme-btn, .ctb-right > .btn { color: #fff !important; background: transparent !important; border: 0 !important; box-shadow: none !important; width: 30px; height: 28px; }
.ctb-right .theme-btn:hover { background: rgba(255,255,255,.2) !important; }
.ctb-mega { position: fixed; z-index: 3000; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(190px, max-content); gap: 4px; max-width: calc(100vw - 16px); max-height: calc(100vh - 60px); overflow: auto; padding: 10px; background: var(--panel, #fff); color: var(--fg, #1d2330); border: 1px solid var(--line, #d5d9e1); border-radius: 12px; box-shadow: 0 18px 44px rgba(0,0,0,.28); font-size: 13px; }
.ctb-mega h4 { margin: 2px 8px 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--accent, #2f5bea); }
.ctb-mega .ctb-mi { display: grid; grid-template-columns: 16px 1fr auto; gap: 8px; align-items: center; width: 100%; text-align: left; border: 0; background: transparent; padding: 6px 10px 6px 6px; border-radius: 6px; cursor: pointer; color: inherit; font: inherit; white-space: nowrap; }
.ctb-mega .ctb-mi:hover:not(:disabled), .ctb-mega .ctb-mi:focus-visible { background: var(--accent, #2f5bea); color: var(--accent-ink, #fff); outline: none; }
.ctb-mega .ctb-mi:disabled { opacity: .45; cursor: default; }
.ctb-mega .ctb-mi kbd { font: 11px ui-monospace, Consolas, monospace; opacity: .7; }
.ctb-mega .ctb-mh { padding: 6px 10px 3px 30px; font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; opacity: .6; }
.ctb-mega hr { border: 0; border-top: 1px solid var(--line, #d5d9e1); margin: 5px 4px; }
@media (max-width: 1100px) { .ctb-info { display: none; } }
@media (max-width: 820px) { .ctb-status { display: none; } .ctb-search { flex-basis: 200px; } .ctb-q.text { display: none; } }
@media (max-width: 620px) { .ctb-mid { display: none; } .ctb-search { flex: 1; } }
/* Ribbon */
.crb { background: var(--panel, #fff); border-bottom: 1px solid var(--line, #d5d9e1); min-width: 0; user-select: none; }
.crb-tabs { display: flex; align-items: flex-end; gap: 2px; padding: 5px 10px 0; background: var(--panel-2, #eef0f4); border-bottom: 1px solid var(--line, #d5d9e1); overflow-x: auto; scrollbar-width: none; }
.crb-tab { position: relative; border: 1px solid transparent; border-bottom: 0; background: transparent; padding: 6px 14px 7px; border-radius: 8px 8px 0 0; font: inherit; font-weight: 600; font-size: 12.5px; color: var(--muted, #667085); cursor: pointer; white-space: nowrap; margin-bottom: -1px; }
.crb-tab:hover { color: var(--fg, #1d2330); background: var(--panel, #fff); }
.crb-tab[aria-selected="true"] { color: var(--fg, #1d2330); background: var(--panel, #fff); border-color: var(--line, #d5d9e1); }
.crb-tab[aria-selected="true"]::after { content: ""; position: absolute; left: 12px; right: 12px; top: 0; height: 3px; border-radius: 0 0 3px 3px; background: var(--hue); }
.crb-tabs .crb-extra { margin-left: auto; align-self: center; display: flex; gap: 4px; align-items: center; padding-bottom: 4px; }
.crb-collapse { align-self: center; border: 0; background: transparent; color: var(--muted, #667085); cursor: pointer; padding: 4px 8px; border-radius: 6px; font: inherit; margin-bottom: 4px; }
.crb-body { display: flex; padding: 6px 6px 2px; overflow-x: auto; overflow-y: hidden; height: 98px; box-sizing: border-box; }
.crb.collapsed .crb-body { display: none; }
.crb-panel { display: flex; align-items: stretch; }
.crb-panel[hidden] { display: none; }
.crb-group { display: flex; flex-direction: column; padding: 0 8px; border-right: 1px solid var(--line, #d5d9e1); }
.crb-group:last-child { border-right: 0; }
.crb-gbody { display: flex; align-items: flex-start; gap: 3px; flex: 1; }
.crb-col { display: flex; flex-direction: column; gap: 1px; }
.crb-label { text-align: center; font-size: 10.5px; color: var(--muted, #667085); padding: 3px 0 2px; white-space: nowrap; }
.crb-big, .crb-small { border: 0; background: transparent; cursor: pointer; color: var(--fg, #1d2330); font: inherit; }
.crb-big { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 56px; max-width: 80px; padding: 5px 5px 4px; border-radius: 8px; font-size: 11.5px; line-height: 1.15; text-align: center; }
.crb-big svg { width: 28px; height: 28px; flex: none; }
.crb-small { display: flex; align-items: center; gap: 6px; height: 25px; padding: 0 8px 0 5px; border-radius: 5px; font-size: 12px; white-space: nowrap; }
.crb-small svg { width: 17px; height: 17px; flex: none; }
.crb-big svg, .crb-small svg { fill: none; stroke: var(--hue); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.crb-big svg .fill, .crb-small svg .fill { fill: var(--hue-soft); }
.crb-big:hover, .crb-small:hover { background: var(--hue-soft); }
.crb-big[aria-pressed="true"], .crb-small[aria-pressed="true"] { background: var(--hue-soft); color: var(--hue); }
.crb-big:disabled, .crb-small:disabled { opacity: .45; cursor: default; background: transparent; }
.crb-el { display: flex; align-items: center; }
@media print { .ctb, .crb, .ctb-mega, .ctb-pop { display: none !important; } }`;
    document.head.append(s);
  }

  // ---------- The logo menu: every classic menu side by side ----------
  function megaMenu(btn, menus) {
    let open = null;
    const close = () => { if (!open) return; open.remove(); open = null; btn.setAttribute('aria-expanded', 'false'); };
    function show() {
      if (open) { close(); return; }
      open = mk('div', 'ctb-mega'); open.setAttribute('role', 'menu');
      menus().filter((m) => !m[2] || m[2]()).forEach(([name, items]) => {
        const col = mk('div'); col.append(mk('h4', null, name));
        items.forEach((it) => {
          if (!it) return;
          if (it === '-') { col.append(mk('hr')); return; }
          if (it.heading) { col.append(mk('div', 'ctb-mh', it.heading)); return; }
          const b = mk('button', 'ctb-mi'); b.type = 'button'; b.setAttribute('role', 'menuitem');
          const on = !!(it.checked && it.checked());
          b.append(mk('span', null, on ? '✓' : ''), mk('span', null, typeof it.label === 'function' ? it.label() : it.label), mk('kbd', null, it.key || ''));
          b.disabled = !!(it.disabled && it.disabled());
          b.addEventListener('click', () => { close(); it.run(); });
          col.append(b);
        });
        open.append(col);
      });
      document.body.append(open);
      const r = btn.getBoundingClientRect();
      open.style.top = (r.bottom + 6) + 'px';
      open.style.left = Math.max(8, Math.min(r.left, innerWidth - open.offsetWidth - 8)) + 'px';
      btn.setAttribute('aria-expanded', 'true');
      open.addEventListener('keydown', (e) => {
        const all = [...open.querySelectorAll('.ctb-mi:not(:disabled)')], i = all.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
      });
      open.querySelector('.ctb-mi:not(:disabled)')?.focus();
    }
    btn.addEventListener('click', show);
    document.addEventListener('mousedown', (e) => { if (open && !open.contains(e.target) && !btn.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) { close(); btn.focus(); }
      if (e.key === 'F10') { e.preventDefault(); show(); }
    });
    window.addEventListener('blur', close);
    return { show, close };
  }

  // =====================================================================
  // Title bar
  // =====================================================================
  window.CraftTitlebar = function (cfg) {
    const bar = mk('div', 'ctb');
    bar.setAttribute('role', 'banner');
    if (cfg.colors) { bar.style.setProperty('--ctb-a', cfg.colors[0]); bar.style.setProperty('--ctb-b', cfg.colors[1] || cfg.colors[0]); }
    const key = (cfg.storageKey || 'craft');

    // Left: logo (opens the menus) or the app's own elements, then the quick buttons
    const left = mk('div', 'ctb-left');
    if (cfg.logo) {
      const logo = mk('button', 'ctb-logo'); logo.type = 'button';
      logo.innerHTML = cfg.logo;
      logo.title = `${cfg.appName} menus: ${(cfg.menus ? cfg.menus().map((m) => m[0]).join(', ') : '')} (F10)`;
      logo.setAttribute('aria-label', `${cfg.appName} menus`); logo.setAttribute('aria-haspopup', 'true');
      left.append(logo);
      if (cfg.menus) megaMenu(logo, cfg.menus);
    }
    (cfg.leftEls || []).filter(Boolean).forEach((e) => left.append(e));
    if (!cfg.logo && !(cfg.leftEls || []).length) left.append(mk('span', 'ctb-app', cfg.appName));
    const quickWrap = mk('div', 'ctb-left');
    left.append(mk('span', 'ctb-sep'), quickWrap);

    // People can hide built-in quick buttons and add any command (kept in this browser).
    let custom = store.get(key + '-quick', { hide: [], add: [] });
    const saveCustom = () => store.set(key + '-quick', custom);
    let quickBtns = [];
    function renderQuick() {
      quickWrap.textContent = '';
      quickBtns = [];
      const add = (q, text) => {
        const b = mk('button', 'ctb-q' + (text ? ' text' : '')); b.type = 'button';
        b.innerHTML = q.icon ? svg(q.icon) : '';
        if (text) b.append(document.createTextNode(q.short || q.title));
        b.title = q.title + (q.key ? ` (${q.key})` : '') + ' · right-click to remove';
        b.setAttribute('aria-label', q.title);
        b.addEventListener('mousedown', (e) => e.preventDefault());   // keep the selection where it is
        b.addEventListener('click', () => q.run());
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (q.builtIn) custom.hide = [...new Set([...custom.hide, q.title])]; else custom.add = custom.add.filter((x) => x !== q.title);
          saveCustom(); renderQuick();
          cfg.toast && cfg.toast(`Removed “${q.title}” from the top bar. Use ⌄ to add it back.`);
        });
        quickWrap.append(b);
        quickBtns.push([b, q]);
      };
      (cfg.quick || []).filter((q) => !custom.hide.includes(q.title)).forEach((q) => add({ ...q, builtIn: true }));
      const all = commands();
      custom.add.forEach((label) => {
        const c = all.find((x) => x.label === label);
        if (c) add({ title: c.label, short: c.label.replace(/…$/, '').slice(0, 18), icon: c.icon || '', key: c.key, run: c.run, disabled: c.disabled }, !c.icon);
      });
      const more = mk('button', 'ctb-q ctb-more'); more.type = 'button';
      more.innerHTML = svg('more'); more.title = 'Customize the quick buttons'; more.setAttribute('aria-label', 'Customize the quick buttons');
      more.addEventListener('click', () => customize(more));
      quickWrap.append(more);
      update();
    }
    let pop = null;
    function closePop() { if (pop) { pop.remove(); pop = null; } }
    function customize(btn) {
      if (pop) { closePop(); return; }
      pop = mk('div', 'ctb-pop');
      pop.append(mk('h6', null, 'Quick buttons'));
      (cfg.quick || []).forEach((q) => {
        const row = mk('label', 'ctb-row');
        const box = mk('input'); box.type = 'checkbox'; box.checked = !custom.hide.includes(q.title);
        box.addEventListener('change', () => { custom.hide = box.checked ? custom.hide.filter((x) => x !== q.title) : [...custom.hide, q.title]; saveCustom(); renderQuick(); });
        row.append(box, mk('span', null, q.title));
        pop.append(row);
      });
      if (custom.add.length) {
        pop.append(mk('h6', null, 'Added by you'));
        custom.add.forEach((label) => {
          const row = mk('label', 'ctb-row'); row.append(mk('span', null, '★'), mk('span', null, label));
          const x = mk('button', null, '×'); x.type = 'button'; x.title = 'Remove';
          x.addEventListener('click', () => { custom.add = custom.add.filter((l) => l !== label); saveCustom(); renderQuick(); closePop(); customize(btn); });
          row.append(x); pop.append(row);
        });
      }
      pop.append(mk('h6', null, 'Add a command'));
      const find = mk('input'); find.type = 'search'; find.placeholder = 'Type a command, like “print” or “bold”';
      const results = mk('div');
      const draw = () => {
        results.textContent = '';
        const found = search(find.value).filter((c) => !custom.add.includes(c.label)).slice(0, 7);
        if (!find.value.trim()) { results.append(mk('div', 'ctb-hint', 'Pick any command to keep it one click away at the top.')); return; }
        if (!found.length) { results.append(mk('div', 'ctb-hint', 'No command matches.')); return; }
        found.forEach((c) => {
          const b = mk('button', 'ctb-item'); b.type = 'button';
          b.append(mk('b', null, c.label)); if (c.path) b.append(mk('small', null, c.path));
          b.addEventListener('click', () => { custom.add = [...custom.add, c.label]; saveCustom(); renderQuick(); closePop(); cfg.toast && cfg.toast(`Added “${c.label}” to the top bar.`); });
          results.append(b);
        });
      };
      find.addEventListener('input', draw);
      pop.append(find, results);
      const reset = mk('button', 'ctb-item'); reset.type = 'button'; reset.append(mk('b', null, 'Reset to the standard buttons'));
      reset.addEventListener('click', () => { custom = { hide: [], add: [] }; saveCustom(); renderQuick(); closePop(); });
      pop.append(mk('hr'), reset);
      document.body.append(pop);
      const r = btn.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + 'px';
      pop.style.left = Math.max(8, Math.min(r.left - 20, innerWidth - pop.offsetWidth - 8)) + 'px';
      draw(); find.focus();
    }
    document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('.ctb-more')) closePop(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

    // Middle: file name and save state
    const mid = mk('div', 'ctb-mid');
    const title = mk('span', 'ctb-title'), status = mk('span', 'ctb-status');
    mid.append(title, status);

    // Search over every command (menus and ribbon)
    const sw = mk('div', 'ctb-search');
    sw.innerHTML = svg('search');
    const input = mk('input'); input.type = 'search'; input.placeholder = 'Search commands';
    input.setAttribute('aria-label', 'Search for a command'); input.autocomplete = 'off'; input.spellcheck = false;
    sw.append(input, mk('span', 'ctb-kbd', 'Alt+Q'));
    let list = null, items = [], cur = 0;
    const RECENT = key + '-recent-commands';
    const recent = () => store.get(RECENT, []);
    const remember = (label) => store.set(RECENT, [label, ...recent().filter((x) => x !== label)].slice(0, 6));
    function commands() {
      const seen = new Set(), out = [];
      const fromMenus = cfg.menus ? cfg.menus().filter((m) => !m[2] || m[2]()).flatMap(([name, its]) => its.filter((it) => it && it !== '-' && !it.heading && it.run)
        .map((it) => ({ label: typeof it.label === 'function' ? it.label() : it.label, path: name + ' menu', key: it.key, run: it.run, disabled: it.disabled }))) : [];
      [...(cfg.getCommands ? cfg.getCommands() : []), ...fromMenus, ...(cfg.ribbon ? cfg.ribbon.commands() : [])].forEach((c) => {
        if (!c || !c.label || !c.run) return;
        const k = c.label + '|' + (c.path || '');
        if (!seen.has(k)) { seen.add(k); out.push(c); }
      });
      return out;
    }
    function search(q) {
      const all = commands();
      q = q.trim().toLowerCase();
      if (!q) return recent().map((l) => all.find((c) => c.label === l)).filter(Boolean);
      const words = q.split(/\s+/);
      return all.map((c) => {
        const label = c.label.toLowerCase(), hay = (label + ' ' + (c.path || '') + ' ' + (c.words || '')).toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        return [(label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2) + (c.disabled && c.disabled() ? 3 : 0), c];
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
      if (c.disabled && c.disabled()) { cfg.toast && cfg.toast(`“${c.label}” is not available right now.`); return; }
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

    // Right: info, the app's own buttons (theme…), help
    const right = mk('div', 'ctb-right');
    const info = mk('div', 'ctb-info');
    right.append(info);
    (cfg.rightEls || []).filter(Boolean).forEach((e) => right.append(e));
    if (cfg.onHelp) {
      const h = mk('button', 'ctb-icon'); h.type = 'button'; h.innerHTML = svg('help'); h.title = 'Help'; h.setAttribute('aria-label', 'Help');
      h.addEventListener('click', cfg.onHelp);
      right.append(h);
    }
    bar.append(left, mid, sw, right);

    let lastInfo = '';
    function update() {
      title.textContent = cfg.getTitle ? cfg.getTitle() : cfg.appName;
      const st = cfg.getStatus ? cfg.getStatus() : null;
      status.textContent = st ? st.text : '';
      status.classList.toggle('dirty', !!(st && st.dirty));
      document.title = `${title.textContent} – ${cfg.appName}`;
      quickBtns.forEach(([b, q]) => { b.disabled = !!(q.disabled && q.disabled()); });
      const chips = (cfg.getInfo ? cfg.getInfo() : []).filter(Boolean);
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
    renderQuick();
    return { el: bar, update, focusSearch, listenTo: (doc) => doc.addEventListener('keydown', altQ), refreshQuick: renderQuick };
  };

  // =====================================================================
  // Ribbon: tabs of labelled buttons in named groups
  //   tabs: [{ id, label, hue, soft, onSelect, show, groups: [[label, [item…]]] }]
  //   item: { label, icon, run, big, title, key, pressed: () => bool, disabled: () => bool } | { col: [item…] } | { el: element }
  // =====================================================================
  window.CraftRibbon = function (cfg) {
    const key = (cfg.storageKey || 'craft');
    const rb = mk('div', 'crb');
    const tabs = mk('div', 'crb-tabs'); tabs.setAttribute('role', 'tablist');
    const body = mk('div', 'crb-body');
    rb.append(tabs, body);
    const panels = {}, btns = {}, items = [];
    const isSoft = (hue) => hue + '1f';
    function makeItem(it, panel) {
      if (it.col) { const c = mk('div', 'crb-col'); it.col.forEach((x) => c.append(makeItem(x, panel))); return c; }
      if (it.el) { const w = mk('div', 'crb-el'); w.append(typeof it.el === 'function' ? it.el() : it.el); return w; }
      const b = mk('button', it.big ? 'crb-big' : 'crb-small'); b.type = 'button';
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${it.icon || ''}</svg>`;
      if (it.big) b.append(mk('span', null, it.label)); else b.append(document.createTextNode(it.label));
      b.title = (it.title || it.label) + (it.key ? ` (${it.key})` : '');
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => it.run(b));
      items.push({ it, b, panel });
      return b;
    }
    cfg.tabs.forEach((t) => {
      const b = mk('button', 'crb-tab', t.label); b.type = 'button'; b.setAttribute('role', 'tab');
      b.style.setProperty('--hue', t.hue || '#2f5bea');
      b.addEventListener('click', () => select(t.id, true));
      b.addEventListener('dblclick', toggle);
      tabs.append(b); btns[t.id] = b;
      const p = mk('div', 'crb-panel'); p.setAttribute('role', 'tabpanel'); p.hidden = true;
      p.style.setProperty('--hue', t.hue || '#2f5bea'); p.style.setProperty('--hue-soft', t.soft || isSoft(t.hue || '#2f5bea'));
      t.groups.forEach(([label, list]) => {
        const g = mk('div', 'crb-group'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
        const gb = mk('div', 'crb-gbody'); list.forEach((it) => gb.append(makeItem(it, t)));
        g.append(gb, mk('div', 'crb-label', label));
        p.append(g);
      });
      body.append(p); panels[t.id] = p;
    });
    const extra = mk('div', 'crb-extra');
    (cfg.extraEls || []).filter(Boolean).forEach((e) => extra.append(e));
    const col = mk('button', 'crb-collapse', '⌃'); col.type = 'button'; col.title = 'Hide or show the ribbon buttons (double-click a tab does the same)';
    col.addEventListener('click', toggle);
    tabs.append(extra, col);
    let current = null;
    function select(id, user) {
      const t = cfg.tabs.find((x) => x.id === id) || cfg.tabs[0];
      current = t.id;
      Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== t.id; });
      Object.entries(btns).forEach(([k, b]) => b.setAttribute('aria-selected', k === t.id));
      if (user) { if (rb.classList.contains('collapsed')) toggle(); store.set(key + '-ribbon-tab', t.id); if (t.onSelect) t.onSelect(); }
      refresh();
    }
    function toggle() {
      const c = rb.classList.toggle('collapsed');
      col.textContent = c ? '⌄' : '⌃';
      store.set(key + '-ribbon-collapsed', c);
    }
    function refresh() {
      cfg.tabs.forEach((t) => { if (t.show) btns[t.id].hidden = !t.show(); });
      if (current && btns[current].hidden) select(cfg.tabs[0].id);
      items.forEach(({ it, b }) => {
        if (it.disabled) b.disabled = !!it.disabled();
        if (it.pressed) b.setAttribute('aria-pressed', String(!!it.pressed()));
      });
    }
    setInterval(refresh, 600);
    if (store.get(key + '-ribbon-collapsed', false)) toggle();
    if (cfg.after) cfg.after.after(rb); else (cfg.mount || document.body).prepend(rb);
    select(cfg.start || store.get(key + '-ribbon-tab', cfg.tabs[0].id));
    return {
      el: rb, select, refresh, current: () => current,
      commands: () => items.filter(({ panel }) => !panel.show || panel.show()).map(({ it, b, panel }) => ({
        label: it.label, path: `${panel.label} tab`, key: it.key, words: it.title || '', icon: it.icon && it.icon.length < 400 ? it.icon : '',
        run: () => { select(panel.id, true); it.run(b); }, disabled: it.disabled,
      })),
    };
  };
})();
