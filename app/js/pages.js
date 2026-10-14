/* DataCraft — page designer (invoices, record sheets, list reports), rendering with page breaks, printing. */
(function (DC) {
  'use strict';
  const { h, db, esc } = DC;
  const PX = 96 / 25.4; // CSS px per mm
  const SIZES = { letter: [215.9, 279.4, 'US Letter'], a4: [210, 297, 'A4'], legal: [215.9, 355.6, 'US Legal'] };
  const FONTS = { sans: 'Arial, Helvetica, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"Courier New", Consolas, monospace' };
  const SPECIALS = ['Today', 'Page', 'Pages', 'Count', 'Subtotal', 'TaxRate', 'Tax', 'Total'];
  const uid = () => Math.random().toString(36).slice(2, 9);
  const round = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v ?? '');
  const dims = (p) => { const [w, hh] = SIZES[p.size] || SIZES.letter; return p.orient === 'landscape' ? [hh, w] : [w, hh]; };
  const numericF = (f) => f && (['number', 'currency'].includes(f.type) || f.type === 'formula');
  const moneyF = (f) => f && (f.type === 'currency' || (f.type === 'formula' && f.opts.currency));

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
    switch (low) {
      case 'today': return DC.fmtDate(DC.todayIso());
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
    if (el.type === 'text') {
      Object.assign(d.style, { fontSize: el.size + 'pt', fontWeight: el.bold ? '700' : '400', fontStyle: el.italic ? 'italic' : 'normal', textAlign: el.align || 'left', color: el.color || '#000', fontFamily: FONTS[el.font] || FONTS.sans, background: el.fill || 'transparent' });
      if (el.fill) d.style.padding = '1.2mm 2mm';
      d.innerHTML = design ? designText(el.text) : fillText(el.text, ctx, info);
    } else if (el.type === 'image') {
      if (el.src) d.append(h('img', { src: el.src, alt: '', style: { objectFit: el.fit || 'contain' } }));
      else if (design) d.append(h('span', { class: 'ph-box' }, 'Image'));
    } else if (el.type === 'line') {
      const vertical = el.h > el.w;
      d.append(h('div', { class: 'line-in', style: vertical ? { left: '50%', top: 0, bottom: 0, width: el.thick + 'mm', background: el.color || '#000', transform: 'translateX(-50%)' } : { top: '50%', left: 0, right: 0, height: el.thick + 'mm', background: el.color || '#000', transform: 'translateY(-50%)' } }));
    } else if (el.type === 'box') {
      Object.assign(d.style, { border: el.thick ? `${el.thick}mm solid ${el.stroke || '#000'}` : 'none', background: el.fill || 'transparent', borderRadius: (el.radius || 0) + 'mm' });
    } else if (el.type === 'table') {
      const shell = tableShell(el, ctx);
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
      const pg = h('div', { class: 'ppage', style: { width: W + 'mm', height: H + 'mm' } });
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
      tool('Box', 'A rectangle with a border or fill', () => addEl({ type: 'box', x: M, y: M + 60, w: 60, h: 25, thick: 0.3, stroke: '#000000', fill: '', radius: 0 })),
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
    const dpage = h('div', { class: 'dpage', style: { width: W + 'mm', height: H + 'mm' } },
      h('div', { class: 'margin-guide', style: { left: '10mm', top: '10mm', right: '10mm', bottom: '10mm' } }));
    canvasWrap.append(dpage);
    const fitZoom = () => Math.min(1.5, Math.max(0.35, (canvasWrap.clientWidth - 48) / (W * PX)));
    st.zoom = st.zoom || 0;
    const applyZoom = () => { dpage.style.zoom = st.zoom || fitZoom(); };
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
    function renderProps() {
      props.textContent = '';
      const el = selEl();
      const set = (patch, full) => { Object.assign(el || page, patch); save(); if (full) rerender(); else redrawSel(); };
      const num = (label, key, step = 0.5, obj = el, min) => { const i = h('input', { class: 'input', type: 'number', step, min, value: round(obj[key]) }); i.onchange = () => { obj[key] = parseFloat(i.value) || 0; save(); rerender(); }; return h('label', { class: 'field' }, h('span', null, label), i); };
      const sel = (label, value, options, onChange) => h('label', { class: 'field' }, h('span', null, label), h('select', { class: 'input', onchange: (e) => onChange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, l))));
      if (!el) {
        props.append(h('h3', null, 'Page'),
          (() => { const i = h('input', { class: 'input', value: page.name }); i.onchange = () => { if (i.value.trim()) { page.name = i.value.trim(); save(); rerender(); } }; return h('label', { class: 'field' }, h('span', null, 'Name'), i); })(),
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
      const names = { text: 'Text', image: 'Image', line: 'Line', box: 'Box', table: 'Table' };
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
        props.append(h('label', { class: 'field' }, h('span', null, 'Text'), ta), ins,
          h('div', { class: 'row2' }, num('Size (pt)', 'size', 0.5, el, 4), sel('Font', el.font, [['sans', 'Sans (Arial)'], ['serif', 'Serif (Georgia)'], ['mono', 'Typewriter']], (v) => set({ font: v }))),
          h('div', { class: 'seg' },
            h('button', { class: 'btn', 'aria-pressed': String(!!el.bold), onclick: () => set({ bold: !el.bold }, true) }, h('b', null, 'B')),
            h('button', { class: 'btn', 'aria-pressed': String(!!el.italic), onclick: () => set({ italic: !el.italic }, true) }, h('i', null, 'I')),
            ['left', 'center', 'right'].map((a) => h('button', { class: 'btn', 'aria-pressed': String((el.align || 'left') === a), onclick: () => set({ align: a }, true) }, a[0].toUpperCase() + a.slice(1)))),
          h('div', { class: 'row2' },
            h('label', { class: 'field' }, h('span', null, 'Colour'), h('input', { class: 'input', type: 'color', value: el.color || '#000000', oninput: (e) => set({ color: e.target.value }) })),
            sel('Background', el.fill || '', [['', 'None'], ['#eeeeee', 'Light grey'], ['#000000', 'Black']], (v) => set({ fill: v, color: v === '#000000' ? '#ffffff' : el.color === '#ffffff' ? '#000000' : el.color }, true))));
      } else if (el.type === 'image') {
        const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => {
          const f = fileIn.files[0]; if (!f) return;
          if (f.size > 3e6) { DC.toast('Pick an image under 3 MB.'); return; }
          const r = new FileReader(); r.onload = () => set({ src: r.result }, true); r.readAsDataURL(f);
        } });
        props.append(fileIn, h('button', { class: 'btn', onclick: () => fileIn.click() }, el.src ? 'Replace image…' : 'Choose image…'),
          sel('Fit', el.fit, [['contain', 'Fit inside the box'], ['cover', 'Fill the box (may crop)']], (v) => set({ fit: v }, true)));
      } else if (el.type === 'line') {
        props.append(h('div', { class: 'row2' }, num('Thickness mm', 'thick', 0.1, el, 0.1),
          h('label', { class: 'field' }, h('span', null, 'Colour'), h('input', { class: 'input', type: 'color', value: el.color || '#000000', oninput: (e) => set({ color: e.target.value }) }))),
          h('p', { class: 'hint' }, 'Make the box taller than it is wide for a vertical line.'));
      } else if (el.type === 'box') {
        props.append(h('div', { class: 'row2' }, num('Border mm', 'thick', 0.1, el, 0),
          h('label', { class: 'field' }, h('span', null, 'Border colour'), h('input', { class: 'input', type: 'color', value: el.stroke || '#000000', oninput: (e) => set({ stroke: e.target.value }) }))),
          h('div', { class: 'row2' }, sel('Fill', el.fill || '', [['', 'None'], ['#f2f2f2', 'Light grey'], ['#d9d9d9', 'Grey'], ['#000000', 'Black']], (v) => set({ fill: v }, true)), num('Corner radius', 'radius', 0.5, el, 0)));
      } else if (el.type === 'table') tableProps(el);

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
