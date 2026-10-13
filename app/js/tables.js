/* DataCraft — table screens: records grid, record form, field designer, category lists. */
(function (DC) {
  'use strict';
  const { h, db, esc } = DC;
  const PAGE_SIZE = 100;

  // ---------- Inputs for one field ----------
  function inputFor(f, value, linkMaps) {
    let el;
    const v = value == null ? '' : value;
    switch (f.type) {
      case 'longtext': el = h('textarea', { class: 'input', rows: 3 }, v); break;
      case 'number': case 'currency': el = h('input', { class: 'input num', type: 'number', step: 'any', value: v }); break;
      case 'date': el = h('input', { class: 'input', type: 'date', value: v }); break;
      case 'yesno': el = h('input', { type: 'checkbox', checked: +v === 1 }); break;
      case 'category': {
        const items = (db.list(f.opts.list) || { items: [] }).items;
        const opts = [['', '—'], ...items.map((i) => [i, i])];
        if (v && !items.includes(v)) opts.push([v, v + ' (not in list)']);
        el = h('select', { class: 'input' }, opts.map(([a, b]) => h('option', { value: a, selected: String(a) === String(v) }, b)));
        break;
      }
      case 'link': {
        const m = (linkMaps && linkMaps[f.opts.link]) || db.linkMap(f.opts.link);
        el = h('select', { class: 'input' }, h('option', { value: '' }, '—'), [...m].map(([id, label]) => h('option', { value: id, selected: +v === id }, label)));
        break;
      }
      case 'formula': el = h('input', { class: 'input num', value: DC.fmtValue(f, value), readOnly: true, tabIndex: -1, title: 'Calculated: ' + (f.opts.formula || '') }); break;
      default: el = h('input', { class: 'input', type: 'text', value: v });
    }
    el.getValue = () => (f.type === 'yesno' ? (el.checked ? 1 : 0) : el.value);
    return el;
  }

  // ---------- Record form ----------
  function recordForm(tblName, rid, after) {
    const t = db.table(tblName);
    const rec = rid ? db.getRow(tblName, rid) : db.defaults(t);
    const maps = db.linkMapsFor(t);
    const inputs = {};
    const body = h('div', { class: 'form-grid' }, t.fields.map((f) => {
      const inp = inputFor(f, rec[f.name], maps); inputs[f.name] = inp;
      if (f.type === 'yesno') return h('label', { class: 'check span2' }, inp, ' ', f.label);
      return h('label', { class: 'field' + (f.type === 'longtext' ? ' span2' : '') }, h('span', null, f.label), inp);
    }));
    if (!t.fields.length) body.append(h('p', { class: 'hint' }, 'This table has no fields yet. Add some on the Fields tab.'));
    const actions = [];
    if (rid) actions.push({ label: 'Delete', danger: true, onClick: async () => {
      if (!(await DC.ask({ title: 'Delete this record?', body: 'This cannot be undone.', ok: 'Delete', danger: true }))) return false;
      db.deleteRows(tblName, [rid]); DC.toast('Record deleted'); after && after(); return true;
    } });
    actions.push({ label: 'Cancel' }, { label: rid ? 'Save' : 'Add record', primary: true, onClick: () => {
      const vals = {}; t.fields.forEach((f) => { if (f.type !== 'formula') vals[f.name] = inputs[f.name].getValue(); });
      if (rid) db.updateRow(tblName, rid, vals); else db.insertRow(tblName, vals);
      DC.toast(rid ? 'Saved' : 'Record added'); after && after(); return true;
    } });
    DC.modal({ title: (rid ? 'Edit ' : 'New ') + singular(t.label) + (rid ? ' #' + rid : ''), body, actions, wide: t.fields.length > 6 });
  }
  const singular = (s) => s.replace(/ies$/i, 'y').replace(/(ss)$/i, '$1').replace(/s$/i, '');

  // ---------- Table view ----------
  function tableView(root, tblName, st) {
    const t = db.table(tblName);
    if (!t) { root.append(h('p', { class: 'empty' }, 'This table no longer exists.')); return; }
    st.tab = st.tab || 'records';
    st.filters = st.filters || {};
    st.page = st.page || 0;
    st.selected = st.selected || new Set();
    const rerender = () => DC.render();

    const head = h('div', { class: 'view-head' },
      h('div', { class: 'title-row' },
        h('h1', null, t.label),
        h('button', { class: 'btn ghost sm', title: 'Rename this table', onclick: async () => {
          const v = await DC.formDialog({ title: 'Rename table', fields: [{ id: 'label', label: 'Table name', value: t.label }], ok: 'Rename', validate: (v) => !v.label.trim() && 'Enter a name.' });
          if (v) { db.renameTable(tblName, v.label); rerender(); }
        } }, 'Rename'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => DC.importWizard({ table: tblName }) }, 'Import into table'),
        h('button', { class: 'btn', onclick: () => DC.exportDialog({ table: tblName, search: st.search, filters: st.filters }) }, 'Export CSV'),
        h('button', { class: 'btn ghost danger-text', onclick: async () => {
          const n = db.count(tblName);
          if (!(await DC.ask({ title: `Delete the ${t.label} table?`, body: `This deletes the table and its ${n} record${n === 1 ? '' : 's'} for good. Pages that use it will stop showing its data.`, ok: 'Delete table', danger: true }))) return;
          db.deleteTable(tblName); DC.go({ view: 'home-project' });
        } }, 'Delete table')),
      h('div', { class: 'tabs', role: 'tablist' },
        ['records', 'fields'].map((k) => h('button', { class: 'tab', role: 'tab', 'aria-selected': String(st.tab === k), onclick: () => { st.tab = k; rerender(); } },
          k === 'records' ? `Records (${db.count(tblName)})` : `Fields (${t.fields.length})`))));
    root.append(head);
    if (st.tab === 'fields') fieldsTab(root, t, rerender);
    else recordsTab(root, t, st, rerender);
  }

  function recordsTab(root, t, st, rerender) {
    const filterable = t.fields.filter((f) => ['category', 'yesno', 'link'].includes(f.type));
    const maps = db.linkMapsFor(t);
    const res = db.rows(t.name, { search: st.search, filters: st.filters, sort: st.sort, limit: PAGE_SIZE, offset: st.page * PAGE_SIZE });
    const pages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
    if (st.page >= pages) { st.page = pages - 1; }

    const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search records', value: st.search || '', 'aria-label': 'Search records' });
    search.addEventListener('input', DC.debounce(() => { st.search = search.value; st.page = 0; rerender(); setTimeout(() => { const s = DC.$('.search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }); }, 250));
    const filters = filterable.map((f) => {
      let opts;
      if (f.type === 'category') opts = (db.list(f.opts.list) || { items: [] }).items.map((i) => [i, i]);
      else if (f.type === 'yesno') opts = [['1', 'Yes'], ['0', 'No']];
      else opts = [...(maps[f.opts.link] || new Map())].map(([id, l]) => [id, l]);
      const sel = h('select', { class: 'input', 'aria-label': 'Filter by ' + f.label, onchange: () => { st.filters[f.name] = sel.value; st.page = 0; rerender(); } },
        h('option', { value: '' }, `All ${f.label}`), h('option', { value: '__none__', selected: st.filters[f.name] === '__none__' }, `(No ${f.label})`),
        opts.map(([v, l]) => h('option', { value: v, selected: String(st.filters[f.name] ?? '') === String(v) }, l)));
      return sel;
    });
    const sel = [...st.selected].filter((id) => res.rows.some((r) => r._rid === id));
    const toolbar = h('div', { class: 'toolbar' }, search, filters,
      (st.search || Object.values(st.filters).some(Boolean)) ? h('button', { class: 'btn ghost sm', onclick: () => { st.search = ''; st.filters = {}; rerender(); } }, 'Clear filters') : null,
      h('span', { class: 'muted count' }, `${res.total} record${res.total === 1 ? '' : 's'}`),
      h('span', { class: 'spacer' }),
      sel.length ? h('button', { class: 'btn danger', onclick: async () => {
        if (!(await DC.ask({ title: `Delete ${sel.length} record${sel.length === 1 ? '' : 's'}?`, body: 'This cannot be undone.', ok: 'Delete', danger: true }))) return;
        db.deleteRows(t.name, sel); st.selected.clear(); rerender();
      } }, `Delete ${sel.length} selected`) : null,
      h('button', { class: 'btn primary', disabled: !t.fields.length, onclick: () => recordForm(t.name, null, rerender) }, '+ Add record'));
    root.append(toolbar);

    if (!t.fields.length) {
      root.append(h('div', { class: 'empty' }, h('p', null, 'This table has no fields yet.'), h('button', { class: 'btn primary', onclick: () => { st.tab = 'fields'; rerender(); } }, 'Add fields')));
      return;
    }
    const sortIcon = (f) => (st.sort && st.sort.field === f.name ? (st.sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
    const allChk = h('input', { type: 'checkbox', 'aria-label': 'Select all on this page', checked: res.rows.length && sel.length === res.rows.length,
      onchange: () => { res.rows.forEach((r) => (allChk.checked ? st.selected.add(r._rid) : st.selected.delete(r._rid))); rerender(); } });
    const thead = h('thead', null, h('tr', null,
      h('th', { class: 'c-sel' }, allChk), h('th', { class: 'c-id' }, '#'),
      t.fields.map((f) => h('th', { class: numeric(f) ? 'num' : '', title: f.type === 'formula' ? 'Calculated: ' + f.opts.formula : 'Sort by ' + f.label },
        f.type === 'formula' ? h('span', null, f.label) : h('button', { class: 'th-btn', onclick: () => {
          st.sort = st.sort && st.sort.field === f.name ? (st.sort.dir === 'asc' ? { field: f.name, dir: 'desc' } : null) : { field: f.name, dir: 'asc' };
          rerender();
        } }, f.label + sortIcon(f))))));
    const tbody = h('tbody');
    res.rows.forEach((r) => {
      const chk = h('input', { type: 'checkbox', checked: st.selected.has(r._rid), 'aria-label': 'Select record ' + r._rid,
        onchange: () => { chk.checked ? st.selected.add(r._rid) : st.selected.delete(r._rid); rerender(); } });
      tbody.append(h('tr', null,
        h('td', { class: 'c-sel' }, chk),
        h('td', { class: 'c-id' }, h('button', { class: 'link-btn', title: 'Open this record', onclick: () => recordForm(t.name, r._rid, rerender) }, r._rid)),
        t.fields.map((f) => cell(t, f, r, maps, rerender))));
    });
    if (!res.rows.length) tbody.append(h('tr', null, h('td', { colspan: t.fields.length + 2, class: 'empty-row' }, st.search || Object.values(st.filters).some(Boolean) ? 'No records match.' : 'No records yet. Add one, or import a file.')));
    root.append(h('div', { class: 'grid-wrap' }, h('table', { class: 'grid' }, thead, tbody)));
    if (pages > 1) root.append(h('div', { class: 'pager' },
      h('button', { class: 'btn sm', disabled: st.page === 0, onclick: () => { st.page--; rerender(); } }, '‹ Previous'),
      h('span', { class: 'muted' }, `Page ${st.page + 1} of ${pages}`),
      h('button', { class: 'btn sm', disabled: st.page >= pages - 1, onclick: () => { st.page++; rerender(); } }, 'Next ›')));
  }
  const numeric = (f) => ['number', 'currency', 'formula'].includes(f.type);

  // One grid cell; click to edit in place.
  function cell(t, f, r, maps, rerender) {
    const td = h('td', { class: (numeric(f) ? 'num ' : '') + 't-' + f.type });
    const show = () => {
      td.textContent = '';
      if (f.type === 'yesno') {
        td.append(h('input', { type: 'checkbox', checked: +r[f.name] === 1, 'aria-label': f.label, onchange: (e) => { db.updateRow(t.name, r._rid, { [f.name]: e.target.checked ? 1 : 0 }); r[f.name] = e.target.checked ? 1 : 0; } }));
        return;
      }
      const text = DC.fmtValue(f, r[f.name], maps);
      if (f.type === 'category' && text) td.append(h('span', { class: 'chip' }, text));
      else td.append(text);
      if (f.type === 'formula' && f.calcError) td.title = f.calcError;
    };
    show();
    if (f.type === 'formula' || f.type === 'yesno') return td;
    td.tabIndex = 0;
    const edit = () => {
      if (td.querySelector('.input')) return;
      const inp = inputFor(f, r[f.name], maps);
      inp.classList.add('cell-input');
      td.textContent = ''; td.append(inp); inp.focus();
      if (inp.select && inp.type === 'text') inp.select();
      let done = false;
      const commit = (save) => {
        if (done) return; done = true;
        if (save) {
          const v = inp.getValue();
          const norm = db.normalize(f, v);
          if (String(norm ?? '') !== String(r[f.name] ?? '')) {
            db.updateRow(t.name, r._rid, { [f.name]: v });
            if (t.fields.some((x) => x.type === 'formula')) { rerender(); return; }
            r[f.name] = norm;
          }
        }
        show();
      };
      inp.addEventListener('blur', () => commit(true));
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && f.type !== 'longtext') { e.preventDefault(); commit(true); td.focus(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(false); td.focus(); }
      });
      if (inp.tagName === 'SELECT') inp.addEventListener('change', () => { commit(true); td.focus(); });
    };
    td.addEventListener('click', edit);
    td.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === 'F2') && e.target === td) { e.preventDefault(); edit(); } });
    return td;
  }

  // ---------- Fields tab ----------
  function fieldsTab(root, t, rerender) {
    const typeSel = (value, onChange) => h('select', { class: 'input', onchange: (e) => onChange(e.target.value) }, DC.TYPES.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    const tables = DC.project.schema.tables;
    const lists = DC.project.schema.lists;

    const details = (f) => {
      const upd = (opts) => { db.updateField(t.name, f.name, { opts }); rerender(); };
      switch (f.type) {
        case 'category': return h('div', { class: 'inline' },
          h('select', { class: 'input', 'aria-label': 'Category list', onchange: async (e) => {
            if (e.target.value === '__new') {
              const v = await DC.formDialog({ title: 'New category list', fields: [{ id: 'label', label: 'List name', value: f.label }, { id: 'items', label: 'Choices (one per line)', type: 'textarea' }], ok: 'Create list', validate: (v) => !v.label.trim() && 'Enter a name.' });
              if (v) upd({ list: db.createList(v.label, v.items.split('\n')) }); else rerender();
            } else upd({ list: e.target.value });
          } }, h('option', { value: '' }, 'Choose a list…'), lists.map((l) => h('option', { value: l.name, selected: l.name === f.opts.list }, `${l.label} (${l.items.length})`)), h('option', { value: '__new' }, '+ New list…')));
        case 'link': return h('select', { class: 'input', 'aria-label': 'Linked table', onchange: (e) => upd({ link: e.target.value }) },
          h('option', { value: '' }, 'Link to which table?'), tables.filter((x) => x.name !== t.name).map((x) => h('option', { value: x.name, selected: x.name === f.opts.link }, x.label)));
        case 'formula': {
          const inp = h('input', { class: 'input mono', value: f.opts.formula || '', placeholder: 'e.g. [Quantity] * [Unit price]', 'aria-label': 'Formula' });
          inp.addEventListener('change', () => upd({ formula: inp.value }));
          return h('div', { class: 'stack' }, inp,
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!f.opts.currency, onchange: (e) => upd({ currency: e.target.checked }) }), ' Show as money'),
            f.calcError ? h('small', { class: 'error' }, f.calcError) : h('small', { class: 'hint' }, 'Use field names in [brackets] with + − × ÷ and ( ).'));
        }
        case 'number': return h('select', { class: 'input', 'aria-label': 'Decimal places', onchange: (e) => upd({ decimals: e.target.value }) },
          [['', 'Any decimals'], ['0', 'Whole numbers'], ['1', '1 decimal'], ['2', '2 decimals'], ['3', '3 decimals']].map(([v, l]) => h('option', { value: v, selected: String(f.opts.decimals ?? '') === v }, l)));
        case 'date': return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.opts.def === 'today', onchange: (e) => upd({ def: e.target.checked ? 'today' : '' }) }), ' New records start with today');
        default: return h('span', { class: 'muted' }, '');
      }
    };

    const rows = t.fields.map((f, i) => {
      const label = h('input', { class: 'input', value: f.label, 'aria-label': 'Field name' });
      label.addEventListener('change', () => { if (label.value.trim()) { db.updateField(t.name, f.name, { label: label.value }); rerender(); } });
      return h('tr', null,
        h('td', null, label),
        h('td', null, typeSel(f.type, async (type) => {
          if (type === 'formula' && db.count(t.name) && !(await DC.ask({ title: 'Make this a calculated field?', body: `The values stored in “${f.label}” will no longer be shown. They stay in the file until you delete the field.`, ok: 'Make calculated' }))) { rerender(); return; }
          db.updateField(t.name, f.name, { type }); rerender();
        })),
        h('td', null, details(f)),
        h('td', { class: 'nowrap' },
          h('button', { class: 'btn ghost sm', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { db.moveField(t.name, f.name, -1); rerender(); } }, '↑'),
          h('button', { class: 'btn ghost sm', title: 'Move down', 'aria-label': 'Move down', disabled: i === t.fields.length - 1, onclick: () => { db.moveField(t.name, f.name, 1); rerender(); } }, '↓'),
          h('button', { class: 'btn ghost sm danger-text', title: 'Delete field', onclick: async () => {
            if (!(await DC.ask({ title: `Delete the “${f.label}” field?`, body: 'Its data in every record is deleted. This cannot be undone.', ok: 'Delete field', danger: true }))) return;
            db.deleteField(t.name, f.name); rerender();
          } }, 'Delete')));
    });

    const newLabel = h('input', { class: 'input', placeholder: 'New field name', 'aria-label': 'New field name' });
    let newType = 'text';
    const add = () => {
      const label = newLabel.value.trim(); if (!label) { newLabel.focus(); return; }
      const opts = newType === 'category' && lists[0] ? {} : {};
      db.addField(t.name, { label, type: newType, opts });
      rerender();
      setTimeout(() => { const i = DC.$('.add-field input'); i && i.focus(); });
    };
    newLabel.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

    root.append(h('div', { class: 'panel' },
      h('table', { class: 'fields' },
        h('thead', null, h('tr', null, h('th', null, 'Field'), h('th', null, 'Type'), h('th', null, 'Details'), h('th', null, ''))),
        h('tbody', null, rows),
        h('tfoot', null, h('tr', { class: 'add-field' }, h('td', null, newLabel), h('td', null, typeSel('text', (v) => { newType = v; })), h('td', { colspan: 2 }, h('button', { class: 'btn primary', onclick: add }, '+ Add field'))))),
      t.fields.length ? h('label', { class: 'field narrow' }, h('span', null, 'When other tables link here, show records by'),
        h('select', { class: 'input', onchange: (e) => { db.setDisplayField(t.name, e.target.value); rerender(); } },
          t.fields.map((f) => h('option', { value: f.name, selected: t.displayField && t.displayField.name === f.name }, f.label)))) : null));
  }

  // ---------- Category list view ----------
  function listView(root, name) {
    const l = db.list(name);
    if (!l) { root.append(h('p', { class: 'empty' }, 'This list no longer exists.')); return; }
    const usage = db.listUsage(name);
    const used = (v) => usage.reduce((n, u) => n + (u.counts.get(v) || 0), 0);
    const rerender = () => DC.render();
    root.append(h('div', { class: 'view-head' }, h('div', { class: 'title-row' },
      h('h1', null, l.label), h('span', { class: 'badge' }, 'Category list'),
      h('button', { class: 'btn ghost sm', onclick: async () => {
        const v = await DC.formDialog({ title: 'Rename list', fields: [{ id: 'label', label: 'List name', value: l.label }], ok: 'Rename', validate: (v) => !v.label.trim() && 'Enter a name.' });
        if (v) { db.renameList(name, v.label); rerender(); }
      } }, 'Rename'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost danger-text', onclick: async () => {
        if (!(await DC.ask({ title: `Delete the ${l.label} list?`, body: 'Fields that use it become plain text fields. Their values are kept.', ok: 'Delete list', danger: true }))) return;
        db.deleteList(name); DC.go({ view: 'home-project' });
      } }, 'Delete list'))));
    root.append(h('p', { class: 'muted' }, usage.length ? 'Used by ' + usage.map((u) => `${u.table.label} › ${u.field.label}`).join(', ') + '.' : 'Not used by any field yet. Pick it when you set a field’s type to Category.'));
    const items = l.items.map((v, i) => {
      const inp = h('input', { class: 'input', value: v, 'aria-label': 'Choice' });
      inp.addEventListener('change', () => {
        const to = inp.value.trim();
        if (!to) { inp.value = v; return; }
        if (l.items.includes(to)) { DC.toast(`“${to}” is already in the list.`); inp.value = v; return; }
        const n = db.renameListValue(name, v, to);
        DC.toast(n ? `Renamed. ${n} record${n === 1 ? '' : 's'} updated.` : 'Renamed'); rerender();
      });
      const n = used(v);
      return h('tr', null, h('td', null, inp), h('td', { class: 'muted num' }, n ? `${n} record${n === 1 ? '' : 's'}` : 'unused'),
        h('td', { class: 'nowrap' },
          h('button', { class: 'btn ghost sm', disabled: i === 0, 'aria-label': 'Move up', onclick: () => { const a = [...l.items]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; db.setListItems(name, a); rerender(); } }, '↑'),
          h('button', { class: 'btn ghost sm', disabled: i === l.items.length - 1, 'aria-label': 'Move down', onclick: () => { const a = [...l.items]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; db.setListItems(name, a); rerender(); } }, '↓'),
          h('button', { class: 'btn ghost sm danger-text', onclick: async () => {
            if (n && !(await DC.ask({ title: `Remove “${v}”?`, body: `${n} record${n === 1 ? ' still uses' : 's still use'} it. They keep the value, but it will no longer be a choice.`, ok: 'Remove', danger: true }))) return;
            db.setListItems(name, l.items.filter((x) => x !== v)); rerender();
          } }, 'Remove')));
    });
    const add = h('textarea', { class: 'input', rows: 2, placeholder: 'Add choices, one per line', 'aria-label': 'New choices' });
    const unlisted = new Set(); usage.forEach((u) => u.counts.forEach((n, v) => { if (v && !l.items.includes(v)) unlisted.add(v); }));
    root.append(h('div', { class: 'panel narrow-panel' },
      h('table', { class: 'fields' }, h('tbody', null, items)),
      !l.items.length ? h('p', { class: 'hint' }, 'No choices yet.') : null,
      h('div', { class: 'stack' }, add, h('div', { class: 'inline' },
        h('button', { class: 'btn primary', onclick: () => { if (!add.value.trim()) return; db.setListItems(name, [...l.items, ...add.value.split('\n')]); rerender(); } }, '+ Add choices'),
        h('button', { class: 'btn', onclick: () => { db.setListItems(name, [...l.items].sort((a, b) => a.localeCompare(b))); rerender(); } }, 'Sort A–Z'),
        unlisted.size ? h('button', { class: 'btn', title: [...unlisted].join(', '), onclick: () => { db.setListItems(name, [...l.items, ...unlisted]); rerender(); } }, `Add ${unlisted.size} value${unlisted.size === 1 ? '' : 's'} found in records`) : null))));
  }

  Object.assign(DC, { tableView, listView, recordForm, inputFor });
})(window.DC);
