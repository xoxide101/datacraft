/* Clip art for any Craft app (window.CraftClipartPicker): a window that shows the clip-art library and hands the
   picture chosen to the app, as a file (each app puts it where its own "insert picture" would). Every Craft app keeps
   its own copy of this file (the same as clipartcraft/js/clipart-picker.js).
   Where the pictures come from:
     - the clip-art server (the one ClipArtCraft is connected to, or one beside this app on the same website): browsed
       straight from the server (its thumbnails); only the picture chosen is fetched, nothing else is copied
     - this browser's library (IndexedDB 'craft-clipart', the store every Craft app shares)
   CraftClipartPicker.open({ app, svg: true, onPick(pic) })
     pic = { name, file (a File: the SVG when svg is true and there is one, else the PNG), png: Blob, svg: string | null,
             width, height, category, style, tags } */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // ------------------------------------------------------------------ this browser's library (read only)
  let dbp = null;
  const db = () => (dbp = dbp || new Promise((ok, no) => { const r = indexedDB.open('craft-clipart', 1); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' }); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); }; r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }));
  // this browser's own pictures only (big sets are kept in books, ids starting "!": browsed on the server instead)
  const readMain = async () => { const d = await db(); return new Promise((ok, no) => { const q = d.transaction('items', 'readonly').objectStore('items').getAll(IDBKeyRange.lowerBound('"')); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); };
  const read = async (store, key) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction(store, 'readonly'), s = t.objectStore(store), q = key === undefined ? s.getAll() : s.get(key); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); };
  // ------------------------------------------------------------------ the server
  const tidy = (u) => String(u || '').trim().replace(/\/+$/, '');
  async function answers(u) { try { const c = new AbortController(), t = setTimeout(() => c.abort(), 2500), r = await fetch(u + '/api/info', { signal: c.signal }); clearTimeout(t); const j = await r.json(); return !!(j && j.server); } catch (e) { return false; } }
  // the one ClipArtCraft uses (kept in the shared library), else one beside this app on its website
  async function findServer() {
    const tries = []; try { const s = tidy(await read('meta', 'server')); if (s) tries.push(s); } catch (e) { /* no library yet */ }
    if (/^https?:$/.test(location.protocol)) tries.push(tidy(new URL('../clipartcraft/server/clipart-server.php', location.href).href), tidy(new URL('server/clipart-server.php', location.href).href));
    for (const u of tries) if (await answers(u)) return u;
    return '';
  }
  // the key ClipArtCraft is connected with (kept in the shared library), sent to that same server: pictures only for me show too
  async function keyFor(u) { try { if (tidy(await read('meta', 'server')) === tidy(u)) { const k = await read('meta', 'serverKey'); if (k) return { headers: { 'x-craft-key': k } }; } } catch (e) { /* no library yet */ } return {}; }
  async function serverItems(u, q, category, offset) { const r = await fetch(`${u}/api/items?limit=120&offset=${offset || 0}&q=${encodeURIComponent(q || '')}${category ? `&category=${encodeURIComponent(category)}` : ''}`, await keyFor(u)); if (!r.ok) throw new Error('The server did not answer.'); return r.json(); }
  async function serverCats(u) { try { return (await (await fetch(u + '/api/categories', await keyFor(u))).json()).filter((c) => c.category); } catch (e) { return []; } }

  // ------------------------------------------------------------------ the window
  function open({ app = 'Craft', svg: takesSvg = true, onPick } = {}) {
    let source = 'server', server = '', q = '', cat = '', items = [], total = 0, cats = [], chosen = null, localAll = null, timer = 0;
    const back = document.createElement('div'); back.className = 'craft-clip'; back.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;box-sizing:border-box;z-index:2147483000;display:grid;place-items:center;grid-template-rows:100%;padding:16px;background:rgba(0,0,0,.5)';
    const shut = () => back.remove();
    back.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Clip art" style="width:min(1100px,100%);height:min(760px,calc(100vh - 32px));min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;gap:10px;padding:16px;border-radius:12px;border:1px solid var(--line,#555);background:var(--panel,#222);color:var(--fg,#eee);font:14px system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:10px"><b style="font-size:16px">Clip art</b><span data-where style="opacity:.75;font-size:12.5px;flex:1"></span><button type="button" data-a="close" class="btn outline">Close</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><div role="tablist" data-src style="display:flex;gap:4px"></div>
        <input data-q type="search" placeholder="Search names, tags, styles…" style="flex:1;min-width:180px;padding:7px 10px;border-radius:7px;border:1px solid var(--line,#555);background:var(--panel-2,#2a2a2a);color:inherit;font:inherit">
        <select data-cat style="padding:7px 8px;border-radius:7px;border:1px solid var(--line,#555);background:var(--panel-2,#2a2a2a);color:inherit;font:inherit"></select></div>
      <div style="display:grid;grid-template-columns:1fr 260px;gap:12px;min-height:0"><div data-grid style="overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;align-content:start;padding-right:4px"></div>
        <div data-side style="overflow:auto;display:grid;align-content:start;gap:8px;padding:10px;border-radius:9px;background:var(--panel-2,#2a2a2a)"></div></div>
      <div style="display:flex;gap:8px;align-items:center"><span data-count style="opacity:.75;font-size:12.5px;flex:1"></span><button type="button" data-a="more" class="btn outline" hidden>More</button><button type="button" data-a="insert" class="btn primary" disabled>Insert</button></div></div>`;
    const $ = (s) => back.querySelector(s), check = 'repeating-conic-gradient(#d9dbe3 0 25%, #fff 0 50%) 0 0 / 12px 12px';
    const tile = (it, i) => `<button type="button" data-i="${i}" title="${esc(it.name)}${it.style ? ' · ' + esc(it.style) : ''}" style="display:grid;grid-template-rows:96px auto;gap:4px;padding:6px;border-radius:8px;border:2px solid ${chosen === it ? 'var(--accent,#7c6cf0)' : 'transparent'};background:var(--panel-2,#2a2a2a);color:inherit;cursor:pointer;font:12px system-ui,sans-serif"><span style="display:grid;place-items:center;border-radius:6px;background:${check};overflow:hidden"><img loading="lazy" src="${esc(it.thumbUrl)}" alt="" style="max-width:100%;max-height:96px"></span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.name)}</span></button>`;
    function drawGrid() { $('[data-grid]').innerHTML = items.length ? items.map(tile).join('') : `<p style="opacity:.75;grid-column:1/-1">${source === 'server' && !server ? 'No clip-art server answers: connect one in ClipArtCraft (Server › Connect…), or choose This browser.' : 'Nothing found.'}</p>`; $('[data-count]').textContent = items.length ? `${items.length} of ${total} picture${total === 1 ? '' : 's'} · double-click one to insert it` : ''; $('[data-a=more]').hidden = !(source === 'server' && items.length < total); }
    function drawSide() {
      const s = $('[data-side]'); $('[data-a=insert]').disabled = !chosen; if (!chosen) { s.innerHTML = '<p style="opacity:.75;margin:0">Choose a picture.</p>'; return; }
      const sib = items.filter((x) => x !== chosen && x.subject && x.subject === chosen.subject && x.from === chosen.from);
      s.innerHTML = `<div style="display:grid;place-items:center;height:200px;border-radius:8px;background:${check}"><img src="${esc(chosen.thumbUrl)}" alt="" style="max-width:100%;max-height:200px"></div><b>${esc(chosen.name)}</b>
        <small style="opacity:.8">${[chosen.category, chosen.style, chosen.width && `${chosen.width} × ${chosen.height} px`, chosen.hasSvg ? 'PNG and SVG' : 'PNG'].filter(Boolean).map(esc).join(' · ')}</small>
        ${(chosen.tags || []).length ? `<small style="opacity:.7">${esc(chosen.tags.slice(0, 10).join(', '))}</small>` : ''}
        ${sib.length ? `<div><small style="opacity:.8">Same DNA / style</small><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${sib.map((x) => `<button type="button" data-i="${items.indexOf(x)}" title="${esc(x.name)}" style="width:52px;height:52px;padding:2px;border-radius:6px;border:1px solid var(--line,#555);background:${check};cursor:pointer"><img src="${esc(x.thumbUrl)}" alt="" style="max-width:100%;max-height:100%"></button>`).join('')}</div></div>` : ''}`;
    }
    const subjectOf = (it) => String(it.original || it.name || '').replace(/\s*[–-]\s.*$/, '').replace(/_\d{3,}$/, '').trim().toLowerCase();
    async function load(more) {
      if (source === 'server') {
        if (!server) { items = []; total = 0; drawGrid(); return; }
        const r = await serverItems(server, q, cat, more ? items.length : 0), got = r.items.map((it) => ({ name: it.name, category: it.category, style: it.style, tags: it.tags || [], width: it.width, height: it.height, original: it.original, thumbUrl: (it.links || {}).thumb || (it.links || {}).png, pngUrl: (it.links || {}).png, svgUrl: (it.links || {}).svg, hasSvg: !!(it.links || {}).svg, from: it.source || '' }));
        got.forEach((it) => { it.subject = subjectOf(it); }); items = more ? [...items, ...got] : got; total = r.total;
      } else {
        localAll = localAll || (await readMain()).filter((it) => it.png || it.svg || it.links).map((it) => ({ name: it.name, category: it.category, style: it.style, tags: it.tags || [], width: it.width, height: it.height, original: it.original, thumbUrl: it.thumb, item: it, hasSvg: !!it.svg, from: it.collection || it.sheet || it.source || '' }));
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        items = localAll.filter((it) => (!cat || it.category === cat) && words.every((w) => [it.name, it.category, it.style, it.tags.join(' ')].join(' ').toLowerCase().includes(w))).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        items.forEach((it) => { it.subject = subjectOf(it); }); total = items.length;
      }
      if (!items.includes(chosen)) chosen = null; drawGrid(); drawSide();
    }
    async function drawTabs() {
      const nLocal = (await read('items').catch(() => [])).length;
      $('[data-src]').innerHTML = [['server', `Clip-art server${server ? '' : ' (none)'}`], ['local', `This browser (${nLocal})`]].map(([k, l]) => `<button type="button" role="tab" data-s="${k}" aria-selected="${source === k}" class="btn ${source === k ? 'primary' : 'outline'}">${l}</button>`).join('');
      $('[data-where]').textContent = source === 'server' ? (server ? `From ${server.replace(/^https?:\/\//, '').replace(/\/clipart-server\.php$/, '')}: only the picture you insert is fetched.` : 'No server found.') : 'The library kept in this browser (ClipArtCraft).';
      const cl = source === 'server' ? cats.map((c) => [c.category, `${c.category} (${c.n})`]) : [...new Set((localAll || []).map((it) => it.category).filter(Boolean))].sort().map((c) => [c, c]);
      $('[data-cat]').innerHTML = `<option value="">All categories</option>${cl.map(([v, l]) => `<option value="${esc(v)}" ${v === cat ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
    }
    // the picture chosen, fetched (server) or read (this browser), handed to the app
    async function insert() {
      if (!chosen) return; const b = $('[data-a=insert]'); b.disabled = true; b.textContent = 'Getting it…';
      try {
        let png = null, svg = null;
        if (chosen.item) { png = chosen.item.png || null; svg = chosen.item.svg || null; const l = chosen.item.links || {}; if (!png && !svg) { if (l.png) png = await (await fetch(l.png)).blob(); if (takesSvg && l.svg) { try { const r = await fetch(l.svg); if (r.ok) svg = await r.text(); } catch (e) { /* the PNG will do */ } } } } // (one here as its data only: its files from the server)
        else { if (chosen.pngUrl) png = await (await fetch(chosen.pngUrl)).blob(); if (takesSvg && chosen.svgUrl) { try { const r = await fetch(chosen.svgUrl); if (r.ok) svg = await r.text(); } catch (e) { /* the PNG will do */ } } }
        const safe = chosen.name.replace(/[\\/:*?"<>|]+/g, '-'), file = takesSvg && svg ? new File([svg], safe + '.svg', { type: 'image/svg+xml' }) : new File([png], safe + '.png', { type: 'image/png' });
        shut(); onPick && onPick({ name: chosen.name, file, png, svg, width: chosen.width, height: chosen.height, category: chosen.category, style: chosen.style, tags: chosen.tags });
      } catch (e) { console.error(e); b.disabled = false; b.textContent = 'Insert'; $('[data-count]').textContent = 'Getting the picture failed: ' + (e.message || e); }
    }
    back.addEventListener('click', async (e) => {
      if (e.target === back || e.target.closest('[data-a=close]')) return shut();
      const s = e.target.closest('[data-s]'); if (s) { source = s.dataset.s; cat = ''; chosen = null; await drawTabs(); await load(); return; }
      const t = e.target.closest('[data-i]'); if (t) { chosen = items[+t.dataset.i]; drawGrid(); drawSide(); return; }
      if (e.target.closest('[data-a=more]')) return load(true);
      if (e.target.closest('[data-a=insert]')) return insert();
    });
    back.addEventListener('dblclick', (e) => { const t = e.target.closest('[data-grid] [data-i]'); if (t) { chosen = items[+t.dataset.i]; insert(); } });
    back.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { q = e.target.value; clearTimeout(timer); timer = setTimeout(() => load(), 250); } });
    back.addEventListener('change', (e) => { if (e.target.matches('[data-cat]')) { cat = e.target.value; load(); } });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut(); if (e.key === 'Enter' && chosen && !e.target.matches('[data-q]')) insert(); });
    (document.body || document.documentElement).append(back); $('[data-q]').focus();
    (async () => { $('[data-count]').textContent = 'Looking for the clip-art server…'; server = await findServer(); if (server) cats = await serverCats(server); else source = 'local'; await drawTabs(); await load(); })().catch((e) => { console.error(e); $('[data-count]').textContent = 'The clip art could not be read: ' + (e.message || e); });
  }
  window.CraftClipartPicker = { open };
})();
