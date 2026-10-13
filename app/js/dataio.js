/* DataCraft — import wizard (TXT/CSV/TSV, delimited or fixed-width) and CSV export. */
(function (DC) {
  'use strict';
  const { h, db } = DC;
  const DELIMS = [[',', 'Comma'], ['\t', 'Tab'], [';', 'Semicolon'], ['|', 'Pipe |'], [' ', 'Space']];

  // ---------- Parsing ----------
  function lines(text) {
    const ls = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
    return ls;
  }
  function trimmedLines(s) {
    let ls = lines(s.text).slice(+s.skipTop || 0);
    if (+s.skipBottom) ls = ls.slice(0, Math.max(0, ls.length - +s.skipBottom));
    return ls;
  }
  function detect(text) {
    const sample = lines(text).filter((l) => l.trim()).slice(0, 40);
    if (!sample.length) return { mode: 'delimited', delim: ',' };
    let best = null;
    for (const [d] of DELIMS.slice(0, 4)) {
      const counts = sample.map((l) => countOutsideQuotes(l, d));
      const freq = new Map(); counts.forEach((c) => freq.set(c, (freq.get(c) || 0) + 1));
      const [mode, hits] = [...freq].sort((a, b) => b[1] - a[1])[0];
      if (mode === 0) continue;
      const score = (hits / sample.length) * 10 + Math.min(mode, 10) / 10;
      if (!best || score > best.score) best = { d, score };
    }
    if (best && best.score >= 7) return { mode: 'delimited', delim: best.d };
    const br = guessBreaks(sample);
    if (br.length >= 1 && sample.some((l) => /\S {2,}\S/.test(l))) return { mode: 'fixed', breaks: br };
    if (best) return { mode: 'delimited', delim: best.d };
    return { mode: 'delimited', delim: ' ' };
  }
  function countOutsideQuotes(line, d) {
    let n = 0, q = false;
    for (const c of line) { if (c === '"') q = !q; else if (c === d && !q) n++; }
    return n;
  }
  // A column starts wherever every line has a space before a non-space character.
  function guessBreaks(ls) {
    const sample = ls.filter((l) => l.trim()).slice(0, 60);
    const w = Math.max(0, ...sample.map((l) => l.length));
    const blank = [];
    for (let i = 0; i < w; i++) blank[i] = sample.every((l) => i >= l.length || l[i] === ' ');
    const out = [];
    for (let i = 1; i < w; i++) if (blank[i - 1] && !blank[i]) out.push(i);
    return out;
  }
  function parse(s) {
    const ls = trimmedLines(s);
    let rows;
    if (s.mode === 'fixed') {
      const b = [0, ...[...s.breaks].sort((x, y) => x - y)];
      rows = ls.filter((l) => l.trim()).map((l) => b.map((start, i) => l.slice(start, i + 1 < b.length ? b[i + 1] : undefined).trim()));
    } else {
      const res = window.Papa.parse(ls.join('\n'), { delimiter: s.delim === 'other' ? (s.other || ',') : s.delim, quoteChar: s.quote || '\u0001', skipEmptyLines: 'greedy' });
      rows = res.data.map((r) => r.map((c) => (s.delim === ' ' ? c : c.trim())));
      if (s.delim === ' ') rows = rows.map((r) => r.filter((c) => c !== ''));
    }
    const n = Math.max(0, ...rows.map((r) => r.length));
    let names;
    if (s.header && rows.length) names = rows.shift().map((c, i) => String(c || '').trim() || `Column ${i + 1}`);
    else names = [];
    for (let i = names.length; i < n; i++) names.push(`Column ${i + 1}`);
    return { names: names.slice(0, Math.max(n, names.length)), rows };
  }

  // ---------- Type guessing ----------
  function guessType(values, s) {
    const vals = values.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 300);
    if (!vals.length) return { type: 'text' };
    if (vals.every((v) => DC.parseYesNo(v) != null) && vals.some((v) => /[a-z]/i.test(v))) return { type: 'yesno' };
    if (vals.every((v) => /[-/.]/.test(v) || /^\d{8}$/.test(v)) && vals.every((v) => DC.parseDate(v, s.dateOrder) != null) && vals.some((v) => /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(v))) return { type: 'date' };
    const leadingZero = vals.some((v) => /^0\d/.test(v));
    if (!leadingZero && vals.every((v) => DC.parseNumber(v, s.numberFormat) != null)) {
      if (vals.some((v) => /[$€£¥₹]/.test(v))) return { type: 'currency' };
      return { type: 'number' };
    }
    const distinct = new Set(vals);
    const longest = Math.max(...vals.map((v) => v.length));
    if (longest > 120) return { type: 'longtext' };
    const cat = vals.length >= 4 && distinct.size <= 20 && distinct.size <= Math.ceil(vals.length / 2) && longest <= 40;
    return { type: 'text', category: cat, distinct: distinct.size };
  }
  function convert(type, raw, s) {
    const v = String(raw ?? '').trim();
    if (!v) return { value: null };
    switch (type) {
      case 'number': case 'currency': { const n = DC.parseNumber(v, s.numberFormat); return n == null ? { value: null, bad: true } : { value: n }; }
      case 'date': { const d = DC.parseDate(v, s.dateOrder); return d == null ? { value: null, bad: true } : { value: d }; }
      case 'yesno': { const b = DC.parseYesNo(v); return b == null ? { value: null, bad: true } : { value: b }; }
      default: return { value: v };
    }
  }

  // ---------- Wizard ----------
  function importWizard(opts = {}) {
    if (!DC.project) { DC.toast('Open or create a project first.'); return; }
    const s = { step: 1, text: '', bytes: null, fileName: '', encoding: 'utf-8', mode: 'delimited', delim: ',', other: '', quote: '"', header: true, skipTop: 0, skipBottom: 0, breaks: [],
      numberFormat: 'dot', dateOrder: 'auto', dest: opts.table ? 'existing' : 'new', table: opts.table || '', newName: '', cols: [] };
    const body = h('div', { class: 'wizard' });
    const steps = ['Choose file', 'Columns', 'Fields', 'Done'];
    const m = DC.modal({ title: 'Import text or CSV', body, wide: true });
    m.el.classList.add('xl');

    function decode() {
      try { s.text = new TextDecoder(s.encoding).decode(s.bytes); } catch (e) { s.text = new TextDecoder().decode(s.bytes); }
    }
    function autodetect() {
      const d = detect(s.text);
      s.mode = d.mode;
      if (d.mode === 'fixed') s.breaks = d.breaks; else s.delim = d.delim;
      const first = trimmedLines(s)[0] || '';
      // Treat the first row as names when it has no numbers but the second row does.
      const p = parse({ ...s, header: false });
      const r0 = p.rows[0] || [], r1 = p.rows[1] || [];
      const numCount = (r) => r.filter((c) => DC.parseNumber(c) != null).length;
      s.header = p.rows.length > 1 ? numCount(r0) < numCount(r1) || (numCount(r0) === 0 && r0.every((c) => c && c.length < 40)) : false;
      if (!first) s.header = false;
    }
    function setupColumns() {
      const p = parse(s);
      const existing = s.dest === 'existing' && db.table(s.table);
      s.cols = p.names.map((name, i) => {
        const values = p.rows.map((r) => r[i]);
        const g = guessType(values, s);
        let map = '';
        if (existing) {
          const f = existing.fields.find((f) => f.type !== 'formula' && (f.label.toLowerCase() === name.toLowerCase() || f.name === DC.ident(name)));
          map = f ? f.name : '';
        }
        // Headings written in capitals (common in older exports) become Title Case field names.
        const label = /[a-z]/.test(name) ? name : name.toLowerCase().replace(/(^|[\s_/-])(\w)/g, (m, a, b) => a + b.toUpperCase());
        return { name, include: values.some((v) => String(v ?? '').trim()), label, type: g.type, category: !!g.category, distinct: g.distinct, map };
      });
      if (!s.newName) s.newName = (s.fileName || 'Imported data').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return p;
    }

    const stepper = () => h('ol', { class: 'stepper' }, steps.map((t, i) => h('li', { class: i + 1 === s.step ? 'on' : i + 1 < s.step ? 'done' : '' }, h('b', null, i + 1), ' ', t)));
    const nav = (back, next, nextLabel = 'Next', nextDisabled = false) => h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('span', { class: 'spacer' }),
      back ? h('button', { class: 'btn', onclick: back }, '‹ Back') : null,
      next ? h('button', { class: 'btn primary', disabled: nextDisabled, onclick: next }, nextLabel) : null);

    function render() {
      body.textContent = '';
      body.append(stepper());
      [step1, step2, step3, step4][s.step - 1]();
    }

    // Step 1 — file or pasted text
    function step1() {
      const fileIn = h('input', { type: 'file', accept: '.txt,.csv,.tsv,.tab,.prn,.dat,.log,text/*', hidden: true });
      const load = async (file) => {
        s.bytes = new Uint8Array(await file.arrayBuffer()); s.fileName = file.name; s.file = file;
        s.encoding = 'utf-8'; decode();
        if (s.text.includes('�')) { s.encoding = 'windows-1252'; decode(); }
        autodetect(); render();
      };
      fileIn.onchange = () => fileIn.files[0] && load(fileIn.files[0]);
      const drop = h('div', { class: 'drop', tabIndex: 0, role: 'button', onclick: () => fileIn.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') fileIn.click(); } },
        h('b', null, s.fileName ? s.fileName : 'Choose a file'), h('span', { class: 'muted' }, s.fileName ? `${lines(s.text).length} lines · click to choose another` : 'or drop a .txt, .csv or .tsv file here'));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) load(f); });
      const paste = h('textarea', { class: 'input mono', rows: 6, placeholder: 'Or paste text here', 'aria-label': 'Pasted text' }, s.fileName ? '' : s.text);
      paste.addEventListener('input', DC.debounce(() => { s.text = paste.value; s.bytes = null; s.fileName = ''; s.file = null; if (s.text.trim()) autodetect(); render(); paste.focus(); }, 400));
      const enc = h('select', { class: 'input', disabled: !s.bytes, onchange: () => { s.encoding = enc.value; decode(); render(); } },
        [['utf-8', 'UTF-8 (most files)'], ['windows-1252', 'Windows / ANSI (older programs)'], ['utf-16le', 'UTF-16']].map(([v, l]) => h('option', { value: v, selected: v === s.encoding }, l)));
      body.append(h('div', { class: 'stack' }, fileIn, drop, paste,
        h('label', { class: 'field narrow' }, h('span', null, 'Character set'), enc),
        s.text ? h('div', null, h('span', { class: 'label' }, 'First lines of the file'), h('pre', { class: 'raw' }, lines(s.text).slice(0, 8).join('\n'))) : null));
      body.append(nav(null, () => { s.step = 2; render(); }, 'Next', !s.text.trim()));
    }

    // Step 2 — how the text splits into columns
    function step2() {
      const p = parse(s);
      const opt = (label, input) => h('label', { class: 'field' }, h('span', null, label), input);
      const modeSeg = h('div', { class: 'seg', role: 'radiogroup' },
        [['delimited', 'Separated by a character'], ['fixed', 'Fixed-width columns']].map(([v, l]) => h('button', { class: 'btn', 'aria-pressed': String(s.mode === v), onclick: () => {
          s.mode = v; if (v === 'fixed' && !s.breaks.length) s.breaks = guessBreaks(trimmedLines(s)); render();
        } }, l)));
      const num = (key) => { const i = h('input', { class: 'input', type: 'number', min: 0, value: s[key] }); i.onchange = () => { s[key] = Math.max(0, +i.value || 0); render(); }; return i; };
      const header = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.header, onchange: (e) => { s.header = e.target.checked; render(); } }), ' First row has column names');
      const controls = h('div', { class: 'opts' });
      if (s.mode === 'delimited') {
        controls.append(
          opt('Separator', h('div', { class: 'seg wrap' }, [...DELIMS, ['other', 'Other']].map(([v, l]) => h('button', { class: 'btn', 'aria-pressed': String(s.delim === v), onclick: () => { s.delim = v; render(); } }, l)))),
          s.delim === 'other' ? opt('Other separator', (() => { const i = h('input', { class: 'input', maxLength: 1, value: s.other }); i.oninput = () => { s.other = i.value; render(); }; return i; })()) : null,
          opt('Text in quotes', (() => { const sel = h('select', { class: 'input', onchange: () => { s.quote = sel.value; render(); } }, [['"', 'Double quotes "'], ["'", "Single quotes '"], ['', 'No quotes']].map(([v, l]) => h('option', { value: v, selected: v === s.quote }, l))); return sel; })()));
      }
      controls.append(opt('Skip lines at the top', num('skipTop')), opt('Skip lines at the bottom', num('skipBottom')), header);
      body.append(h('div', { class: 'stack' }, modeSeg, controls));
      if (s.mode === 'fixed') body.append(fixedRuler());
      body.append(h('span', { class: 'label' }, `Preview · ${p.rows.length} rows, ${p.names.length} columns`), previewTable(p));
      body.append(nav(() => { s.step = 1; render(); }, () => { setupColumns(); s.step = 3; render(); }, 'Next', !p.rows.length));
    }

    // Click on the text to add or remove a column break.
    function fixedRuler() {
      const ls = trimmedLines(s).slice(0, 14);
      const w = Math.max(10, ...ls.map((l) => l.length));
      const ruler = Array.from({ length: w }, (_, i) => (i % 10 === 0 ? String(i / 10 % 10) : i % 5 === 0 ? '+' : '·')).join('');
      const probe = h('span', { class: 'probe', 'aria-hidden': 'true' }, '0'.repeat(20));
      const box = h('div', { class: 'fixed-box', title: 'Click to add or remove a column break' },
        probe, h('div', { class: 'fixed-line ruler' }, ruler), ls.map((l) => h('div', { class: 'fixed-line' }, l || ' ')),
        s.breaks.map((b) => h('div', { class: 'brk', style: { left: `calc(${b}ch + 10px)` } })));
      box.addEventListener('click', (e) => {
        const r = box.getBoundingClientRect();
        const ch = probe.getBoundingClientRect().width / 20 || 8;
        const pos = Math.round((e.clientX - r.left - 10 + box.scrollLeft) / ch);
        if (pos <= 0) return;
        const near = s.breaks.find((b) => Math.abs(b - pos) <= 1);
        s.breaks = near ? s.breaks.filter((b) => b !== near) : [...s.breaks, pos].sort((a, b) => a - b);
        render();
      });
      return h('div', null, h('span', { class: 'label' }, 'Click between columns to add a break; click a red line to remove it'), box,
        h('div', { class: 'inline' }, h('button', { class: 'btn sm', onclick: () => { s.breaks = guessBreaks(trimmedLines(s)); render(); } }, 'Guess breaks again'), h('button', { class: 'btn sm', onclick: () => { s.breaks = []; render(); } }, 'Clear breaks')));
    }
    function previewTable(p, maxRows = 12) {
      return h('div', { class: 'grid-wrap preview' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, p.names.map((n) => h('th', null, n)))),
        h('tbody', null, p.rows.slice(0, maxRows).map((r) => h('tr', null, p.names.map((_, i) => h('td', null, r[i] ?? '')))))));
    }

    // Step 3 — where the data goes and what each column becomes
    function step3() {
      const p = parse(s);
      const tables = DC.project.schema.tables;
      const existing = db.table(s.table);
      const destSeg = h('div', { class: 'seg' },
        h('button', { class: 'btn', 'aria-pressed': String(s.dest === 'new'), onclick: () => { s.dest = 'new'; setupColumns(); render(); } }, 'Create a new table'),
        h('button', { class: 'btn', 'aria-pressed': String(s.dest === 'existing'), disabled: !tables.length, onclick: () => { s.dest = 'existing'; if (!s.table && tables[0]) s.table = tables[0].name; setupColumns(); render(); } }, 'Add to an existing table'));
      const destInput = s.dest === 'new'
        ? (() => { const i = h('input', { class: 'input', value: s.newName, 'aria-label': 'New table name' }); i.oninput = () => { s.newName = i.value; }; return h('label', { class: 'field narrow' }, h('span', null, 'New table name'), i); })()
        : h('label', { class: 'field narrow' }, h('span', null, 'Table'), h('select', { class: 'input', onchange: (e) => { s.table = e.target.value; setupColumns(); render(); } }, tables.map((t) => h('option', { value: t.name, selected: t.name === s.table }, t.label))));
      const fmtOpts = h('div', { class: 'opts' },
        h('label', { class: 'field' }, h('span', null, 'Numbers look like'), h('select', { class: 'input', onchange: (e) => { s.numberFormat = e.target.value; setupColumns(); render(); } },
          [['dot', '1,234.56'], ['comma', '1.234,56']].map(([v, l]) => h('option', { value: v, selected: v === s.numberFormat }, l)))),
        h('label', { class: 'field' }, h('span', null, 'Dates are written'), h('select', { class: 'input', onchange: (e) => { s.dateOrder = e.target.value; render(); } },
          [['auto', 'Work it out'], ['MDY', 'Month/Day/Year'], ['DMY', 'Day/Month/Year'], ['YMD', 'Year-Month-Day']].map(([v, l]) => h('option', { value: v, selected: v === s.dateOrder }, l)))));

      const sample = (i) => p.rows.slice(0, 3).map((r) => r[i]).filter((v) => v != null && v !== '').join(' · ');
      const typeOpts = DC.TYPES.filter(([v]) => !['link', 'formula', 'category'].includes(v));
      const rows = s.cols.map((c, i) => h('tr', { class: c.include ? '' : 'off' },
        h('td', null, h('input', { type: 'checkbox', checked: c.include, 'aria-label': 'Import ' + c.name, onchange: (e) => { c.include = e.target.checked; render(); } })),
        h('td', null, h('b', null, c.name), h('div', { class: 'muted small clip' }, sample(i))),
        s.dest === 'new'
          ? [h('td', null, (() => { const inp = h('input', { class: 'input', value: c.label, disabled: !c.include, 'aria-label': 'Field name' }); inp.oninput = () => { c.label = inp.value; }; return inp; })()),
            h('td', null, h('select', { class: 'input', disabled: !c.include, 'aria-label': 'Field type', onchange: (e) => { c.type = e.target.value; render(); } }, typeOpts.map(([v, l]) => h('option', { value: v, selected: v === c.type }, l)))),
            h('td', null, c.type === 'text' ? h('label', { class: 'check', title: 'Turns the different values into a category list you can filter by' },
              h('input', { type: 'checkbox', checked: c.category, disabled: !c.include, onchange: (e) => { c.category = e.target.checked; } }), ` Category${c.distinct ? ` (${c.distinct})` : ''}`) : null)]
          : h('td', { colspan: 3 }, h('select', { class: 'input', disabled: !c.include, 'aria-label': 'Put into field', onchange: (e) => { c.map = e.target.value; } },
            h('option', { value: '' }, '— skip this column —'), (existing ? existing.fields : []).filter((f) => f.type !== 'formula').map((f) => h('option', { value: f.name, selected: f.name === c.map }, `${f.label} (${(DC.TYPES.find((t) => t[0] === f.type) || [, f.type])[1]})`))))));
      body.append(h('div', { class: 'stack' }, destSeg, destInput, fmtOpts));
      body.append(h('div', { class: 'grid-wrap cols' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Column in file'), s.dest === 'new' ? [h('th', null, 'Field name'), h('th', null, 'Type'), h('th', null, 'Make a category list')] : h('th', { colspan: 3 }, 'Put into field'))),
        h('tbody', null, rows))));
      const ready = s.dest === 'new' ? s.cols.some((c) => c.include) : s.cols.some((c) => c.include && c.map);
      body.append(nav(() => { s.step = 2; render(); }, () => doImport(p), `Import ${p.rows.length} row${p.rows.length === 1 ? '' : 's'}`, !ready));
    }

    async function doImport(p) {
      let tblName = s.table, created = false;
      const used = s.cols.map((c, i) => ({ ...c, i })).filter((c) => c.include && (s.dest === 'new' || c.map));
      if (s.dest === 'new') {
        if (!s.newName.trim()) { DC.toast('Enter a name for the new table.'); return; }
        tblName = db.createTable(s.newName.trim()); created = true;
        for (const c of used) {
          let type = c.type, opts = {};
          if (c.type === 'text' && c.category) {
            const vals = [...new Set(p.rows.map((r) => String(r[c.i] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            const existingList = DC.project.schema.lists.find((l) => l.label.toLowerCase() === (c.label || c.name).toLowerCase());
            const listName = existingList ? existingList.name : db.createList(c.label || c.name, vals);
            if (existingList) db.setListItems(listName, [...existingList.items, ...vals]);
            type = 'category'; opts = { list: listName };
          }
          if (c.type === 'date') opts.def = '';
          if (c.type === 'number') opts.decimals = '';
          c.map = db.addField(tblName, { label: (c.label || c.name).trim() || 'Field', type, opts });
        }
      }
      const t = db.table(tblName);
      let added = 0; const problems = [];
      db.run('BEGIN');
      try {
        p.rows.forEach((r, rowIdx) => {
          const vals = {};
          used.forEach((c) => {
            const f = t.fields.find((x) => x.name === c.map); if (!f) return;
            const type = f.type === 'category' ? 'text' : f.type === 'link' ? 'number' : f.type;
            const cv = convert(type, r[c.i], s);
            if (cv.bad && problems.length < 200) problems.push({ row: rowIdx + 1 + (s.header ? 1 : 0) + (+s.skipTop || 0), field: f.label, value: r[c.i] });
            vals[f.name] = cv.value;
          });
          db.insertRow(tblName, vals); added++;
        });
        db.run('COMMIT');
      } catch (e) {
        db.run('ROLLBACK');
        if (created) db.deleteTable(tblName);
        DC.toast('Import stopped: ' + e.message, 6000); return;
      }
      DC.loadSchema(); DC.changed();
      let saved = null;
      if (s.file && DC.store.mode === 'folder') { try { saved = await DC.store.writeExtra(DC.project.name, 'imports', s.fileName, s.bytes); } catch (e) { /* keep going */ } }
      s.result = { added, problems, tblName, created, saved };
      s.step = 4; render();
      DC.renderSidebar && DC.renderSidebar();
    }

    // Step 4 — summary
    function step4() {
      const r = s.result, t = db.table(r.tblName);
      body.append(h('div', { class: 'stack' },
        h('p', { class: 'big' }, `Added ${r.added} record${r.added === 1 ? '' : 's'} to ${t.label}${r.created ? ' (new table)' : ''}.`),
        r.saved ? h('p', { class: 'muted' }, `A copy of the file was kept in ${r.saved}.`) : null,
        r.problems.length ? h('div', null,
          h('p', null, `${r.problems.length}${r.problems.length >= 200 ? '+' : ''} value${r.problems.length === 1 ? '' : 's'} could not be read and were left empty. For example:`),
          h('ul', { class: 'problems' }, r.problems.slice(0, 6).map((x) => h('li', null, `Line ${x.row}, ${x.field}: “${x.value}”`))),
          h('p', { class: 'muted' }, 'If dates or numbers look wrong, go back a step and change “Numbers look like” or “Dates are written”, or change the field type later.')) : h('p', { class: 'muted' }, 'Every value was read without problems.')));
      body.append(h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => m.close() }, 'Close'),
        h('button', { class: 'btn primary', onclick: () => { m.close(); DC.go({ view: 'table', id: r.tblName }); } }, `Open ${t.label}`)));
    }

    render();
  }

  // ---------- CSV export ----------
  function exportDialog(opts = {}) {
    if (!DC.project) return;
    const tables = DC.project.schema.tables;
    if (!tables.length) { DC.toast('There are no tables to export yet.'); return; }
    let tblName = opts.table || tables[0].name;
    const hasFilter = !!(opts.search || Object.values(opts.filters || {}).some(Boolean));
    const body = h('div', { class: 'stack' });
    const state = { sep: ',', header: true, bom: true, filtered: hasFilter, dates: 'iso', cols: null };
    const m = DC.modal({ title: 'Export to CSV', body, wide: true });

    function render() {
      const t = db.table(tblName);
      if (!state.cols) state.cols = new Set(t.fields.map((f) => f.name));
      body.textContent = '';
      body.append(
        h('label', { class: 'field narrow' }, h('span', null, 'Table'), h('select', { class: 'input', onchange: (e) => { tblName = e.target.value; state.cols = null; state.filtered = false; render(); } }, tables.map((x) => h('option', { value: x.name, selected: x.name === tblName }, x.label)))),
        h('div', null, h('span', { class: 'label' }, 'Columns'), h('div', { class: 'checks' }, t.fields.map((f) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.cols.has(f.name), onchange: (e) => { e.target.checked ? state.cols.add(f.name) : state.cols.delete(f.name); } }), ' ', f.label)))),
        h('div', { class: 'opts' },
          h('label', { class: 'field' }, h('span', null, 'Separator'), h('select', { class: 'input', onchange: (e) => { state.sep = e.target.value; } }, [[',', 'Comma (standard CSV)'], [';', 'Semicolon (European Excel)'], ['\t', 'Tab'], ['|', 'Pipe |']].map(([v, l]) => h('option', { value: v, selected: v === state.sep }, l)))),
          h('label', { class: 'field' }, h('span', null, 'Dates'), h('select', { class: 'input', onchange: (e) => { state.dates = e.target.value; } }, [['iso', '2026-03-31 (works everywhere)'], ['project', 'As shown in DataCraft']].map(([v, l]) => h('option', { value: v, selected: v === state.dates }, l))))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.header, onchange: (e) => { state.header = e.target.checked; } }), ' First row has column names'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.bom, onchange: (e) => { state.bom = e.target.checked; } }), ' Excel-friendly (keeps accented characters correct)'),
        tblName === opts.table && hasFilter ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.filtered, onchange: (e) => { state.filtered = e.target.checked; } }), ' Only records that match the current search and filters') : null,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: run }, 'Export')));
    }
    async function run() {
      const t = db.table(tblName);
      const fields = t.fields.filter((f) => state.cols.has(f.name));
      if (!fields.length) { DC.toast('Pick at least one column.'); return; }
      const res = db.rows(tblName, state.filtered ? { search: opts.search, filters: opts.filters } : {});
      const maps = db.linkMapsFor(t);
      const val = (f, v) => {
        if (v == null || v === '') return '';
        if (f.type === 'date') return state.dates === 'iso' ? v : DC.fmtDate(v);
        if (f.type === 'yesno') return +v ? 'Yes' : 'No';
        if (f.type === 'link') return DC.fmtValue(f, v, maps);
        if (f.type === 'currency' || (f.type === 'formula' && f.opts.currency)) return (+v).toFixed(2);
        return v;
      };
      const out = [];
      if (state.header) out.push(fields.map((f) => DC.csvCell(f.label, state.sep)).join(state.sep));
      res.rows.forEach((r) => out.push(fields.map((f) => DC.csvCell(val(f, r[f.name]), state.sep)).join(state.sep)));
      const text = (state.bom ? '﻿' : '') + out.join('\r\n') + '\r\n';
      const name = `${DC.ident(t.label)}-${DC.todayIso()}.csv`;
      m.close();
      if (DC.inFrame) {
        DC.modal({ title: 'Your CSV', body: [h('p', null, 'Downloads are blocked in this viewer. Copy the text below into a file named ' + name + '.'), h('textarea', { class: 'input mono', rows: 14, readOnly: true }, text.replace(/^﻿/, ''))], wide: true, actions: [{ label: 'Close', primary: true }] });
        return;
      }
      const path = await DC.store.writeExtra(DC.project.name, 'exports', name, text);
      DC.toast(path ? `Exported ${res.rows.length} records to ${path}` : `Downloaded ${name} (${res.rows.length} records)`, 5000);
    }
    render();
  }

  Object.assign(DC, { importWizard, exportDialog, _parse: { detect, parse, guessBreaks, guessType } });
})(window.DC);
