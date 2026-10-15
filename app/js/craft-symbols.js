/* The Symbols picker (the same in every Craft app, each app has its own copy): dingbats and emoji, searchable by name.
   CraftSymbols.open({ onPick }) shows it as a window; CraftSymbols.mount(element, { onPick }) puts it in a panel.
   onPick gets { char, font, kind }: font is the font the symbol needs ('' = any), kind is 'dingbat' or 'emoji'.
   The data (fonts/symbols.js) loads the first time the picker opens. */
(function () {
  'use strict';
  const EMOJI_COLOUR = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
  const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
  const TONE_SWATCH = ['#ffcc33', '#f7dece', '#f3d2a2', '#d5ab88', '#af7e57', '#7c533e'];
  const RECENT_KEY = 'craft-symbols-recent';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  let data = null;
  const load = () => data ? Promise.resolve(data) : new Promise((res) => {
    const done = () => { data = window.CRAFT_SYMBOLS || null; res(data); };
    if (window.CRAFT_SYMBOLS) return done();
    const s = document.createElement('script'); s.src = ((window.CraftFonts && window.CraftFonts.base) || 'fonts/') + 'symbols.js'; s.onload = done; s.onerror = done; document.head.append(s);
  });
  const chars = (str) => Array.from(str);
  const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } };
  const remember = (r) => { try { const list = [r, ...recent().filter((x) => !(x.char === r.char && x.font === r.font))].slice(0, 24); localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {} };
  // A skin tone goes right after the first character (most people and hand emoji).
  const withTone = (e, t) => { if (!t) return e; const cs = chars(e); if (cs[1] === '️') cs.splice(1, 1); cs.splice(1, 0, t); return cs.join(''); };
  function style() {
    if (document.getElementById('cs-style')) return;
    const st = document.createElement('style'); st.id = 'cs-style';
    st.textContent = '.cs-bd{position:fixed;inset:0;background:rgba(0,0,0,.4);display:grid;place-items:center;z-index:100000}'
      + '.cs-dlg{background:var(--panel,#fff);color:var(--fg,#222);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);width:min(760px,96vw);height:min(660px,94vh);display:flex;flex-direction:column;padding:16px 18px;font:14px/1.4 system-ui,"Segoe UI",sans-serif}'
      + '.cs{display:flex;flex-direction:column;gap:8px;min-height:0;flex:1;font:13px/1.4 system-ui,"Segoe UI",sans-serif}.cs-head{display:flex;gap:8px;align-items:center}.cs-head h2{margin:0;font-size:17px;flex:1}'
      + '.cs-tabs{display:flex;gap:2px;padding:2px;border:1px solid var(--line,#ccc);border-radius:8px;background:var(--panel-2,#f3f3f3)}.cs-tabs button{border:0;background:none;color:inherit;padding:5px 12px;border-radius:6px;cursor:pointer;font:inherit}'
      + '.cs-tabs button[aria-pressed=true]{background:var(--panel,#fff);color:var(--accent,#2f6fdd);box-shadow:0 1px 2px rgba(0,0,0,.12)}'
      + '.cs-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.cs-bar input[type=search],.cs-bar select{height:30px;border:1px solid var(--line,#ccc);border-radius:7px;background:var(--panel,#fff);color:inherit;font:inherit;padding:0 8px;min-width:0}'
      + '.cs-bar input[type=search]{flex:1 1 160px}.cs-chips{display:flex;flex-wrap:wrap;gap:4px}.cs-chips button{border:1px solid var(--line,#ccc);background:var(--panel,#fff);color:inherit;border-radius:20px;padding:2px 9px;cursor:pointer;font:inherit;font-size:12px}'
      + '.cs-chips button[aria-pressed=true]{background:var(--accent,#2f6fdd);border-color:var(--accent,#2f6fdd);color:#fff}'
      + '.cs-grid{flex:1;min-height:120px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(42px,1fr));gap:3px;align-content:start;border:1px solid var(--line,#ccc);border-radius:8px;padding:4px}'
      + '.cs-grid button{height:42px;border:1px solid transparent;border-radius:6px;background:none;color:inherit;font-size:24px;line-height:1;cursor:pointer;padding:0;overflow:hidden}.cs-grid button:hover{border-color:var(--accent,#2f6fdd);background:var(--panel-2,#f4f4f4)}'
      + '.cs-grid h4{grid-column:1/-1;margin:6px 2px 0;font-size:11px;font-weight:600;color:var(--muted,#777);text-transform:uppercase;letter-spacing:.04em}'
      + '.cs-foot{display:flex;gap:10px;align-items:center;min-height:52px}.cs-big{width:52px;height:52px;display:grid;place-items:center;font-size:36px;border:1px solid var(--line,#ccc);border-radius:8px}.cs-info{flex:1;font-size:12px;color:var(--muted,#666)}.cs-info b{color:var(--fg,#222);display:block;font-size:13px}'
      + '.cs-tones{display:flex;gap:3px}.cs-tones button{width:20px;height:20px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}.cs-tones button[aria-pressed=true]{border-color:var(--fg,#222)}'
      + '.cs-close{height:32px;min-width:80px;border-radius:7px;border:1px solid var(--line,#ccc);background:var(--panel-2,#f4f4f4);color:inherit;cursor:pointer;font:inherit}.cs.slim .cs-foot{display:none}.cs.slim .cs-grid{grid-template-columns:repeat(auto-fill,minmax(36px,1fr))}.cs.slim .cs-grid button{height:36px;font-size:20px}';
    document.head.append(st);
  }
  // Build the picker into `host`. slim = a narrow side panel (no footer).
  function build(host, { onPick, slim = false, close } = {}) {
    style();
    const st = { tab: 'dingbat', set: 0, group: 0, egroup: -1, tone: 0, mono: false, q: '' };
    try { Object.assign(st, JSON.parse(localStorage.getItem('craft-symbols-state') || '{}'), { q: '' }); } catch (e) {}
    const save = () => { try { localStorage.setItem('craft-symbols-state', JSON.stringify({ tab: st.tab, set: st.set, group: st.group, egroup: st.egroup, tone: st.tone, mono: st.mono })); } catch (e) {} };
    const box = document.createElement('div'); box.className = 'cs' + (slim ? ' slim' : '');
    box.innerHTML = `<div class="cs-head">${close ? '<h2>Symbols and emoji</h2>' : ''}<div class="cs-tabs" role="tablist"><button type="button" data-tab="dingbat">Dingbats</button><button type="button" data-tab="emoji">Emoji</button></div></div>
      <div class="cs-bar"></div><div class="cs-chips"></div><div class="cs-grid" role="listbox" aria-label="Symbols"><p style="grid-column:1/-1;padding:8px">Loading…</p></div>
      <div class="cs-foot"><div class="cs-big"></div><div class="cs-info"><b>Click a symbol to put it in.</b>Hover to see its name. Typing? It goes in where the cursor is.</div>${close ? '<button type="button" class="cs-close">Close</button>' : ''}</div>`;
    host.append(box);
    const bar = box.querySelector('.cs-bar'), chips = box.querySelector('.cs-chips'), grid = box.querySelector('.cs-grid'), big = box.querySelector('.cs-big'), info = box.querySelector('.cs-info');
    if (close) box.querySelector('.cs-close').onclick = close;
    let items = []; // what the grid shows: { char, font, name, kind }
    const fontCss = (f, kind) => (kind === 'emoji' ? (st.mono ? "'Noto Emoji', " + EMOJI_COLOUR : EMOJI_COLOUR) : f ? `'${f}', 'Noto Sans Symbols 2', 'Segoe UI Symbol', sans-serif` : "'Noto Sans Symbols 2', 'Segoe UI Symbol', sans-serif");
    const tile = (it, i) => `<button type="button" data-i="${i}" title="${esc(it.name)}" style="font-family:${esc(fontCss(it.font, it.kind))}">${esc(it.char)}</button>`;
    function render() {
      box.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === st.tab)));
      if (!data) { grid.innerHTML = '<p style="grid-column:1/-1;padding:8px">The symbols list is missing (fonts/symbols.js).</p>'; return; }
      const q = st.q.trim().toLowerCase();
      items = []; let html = '';
      const rec = recent().filter((r) => (r.kind || 'dingbat') === st.tab);
      if (st.tab === 'dingbat') {
        const set = data.sets[st.set] || data.sets[0];
        bar.innerHTML = `<select aria-label="Symbol set">${data.sets.map((s, i) => `<option value="${i}" ${i === st.set ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><input type="search" placeholder="Search by name (star, arrow, heart…)" value="${esc(st.q)}">`;
        chips.innerHTML = set.groups.length > 1 ? set.groups.map((g, i) => `<button type="button" data-g="${i}" aria-pressed="${i === st.group}">${esc(g[0])}</button>`).join('') : '';
        const add = (c, n, f, kind = 'dingbat') => { items.push({ char: c, name: n, font: f, kind }); return tile(items[items.length - 1], items.length - 1); };
        if (rec.length && !q) html += '<h4>Recently used</h4>' + rec.map((r) => add(r.char, r.name || '', r.font)).join('');
        const groups = q ? set.groups : [set.groups[Math.min(st.group, set.groups.length - 1)]];
        groups.forEach((g) => { const cs = chars(g[1]), names = g[2].split('|'); const part = cs.map((c, k) => (!q || names[k].includes(q) ? add(c, names[k], set.font) : '')).join(''); if (part) html += `<h4>${esc(g[0])}</h4>` + part; });
      } else {
        bar.innerHTML = `<input type="search" placeholder="Search emoji (cat, pizza, party…)" value="${esc(st.q)}"><span class="cs-tones" title="Skin tone">${TONES.map((t, i) => `<button type="button" data-tone="${i}" aria-pressed="${i === st.tone}" style="background:${TONE_SWATCH[i]}" aria-label="Skin tone ${i || 'default'}"></button>`).join('')}</span>`
          + `<select aria-label="Emoji style"><option value="c" ${st.mono ? '' : 'selected'}>Colour emoji</option><option value="m" ${st.mono ? 'selected' : ''}>One colour (you can colour it like text)</option></select>`;
        chips.innerHTML = `<button type="button" data-eg="-1" aria-pressed="${st.egroup === -1}">All</button>` + data.emoji.map((g, i) => `<button type="button" data-eg="${i}" aria-pressed="${i === st.egroup}">${esc(g[0])}</button>`).join('');
        const add = (c, n) => { items.push({ char: c, name: n, font: st.mono ? 'Noto Emoji' : '', kind: 'emoji' }); return tile(items[items.length - 1], items.length - 1); };
        if (rec.length && !q) html += '<h4>Recently used</h4>' + rec.map((r) => add(r.char, r.name || '')).join('');
        let shown = 0;
        data.emoji.forEach((g, gi) => {
          if (!q && st.egroup !== -1 && gi !== st.egroup) return;
          const es = g[1].split(' '), names = g[2].split('|');
          const part = es.map((e, k) => { if (q && !names[k].includes(q)) return ''; if (shown++ > 600) return ''; return add(g[3][k] === '1' ? withTone(e, TONES[st.tone]) : e, names[k]); }).join('');
          if (part) html += `<h4>${esc(g[0])}</h4>` + part;
        });
      }
      grid.innerHTML = html || '<p style="grid-column:1/-1;padding:8px">Nothing matches.</p>';
      const sel = bar.querySelector('select'), qi = bar.querySelector('input[type=search]');
      if (sel) sel.onchange = () => { if (st.tab === 'dingbat') { st.set = +sel.value; st.group = 0; } else st.mono = sel.value === 'm'; save(); render(); };
      qi.oninput = () => { st.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { const pos = qi.selectionStart; render(); const n = bar.querySelector('input[type=search]'); n.focus(); n.setSelectionRange(pos, pos); }, 150); };
    }
    box.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || !box.contains(t)) return;
      if (t.dataset.tab) { st.tab = t.dataset.tab; st.q = ''; save(); render(); }
      else if (t.dataset.g) { st.group = +t.dataset.g; st.q = ''; save(); render(); }
      else if (t.dataset.eg) { st.egroup = +t.dataset.eg; st.q = ''; save(); render(); }
      else if (t.dataset.tone) { st.tone = +t.dataset.tone; save(); render(); }
      else if (t.dataset.i != null && grid.contains(t)) {
        const it = items[+t.dataset.i]; if (!it) return;
        const r = { char: it.char, font: it.kind === 'emoji' ? (st.mono ? 'Noto Emoji' : '') : it.font || '', kind: it.kind, name: it.name };
        remember(r); onPick && onPick(r);
        if (!slim) render();
      }
    });
    grid.addEventListener('mouseover', (e) => { const t = e.target.closest('[data-i]'); if (!t) return; const it = items[+t.dataset.i]; if (!it) return; big.style.fontFamily = fontCss(it.font, it.kind); big.textContent = it.char;
      info.innerHTML = `<b>${esc(it.name || '')}</b>${it.kind === 'emoji' ? (st.mono ? 'Noto Emoji (one colour)' : 'Colour emoji (your computer’s)') : esc(it.font || 'Any font')} · U+${Array.from(it.char).map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')}`; });
    box.querySelector('.cs-tabs').addEventListener('click', () => {});
    load().then(render);
    return box;
  }
  window.CraftSymbols = {
    EMOJI_COLOUR,
    // the CSS font list for a picked symbol
    fontFor: (r) => (r.kind === 'emoji' ? (r.font === 'Noto Emoji' ? "'Noto Emoji', " + EMOJI_COLOUR : EMOJI_COLOUR) : r.font ? `'${r.font}', 'Noto Sans Symbols 2', 'Segoe UI Symbol', sans-serif` : "'Noto Sans Symbols 2', 'Segoe UI Symbol', sans-serif"),
    mount(host, opts) { return build(host, { ...opts, slim: true }); },
    open(opts = {}) {
      const bd = document.createElement('div'); bd.className = 'cs-bd';
      const dlg = document.createElement('div'); dlg.className = 'cs-dlg'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', 'Symbols and emoji');
      bd.append(dlg); document.body.append(bd);
      const close = () => { bd.remove(); opts.onClose && opts.onClose(); };
      build(dlg, { ...opts, close });
      bd.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
      bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
      setTimeout(() => { const q = dlg.querySelector('input[type=search]'); if (q) q.focus(); }, 60);
      return { close };
    },
  };
})();
