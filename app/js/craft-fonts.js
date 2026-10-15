/* Fonts (the same in every Craft app, each app has its own copy): grouped font menus, "More fonts…", and a browser
   for every open-licence Google Fonts family. A font picked in the browser is downloaded once (it needs the internet
   then), turned into data the project keeps, and works offline from then on. The bundled fonts are in fonts/. */
(function () {
  'use strict';
  const SYSTEM = ['Arial', 'Arial Black', 'Calibri', 'Cambria', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Courier New', 'Franklin Gothic Medium', 'Garamond',
    'Georgia', 'Helvetica', 'Impact', 'Lucida Console', 'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
  const GROUP_NAMES = { S: 'Sans serif', E: 'Serif', D: 'Display', H: 'Handwriting', M: 'Monospace' };
  const MORE = '__more_fonts__';
  const added = new Map(); // family → @font-face CSS with the font data inside
  const listeners = [];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const CF = {
    base: 'fonts/', MORE, SYSTEM,
    bundled: () => (window.CRAFT_FONTS || []).map(([f]) => f),
    // [[group, [families]]]: added fonts first, then the bundled groups, then the fonts on this computer.
    groups(system = SYSTEM) {
      const g = new Map();
      if (added.size) g.set('Added fonts', [...added.keys()]);
      (window.CRAFT_FONTS || []).forEach(([f, grp]) => { if (!g.has(grp)) g.set(grp, []); g.get(grp).push(f); });
      if (system.length) g.set('On this computer', system);
      return [...g.entries()];
    },
    all(system = SYSTEM) { return CF.groups(system).flatMap(([, l]) => l); },
    // The <option>s for a font menu. toValue turns a family into the option's value (SiteCraft uses CSS font stacks).
    optionsHtml(selected, { system = SYSTEM, toValue = (f) => f, more = true } = {}) {
      const sel = String(selected || '').replace(/^['"]|['"]$/g, '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      let found = false;
      const html = CF.groups(system).map(([grp, list]) => `<optgroup label="${esc(grp)}">${list.map((f) => { const on = f === sel && !found; if (on) found = true;
        return `<option value="${esc(toValue(f))}" ${on ? 'selected' : ''} style="font-family:'${esc(f)}'">${esc(f)}</option>`; }).join('')}</optgroup>`).join('');
      return (!found && sel ? `<option value="${esc(toValue(sel))}" selected>${esc(sel)}</option>` : '') + html + (more ? `<option value="${MORE}">More fonts…</option>` : '');
    },
    fill(select, selected, opts) { select.innerHTML = CF.optionsHtml(selected, opts); return select; },
    // Called with (family) whenever a font is added, so the app can add it to its own lists.
    onAdd(fn) { listeners.push(fn); },
    has: (f) => added.has(f),
    saved: () => Object.fromEntries(added),
    // Put back the fonts a project kept (from saved()).
    restore(fonts) { Object.entries(fonts || {}).forEach(([f, css]) => install(f, css)); },
    load: (f) => (document.fonts && document.fonts.load ? Promise.all([document.fonts.load(`16px "${f}"`), document.fonts.load(`bold 16px "${f}"`)]).catch(() => {}) : Promise.resolve()),
    add, browse,
  };
  function install(family, css) {
    if (added.has(family)) return;
    added.set(family, css);
    const st = document.createElement('style'); st.dataset.craftFont = family; st.textContent = css; document.head.append(st);
    listeners.forEach((fn) => { try { fn(family); } catch (e) {} });
  }
  // Download a family from Google Fonts (regular and bold) and keep it as data.
  async function add(family, { bold = true } = {}) {
    if (added.has(family)) return family;
    const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}${bold ? ':wght@400;700' : ''}&display=swap`;
    let css = await (await fetch(url)).text();
    if (!/@font-face/.test(css) && bold) css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}&display=swap`)).text();
    const keep = new Set(['latin', 'latin-ext', 'symbols', 'math']); // symbol fonts (like Yarndings) keep their symbols
    const blocks = [...css.matchAll(/\/\* ([\w-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g)].filter(([, sub]) => keep.has(sub)).map((m) => m[2]);
    const list = blocks.length ? blocks : [...css.matchAll(/@font-face \{[\s\S]*?\}/g)].map((m) => m[0]);
    if (!list.length) throw new Error('Google Fonts did not send that font.');
    const cache = new Map();
    const out = [];
    for (const b of list) {
      const src = (b.match(/url\((https:[^)]+)\)/) || [])[1]; if (!src) continue;
      if (!cache.has(src)) { const buf = await (await fetch(src)).arrayBuffer(); let bin = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); cache.set(src, `data:font/woff2;base64,${btoa(bin)}`); }
      out.push(b.replace(src, cache.get(src)));
    }
    install(family, out.join('\n'));
    await CF.load(family);
    return family;
  }
  // "More fonts…" in any font menu opens the browser; the picked font is added and chosen in that menu.
  document.addEventListener('focusin', (e) => { if (e.target.tagName === 'SELECT' && e.target.querySelector(`option[value="${MORE}"]`)) e.target.dataset.cfPrev = e.target.value; }, true);
  document.addEventListener('mousedown', (e) => { const s = e.target.closest && e.target.closest('select'); if (s && s.querySelector(`option[value="${MORE}"]`)) s.dataset.cfPrev = s.value; }, true);
  document.addEventListener('change', (e) => {
    const s = e.target; if (s.tagName !== 'SELECT' || s.value !== MORE) return;
    e.stopImmediatePropagation();
    const prev = s.dataset.cfPrev && s.dataset.cfPrev !== MORE ? s.dataset.cfPrev : (s.querySelector('option:not([value="' + MORE + '"])') || {}).value;
    s.value = prev;
    browse().then((f) => {
      if (!f) return;
      const vo = [...s.options].find((o) => o.textContent === f) || (() => { const o = document.createElement('option'); o.value = s.dataset.cfStack ? `'${f}', ${s.dataset.cfStack}` : f; o.textContent = f; o.style.fontFamily = `'${f}'`; s.insertBefore(o, s.firstChild); return o; })();
      s.value = vo.value; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, true);

  // ---- the browser
  let catalog = null;
  const loadCatalog = () => catalog ? Promise.resolve(catalog) : new Promise((res) => {
    const done = () => { catalog = String(window.CRAFT_FONT_CATALOG || '').split('\n').filter(Boolean).map((r) => { const [f, g, st] = r.split('|'); return { f, g: GROUP_NAMES[g] || 'Sans serif', b: (st || '').includes('b') }; }); res(catalog); };
    if (window.CRAFT_FONT_CATALOG) return done();
    const sc = document.createElement('script'); sc.src = CF.base + 'catalog.js'; sc.onload = done; sc.onerror = done; document.head.append(sc);
  });
  function browse() {
    return new Promise(async (resolve) => {
      if (!document.getElementById('cf-style')) {
        const st = document.createElement('style'); st.id = 'cf-style';
        st.textContent = '.cf-bd{position:fixed;inset:0;background:rgba(0,0,0,.4);display:grid;place-items:center;z-index:100000}'
          + '.cf-dlg{background:var(--panel,#fff);color:var(--fg,#222);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);width:min(720px,95vw);height:min(640px,92vh);display:grid;grid-template-rows:auto auto auto 1fr auto;gap:10px;padding:18px 20px;font:14px/1.4 system-ui,"Segoe UI",sans-serif}'
          + '.cf-dlg h2{margin:0;font-size:17px}.cf-dlg input[type=search],.cf-dlg input[type=text]{height:32px;padding:0 10px;border:1px solid var(--line,#ccc);border-radius:7px;background:var(--panel,#fff);color:inherit;font:inherit}'
          + '.cf-top{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cf-groups{display:flex;flex-wrap:wrap;gap:4px}.cf-groups button{border:1px solid var(--line,#ccc);background:var(--panel,#fff);color:inherit;border-radius:20px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12px}'
          + '.cf-groups button[aria-pressed=true]{background:var(--accent,#2f6fdd);border-color:var(--accent,#2f6fdd);color:#fff}.cf-list{overflow:auto;border:1px solid var(--line,#ccc);border-radius:8px}'
          + '.cf-row{display:grid;grid-template-columns:200px 1fr;gap:10px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line,#eee);cursor:pointer}.cf-row:hover{background:var(--panel-2,#f4f4f4)}'
          + '.cf-row[aria-selected=true]{background:var(--accent,#2f6fdd);color:#fff}.cf-row small{display:block;opacity:.7;font-size:11px}.cf-row .cf-prev{font-size:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
          + '.cf-acts{display:flex;align-items:center;gap:8px}.cf-acts .cf-msg{flex:1;font-size:12px;opacity:.8}.cf-acts button{min-width:90px;height:32px;border-radius:7px;border:1px solid var(--line,#ccc);background:var(--panel-2,#f4f4f4);color:inherit;cursor:pointer;font:inherit}'
          + '.cf-acts .cf-ok{background:var(--accent,#2f6fdd);border-color:var(--accent,#2f6fdd);color:#fff}.cf-acts button:disabled{opacity:.5;cursor:default}@media(max-width:600px){.cf-row{grid-template-columns:1fr}.cf-top{grid-template-columns:1fr}}';
        document.head.append(st);
      }
      const bd = document.createElement('div'); bd.className = 'cf-bd';
      bd.innerHTML = `<div class="cf-dlg" role="dialog" aria-modal="true" aria-label="More fonts"><h2>More fonts</h2>
        <div class="cf-top"><input type="search" placeholder="Search 1,600 free fonts" aria-label="Search fonts"><input type="text" value="The quick brown fox jumps" aria-label="Preview words"></div>
        <div class="cf-groups">${['All', 'Sans serif', 'Serif', 'Display', 'Handwriting', 'Monospace'].map((g, i) => `<button type="button" data-g="${g}" aria-pressed="${i === 0}">${g}</button>`).join('')}</div>
        <div class="cf-list" role="listbox" aria-label="Fonts"><p style="padding:12px">Loading the list…</p></div>
        <div class="cf-acts"><span class="cf-msg">Free fonts from Google Fonts (open licences). Adding one needs the internet once; then it is kept in your project and works offline.</span><button type="button" data-x>Cancel</button><button type="button" class="cf-ok" data-ok disabled>Add font</button></div></div>`;
      document.body.append(bd);
      const [q, prevIn] = bd.querySelectorAll('input'), list = bd.querySelector('.cf-list'), ok = bd.querySelector('[data-ok]'), msg = bd.querySelector('.cf-msg');
      let group = 'All', pick = null;
      const done = (v) => { bd.remove(); resolve(v); };
      const rows = await loadCatalog();
      const have = new Set([...CF.bundled(), ...added.keys()]);
      const draw = () => {
        const term = q.value.trim().toLowerCase();
        const hits = rows.filter((r) => (group === 'All' || r.g === group) && (!term || r.f.toLowerCase().includes(term))).slice(0, 60);
        if (!rows.length) { list.innerHTML = '<p style="padding:12px">The font list is missing (fonts/catalog.js).</p>'; return; }
        list.innerHTML = hits.map((r) => `<div class="cf-row" role="option" data-f="${esc(r.f)}" aria-selected="${r.f === pick}"><div><b>${esc(r.f)}</b><small>${r.g}${have.has(r.f) ? ' · already here' : ''}</small></div><div class="cf-prev" style="font-family:'${esc(r.f)}', sans-serif">${esc(prevIn.value || r.f)}</div></div>`).join('') || '<p style="padding:12px">No fonts match.</p>';
        // previews: a tiny Google Fonts request with only the letters shown (works when online; otherwise names show in the plain font)
        if (navigator.onLine !== false) hits.forEach((r) => { const id = 'cfp-' + r.f.replace(/\W/g, ''); if (document.getElementById(id)) return; const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?family=${r.f.replace(/ /g, '+')}&text=${encodeURIComponent((prevIn.value || r.f) + r.f)}&display=swap`; document.head.append(l); });
      };
      let t = null; q.oninput = () => { clearTimeout(t); t = setTimeout(draw, 150); }; prevIn.onchange = () => { document.querySelectorAll('link[id^="cfp-"]').forEach((l) => l.remove()); draw(); };
      bd.querySelector('.cf-groups').onclick = (e) => { const b = e.target.closest('[data-g]'); if (!b) return; group = b.dataset.g; bd.querySelectorAll('[data-g]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); };
      list.onclick = (e) => { const r = e.target.closest('[data-f]'); if (!r) return; pick = r.dataset.f; list.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-selected', String(x === r))); ok.disabled = false; };
      list.ondblclick = (e) => { if (e.target.closest('[data-f]')) ok.click(); };
      bd.querySelector('[data-x]').onclick = () => done(null);
      bd.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); });
      ok.onclick = async () => {
        if (!pick) return;
        if (have.has(pick)) return done(pick);
        ok.disabled = true; msg.textContent = `Downloading ${pick}…`;
        try { const r = rows.find((x) => x.f === pick); await add(pick, { bold: !!(r && r.b) }); done(pick); }
        catch (err) { ok.disabled = false; msg.textContent = `Could not download ${pick}. Adding a new font needs the internet. (${err.message})`; }
      };
      draw(); q.focus();
    });
  }
  window.CraftFonts = CF;
})();
