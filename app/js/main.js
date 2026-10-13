/* DataCraft — app shell: start screen, projects, sidebar, menus, settings, sample project. */
(function (DC) {
  'use strict';
  const { h, db, $ } = DC;

  DC.state = { view: 'home' };
  const viewStates = new Map();
  const vs = (key) => { if (!viewStates.has(key)) viewStates.set(key, {}); return viewStates.get(key); };
  DC.go = (state) => { DC.state = state; if (window.innerWidth < 900) document.body.classList.remove('nav-open'); DC.render(); DC.$('#main').scrollTop = 0; };

  // Save status in the sidebar
  const listeners = {};
  DC.emit = (ev) => { (listeners[ev] || []).forEach((f) => f()); };
  const on = (ev, f) => { (listeners[ev] = listeners[ev] || []).push(f); };
  on('dirty', () => setStatus('Saving…'));
  on('saved', () => setStatus('Saved to ' + DC.store.place));
  on('save-error', () => setStatus('Not saved'));
  function setStatus(t) { const s = $('#save-status'); if (s) s.textContent = t; }

  // ---------- Render ----------
  DC.render = function render() {
    const main = $('#main');
    const scroll = main.scrollTop;
    main.textContent = '';
    document.body.classList.toggle('has-project', !!DC.project);
    DC.renderSidebar();
    const st = DC.state;
    if (!DC.project) homeView(main);
    else if (st.view === 'table') DC.tableView(main, st.id, vs('t:' + st.id));
    else if (st.view === 'list') DC.listView(main, st.id);
    else if (st.view === 'page') DC.pageView(main, st.id, vs('p:' + st.id));
    else projectHome(main);
    $('#project-name').textContent = DC.project ? DC.project.name : '';
    document.title = DC.project ? `${DC.project.name} – DataCraft` : 'DataCraft';
    if (st.keepScroll) main.scrollTop = scroll;
  };

  DC.renderSidebar = function renderSidebar() {
    const nav = $('#nav');
    nav.textContent = '';
    if (!DC.project) return;
    const S = DC.project.schema;
    const item = (label, meta, state, extra) => h('button', {
      class: 'nav-item' + (DC.state.view === state.view && DC.state.id === state.id ? ' on' : ''), onclick: () => DC.go(state),
    }, h('span', { class: 'nav-label' }, label), meta != null ? h('span', { class: 'nav-meta' }, meta) : null, extra);
    const section = (title, addLabel, onAdd, items) => h('div', { class: 'nav-sec' },
      h('div', { class: 'nav-head' }, h('span', null, title), h('button', { class: 'btn ghost xs', title: addLabel, 'aria-label': addLabel, onclick: onAdd }, '+')),
      items.length ? items : h('p', { class: 'nav-empty' }, 'None yet'));
    nav.append(
      item('Overview', null, { view: 'home-project' }),
      section('Tables', 'New table', newTable, S.tables.map((t) => item(t.label, db.count(t.name), { view: 'table', id: t.name }))),
      section('Categories', 'New category list', newList, S.lists.map((l) => item(l.label, l.items.length, { view: 'list', id: l.name }))),
      section('Pages', 'New page', () => DC.newPageDialog(), S.pages.map((p) => item(p.name, p.kind === 'record' ? 'doc' : 'list', { view: 'page', id: p.id }))));
  };

  // ---------- Start screen ----------
  async function homeView(root) {
    const s = DC.store;
    const wrap = h('div', { class: 'home' });
    root.append(wrap);
    wrap.append(h('div', { class: 'hero' },
      h('h1', null, 'Your databases'),
      h('p', { class: 'muted' }, 'Make tables, import text files, keep categories, and print invoices and reports.')));

    const folderCard = h('div', { class: 'card where' });
    wrap.append(folderCard);
    if (s.mode === null) {
      folderCard.append(h('h2', null, 'Where should DataCraft keep your projects?'),
        h('p', null, 'Pick your ', h('b', null, 'datacraft'), ' folder (the one that contains the ', h('code', null, 'app'), ' folder). DataCraft saves each project in ', h('code', null, 'projects\\<name>'), ' there, and generated sites in ', h('code', null, 'php\\sites'), '.'),
        h('div', { class: 'inline' }, h('button', { class: 'btn primary', onclick: chooseFolder }, 'Choose the datacraft folder'),
          h('button', { class: 'btn', onclick: async () => { await s.useBrowser(); DC.render(); } }, 'Keep projects in this browser instead')));
      return;
    }
    if (s.mode === 'folder' && s.needsPermission) {
      folderCard.append(h('h2', null, 'Reconnect to your projects'),
        h('p', null, `For your security the browser asks again before DataCraft can use the “${s.root.name}” folder.`),
        h('div', { class: 'inline' }, h('button', { class: 'btn primary', onclick: async () => { if (await s.reconnect()) DC.render(); } }, `Allow access to ${s.root.name}`),
          h('button', { class: 'btn', onclick: chooseFolder }, 'Choose a different folder')));
      return;
    }
    folderCard.append(h('div', { class: 'inline' },
      h('span', null, s.mode === 'folder' ? ['Projects are saved in ', h('code', null, `${s.root.name}\\projects`)] : 'Projects are saved in this browser.'),
      h('span', { class: 'spacer' }),
      s.folderSupported ? h('button', { class: 'btn ghost sm', onclick: chooseFolder }, s.mode === 'folder' ? 'Change folder' : 'Use a folder instead') : null));

    const actions = h('div', { class: 'inline' },
      h('button', { class: 'btn primary', onclick: () => newProject() }, '+ New project'),
      h('button', { class: 'btn', onclick: () => newProject({ sample: true }) }, 'Create the sample shop project'),
      h('button', { class: 'btn', onclick: openDbFile }, 'Open a .db file…'));
    wrap.append(actions);
    const listEl = h('div', { class: 'projects' }, h('p', { class: 'muted' }, 'Loading projects…'));
    wrap.append(listEl);
    let projects = [];
    try { projects = await s.list(); } catch (e) { listEl.textContent = 'Could not read the projects folder: ' + e.message; return; }
    listEl.textContent = '';
    if (!projects.length) listEl.append(h('div', { class: 'card empty' }, h('p', null, 'No projects yet. Create one, or try the sample shop to see invoices and reports in action.')));
    projects.forEach((p) => listEl.append(h('div', { class: 'card project' },
      h('button', { class: 'project-open', onclick: () => openProject(p.name) }, h('b', null, p.name), h('span', { class: 'muted small' }, `Changed ${new Date(p.modified).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${(p.size / 1024).toFixed(0)} KB`)),
      h('button', { class: 'btn ghost sm danger-text', 'aria-label': 'Delete ' + p.name, onclick: async () => {
        if (!(await DC.ask({ title: `Delete the “${p.name}” project?`, body: s.mode === 'folder' ? `This deletes the projects\\${p.name} folder, including its imports and exports. This cannot be undone.` : 'This deletes the project from this browser. This cannot be undone.', ok: 'Delete project', danger: true }))) return;
        await s.remove(p.name); DC.render();
      } }, 'Delete'))));
  }
  async function chooseFolder() {
    try { await DC.store.chooseFolder(); DC.toast('Using the ' + DC.store.root.name + ' folder'); DC.render(); }
    catch (e) { if (e.name !== 'AbortError') DC.toast('Could not use that folder: ' + e.message); }
  }

  // ---------- Projects ----------
  const BAD_NAME = /[\\/:*?"<>|]/;
  async function newProject(opts = {}) {
    const v = await DC.formDialog({
      title: opts.sample ? 'Create the sample project' : 'New project', ok: 'Create',
      intro: opts.sample ? 'A small shop with customers, products, invoices and ready-made pages.' : 'A project is one database with its tables, categories and pages.',
      fields: [{ id: 'name', label: 'Project name', value: opts.sample ? 'Sample Shop' : '' }],
      validate: (v) => (!v.name.trim() ? 'Enter a name.' : BAD_NAME.test(v.name) ? 'A name cannot contain \\ / : * ? " < > |' : null),
    });
    if (!v) return;
    const name = v.name.trim();
    if (await DC.store.exists(name)) { DC.toast(`A project called “${name}” already exists.`); return; }
    await closeProject(true);
    await DC.openBytes(name, null);
    if (opts.sample) buildSample();
    else DC.setSettings({ created: DC.todayIso() });
    DC.project.dirty = true;
    await DC.saveProject();
    DC.go({ view: 'home-project' });
  }
  async function openProject(name) {
    try {
      await closeProject(true);
      await DC.openBytes(name, await DC.store.load(name));
      DC.go({ view: 'home-project' });
    } catch (e) { DC.toast('Could not open ' + name + ': ' + e.message); }
  }
  async function closeProject(quiet) {
    if (!DC.project) return;
    await DC.saveProject();
    DC.project.db.close();
    DC.project = null; viewStates.clear();
    if (!quiet) DC.go({ view: 'home' });
  }
  function openDbFile() {
    const inp = h('input', { type: 'file', accept: '.db,.sqlite,.sqlite3,.db3' });
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      let name = f.name.replace(/\.[^.]+$/, '').replace(BAD_NAME, '_');
      const taken = (await DC.store.list()).map((p) => p.name);
      name = DC.uniq(name, taken);
      try {
        await closeProject(true);
        await DC.openBytes(name, new Uint8Array(await f.arrayBuffer()));
        DC.project.dirty = true; await DC.saveProject();
        DC.toast(`Opened ${f.name} as the project “${name}”`);
        DC.go({ view: 'home-project' });
      } catch (e) { DC.toast('That file is not a database DataCraft can read.'); DC.project = null; DC.render(); }
    };
    inp.click();
  }
  function saveCopy() {
    if (!DC.project) return;
    if (DC.inFrame) { DC.toast('Downloads are blocked in this viewer.'); return; }
    DC.download(DC.project.name + '.db', DC.project.db.export());
  }
  async function settingsDialog() {
    const s = DC.project.settings;
    const v = await DC.formDialog({
      title: 'Project settings', ok: 'Save',
      fields: [
        { id: 'currency', label: 'Currency', type: 'select', value: s.currency, options: [['USD', 'US dollar ($)'], ['CAD', 'Canadian dollar ($)'], ['AUD', 'Australian dollar ($)'], ['NZD', 'New Zealand dollar ($)'], ['EUR', 'Euro (€)'], ['GBP', 'British pound (£)'], ['CHF', 'Swiss franc'], ['JPY', 'Japanese yen (¥)'], ['INR', 'Indian rupee (₹)'], ['MXN', 'Mexican peso ($)'], ['ZAR', 'South African rand (R)']] },
        { id: 'dateFormat', label: 'Show dates as', type: 'select', value: s.dateFormat, options: [['MM/DD/YYYY', '03/31/2026'], ['DD/MM/YYYY', '31/03/2026'], ['DD.MM.YYYY', '31.03.2026'], ['YYYY-MM-DD', '2026-03-31'], ['long', 'March 31, 2026']] },
        { id: 'pageSize', label: 'Paper for new pages', type: 'select', value: s.pageSize, options: Object.entries(DC.PAGE_SIZES).map(([k, v]) => [k, v[2]]) },
        { id: 'taxRate', label: 'Tax rate for new pages (%)', type: 'number', step: '0.01', value: s.taxRate },
      ],
    });
    if (!v) return;
    DC.setSettings(v); DC.render(); DC.toast('Settings saved');
  }

  // ---------- Project overview ----------
  function projectHome(root) {
    const S = DC.project.schema;
    root.append(h('div', { class: 'view-head' }, h('div', { class: 'title-row' }, h('h1', null, DC.project.name), h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: settingsDialog }, 'Settings'))));
    const card = (title, text, btn, onClick, primary) => h('div', { class: 'card step' }, h('h2', null, title), h('p', { class: 'muted' }, text), h('button', { class: 'btn' + (primary ? ' primary' : ''), onclick: onClick }, btn));
    root.append(h('div', { class: 'cards' },
      card('Import a file', 'Bring in a .txt or .csv file. DataCraft works out the columns for you.', 'Import text or CSV…', () => DC.importWizard(), !S.tables.length),
      card('Make a table', 'Start from scratch and add the fields you need.', 'New table…', newTable),
      card('Design a page', 'Invoices, record sheets and printable lists from your data.', 'New page…', () => DC.newPageDialog(), S.tables.length && !S.pages.length)));
    if (S.tables.length) {
      root.append(h('h2', { class: 'sub' }, 'Tables'), h('div', { class: 'grid-wrap' }, h('table', { class: 'grid overview' },
        h('thead', null, h('tr', null, h('th', null, 'Table'), h('th', { class: 'num' }, 'Records'), h('th', null, 'Fields'), h('th', null, ''))),
        h('tbody', null, S.tables.map((t) => h('tr', null,
          h('td', null, h('button', { class: 'link-btn', onclick: () => DC.go({ view: 'table', id: t.name }) }, t.label)),
          h('td', { class: 'num' }, db.count(t.name)),
          h('td', { class: 'muted clip' }, t.fields.map((f) => f.label).join(', ') || '—'),
          h('td', { class: 'nowrap' }, h('button', { class: 'btn sm', onclick: () => DC.exportDialog({ table: t.name }) }, 'Export CSV'))))))));
    }
    const s = DC.project.settings;
    root.append(h('p', { class: 'muted small' }, `Money in ${s.currency} · dates like ${DC.fmtDate('2026-03-31')} · ${DC.store.mode === 'folder' ? `saved in ${DC.store.root.name}\\projects\\${DC.project.name}\\${DC.project.name}.db` : 'saved in this browser'}`));
  }

  async function newTable() {
    const v = await DC.formDialog({ title: 'New table', ok: 'Create table', fields: [
      { id: 'label', label: 'Table name', placeholder: 'e.g. Customers' },
      { id: 'fields', label: 'Fields (one per line, optional)', type: 'textarea', placeholder: 'Name\nEmail\nPhone' }],
      validate: (v) => !v.label.trim() && 'Enter a name.' });
    if (!v) return;
    const name = db.createTable(v.label);
    v.fields.split('\n').map((s) => s.trim()).filter(Boolean).forEach((f) => db.addField(name, { label: f, type: 'text' }));
    const st = vs('t:' + name); st.tab = v.fields.trim() ? 'records' : 'fields';
    DC.go({ view: 'table', id: name });
  }
  async function newList() {
    const v = await DC.formDialog({ title: 'New category list', ok: 'Create list', fields: [
      { id: 'label', label: 'List name', placeholder: 'e.g. Product category' },
      { id: 'items', label: 'Choices (one per line)', type: 'textarea', placeholder: 'Hardware\nPaint\nGarden' }],
      validate: (v) => !v.label.trim() && 'Enter a name.' });
    if (!v) return;
    DC.go({ view: 'list', id: db.createList(v.label, v.items.split('\n')) });
  }

  // ---------- Sample project ----------
  function buildSample() {
    DC.setSettings({ currency: 'USD', dateFormat: 'MM/DD/YYYY', pageSize: 'letter', taxRate: '8', created: DC.todayIso() });
    const ctype = db.createList('Customer type', ['Retail', 'Trade', 'Online']);
    const pcat = db.createList('Product category', ['Hardware', 'Paint', 'Garden', 'Tools']);
    const status = db.createList('Invoice status', ['Draft', 'Sent', 'Paid', 'Overdue']);
    const C = db.createTable('Customers');
    const cf = {};
    [['Name', 'text'], ['Company', 'text'], ['Address', 'longtext'], ['Email', 'text'], ['Phone', 'text']].forEach(([l, t]) => { cf[l] = db.addField(C, { label: l, type: t }); });
    cf.Type = db.addField(C, { label: 'Type', type: 'category', opts: { list: ctype } });
    const P = db.createTable('Products');
    const pf = {};
    pf.Product = db.addField(P, { label: 'Product', type: 'text' });
    pf.Category = db.addField(P, { label: 'Category', type: 'category', opts: { list: pcat } });
    pf.Price = db.addField(P, { label: 'Price', type: 'currency' });
    pf.Unit = db.addField(P, { label: 'Unit', type: 'text' });
    pf.Stock = db.addField(P, { label: 'In stock', type: 'yesno' });
    const I = db.createTable('Invoices');
    const inf = {};
    inf.No = db.addField(I, { label: 'Invoice no', type: 'text' });
    inf.Date = db.addField(I, { label: 'Date', type: 'date', opts: { def: 'today' } });
    inf.Customer = db.addField(I, { label: 'Customer', type: 'link', opts: { link: C } });
    inf.Status = db.addField(I, { label: 'Status', type: 'category', opts: { list: status } });
    inf.Notes = db.addField(I, { label: 'Notes', type: 'longtext' });
    const L = db.createTable('Invoice lines');
    const lf = {};
    lf.Invoice = db.addField(L, { label: 'Invoice', type: 'link', opts: { link: I } });
    lf.Desc = db.addField(L, { label: 'Description', type: 'text' });
    lf.Qty = db.addField(L, { label: 'Quantity', type: 'number', opts: { decimals: '' } });
    lf.Price = db.addField(L, { label: 'Unit price', type: 'currency' });
    lf.Amount = db.addField(L, { label: 'Amount', type: 'formula', opts: { formula: '[Quantity] * [Unit price]', currency: true } });
    db.setDisplayField(I, inf.No);

    const cust = [
      ['Maria Lopez', 'Lopez Landscaping', '18 Orchard Road\nSpringfield, IL 62704', 'maria@lopezland.example', '(217) 555-0142', 'Trade'],
      ['James Okafor', '', '402 Elm Street, Apt 3\nSpringfield, IL 62701', 'j.okafor@mail.example', '(217) 555-0178', 'Retail'],
      ['Priya Shah', 'Shah Property Care', '77 Commerce Park\nDecatur, IL 62521', 'priya@shahcare.example', '(217) 555-0199', 'Trade'],
      ['Tom Becker', '', '9 Willow Lane\nChatham, IL 62629', 'tbecker@mail.example', '(217) 555-0111', 'Online'],
    ].map((r) => db.insertRow(C, { [cf.Name]: r[0], [cf.Company]: r[1], [cf.Address]: r[2], [cf.Email]: r[3], [cf.Phone]: r[4], [cf.Type]: r[5] }));
    [['Claw hammer 16 oz', 'Tools', 18.5, 'each', 1], ['Deck screws 3 in (1 lb)', 'Hardware', 9.75, 'box', 1], ['Exterior paint, white', 'Paint', 42, 'gallon', 1],
      ['Paint roller kit', 'Paint', 14.25, 'kit', 1], ['Garden hose 50 ft', 'Garden', 34.99, 'each', 0], ['Pruning shears', 'Garden', 22, 'each', 1],
      ['Cordless drill 20V', 'Tools', 129, 'each', 1], ['Wood glue 16 oz', 'Hardware', 7.5, 'bottle', 1], ['Potting soil 40 lb', 'Garden', 11.25, 'bag', 1], ['Painter’s tape', 'Paint', 6.4, 'roll', 1]]
      .forEach((r) => db.insertRow(P, { [pf.Product]: r[0], [pf.Category]: r[1], [pf.Price]: r[2], [pf.Unit]: r[3], [pf.Stock]: r[4] }));
    const d = (offset) => { const x = new Date(); x.setDate(x.getDate() - offset); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const inv = [['INV-1001', d(21), cust[0], 'Paid', 'Paid by bank transfer.'], ['INV-1002', d(9), cust[2], 'Sent', 'Payment due within 30 days.'], ['INV-1003', d(1), cust[1], 'Draft', '']]
      .map((r) => db.insertRow(I, { [inf.No]: r[0], [inf.Date]: r[1], [inf.Customer]: r[2], [inf.Status]: r[3], [inf.Notes]: r[4] }));
    [[0, 'Deck screws 3 in (1 lb)', 6, 9.75], [0, 'Exterior paint, white', 4, 42], [0, 'Paint roller kit', 2, 14.25], [0, 'Painter’s tape', 5, 6.4],
      [1, 'Cordless drill 20V', 1, 129], [1, 'Pruning shears', 3, 22], [1, 'Potting soil 40 lb', 10, 11.25], [2, 'Claw hammer 16 oz', 1, 18.5], [2, 'Wood glue 16 oz', 2, 7.5]]
      .forEach((r) => db.insertRow(L, { [lf.Invoice]: inv[r[0]], [lf.Desc]: r[1], [lf.Qty]: r[2], [lf.Price]: r[3] }));

    // Pages
    const invoice = DC.autoLayout({ name: 'Invoice', kind: 'record', table: I, size: 'letter', orient: 'portrait', taxRate: '8', elements: [] });
    // Replace the generated field blocks with a bill-to block and invoice details.
    const els = invoice.elements = invoice.elements.filter((e) => !(e.type === 'text' && e.y === 41));
    els[0].text = 'Corner Hardware & Garden\n214 Main Street\nSpringfield, IL 62701\n(217) 555-0100';
    els[0].h = 22;
    const half = (215.9 - 30) / 2;
    els.push({ id: DC._uid(), type: 'text', x: 15, y: 41, w: half - 4, h: 28, text: 'BILL TO\n{Customer}\n{Customer.Company}\n{Customer.Address}', size: 10, align: 'left', font: 'sans', color: '#000000' });
    els.push({ id: DC._uid(), type: 'text', x: 15 + half, y: 41, w: half, h: 18, text: 'Invoice no: {Invoice no}\nDate: {Date}\nStatus: {Status}', size: 10, align: 'right', font: 'sans', color: '#000000' });
    const notes = els.find((e) => e.type === 'text' && e.text.startsWith('Thank you'));
    if (notes) notes.text = '{Notes}\n\nThank you for your business.';
    DC.db.savePage(invoice);
    DC.db.savePage(DC.autoLayout({ name: 'Price list', kind: 'list', table: P, size: 'letter', orient: 'portrait', taxRate: '0', elements: [] }));
    DC.db.savePage(DC.autoLayout({ name: 'Customer sheet', kind: 'record', table: C, size: 'letter', orient: 'portrait', taxRate: '0', elements: [] }));
  }

  // ---------- Menus ----------
  const needP = () => !DC.project;
  const MENUS = [
    ['File', [
      { label: 'New project…', run: () => newProject() },
      { label: 'Open project…', run: async () => { await closeProject(); } },
      { label: 'Open a .db file…', run: openDbFile },
      '-',
      { label: 'Save a copy (.db)…', run: saveCopy, disabled: needP },
      { label: 'Project settings…', run: settingsDialog, disabled: needP },
      '-',
      { label: 'Close project', run: () => closeProject(), disabled: needP },
    ]],
    ['Data', [
      { label: 'New table…', run: newTable, disabled: needP },
      { label: 'New category list…', run: newList, disabled: needP },
      '-',
      { label: 'Import text or CSV…', run: () => DC.importWizard(DC.state.view === 'table' ? { table: DC.state.id } : {}), disabled: needP },
      { label: 'Export CSV…', run: () => DC.exportDialog(DC.state.view === 'table' ? { table: DC.state.id } : {}), disabled: needP },
    ]],
    ['Pages', [
      { label: 'New page…', run: () => DC.newPageDialog(), disabled: needP },
    ]],
    ['Help', [
      { label: 'Getting started', run: helpStart },
      { label: 'About DataCraft', run: () => DC.modal({ title: 'About DataCraft', actions: [{ label: 'Close', primary: true }], body: [
        h('p', null, h('b', null, 'DataCraft'), ' · version 0.1 (stage 1)'),
        h('p', null, 'Tables, categories, text import, CSV export and printable pages, stored as SQLite databases.'),
        h('p', { class: 'muted' }, 'Built with sql.js (SQLite, MIT licence) and Papa Parse (MIT licence).')] }) },
    ]],
  ];
  function helpStart() {
    DC.modal({ title: 'Getting started', wide: true, actions: [{ label: 'Close', primary: true }], body: h('div', { class: 'help' },
      h('h3', null, '1. Make or import a table'), h('p', null, 'Use Data › Import text or CSV to bring in a file, or Data › New table to start from scratch. Each table has fields such as Text, Number, Money, Date, Yes/No and Category.'),
      h('h3', null, '2. Use categories'), h('p', null, 'A Category field picks from a list you control under Categories. Rename a choice there and every record using it updates. Filter records by category above the grid.'),
      h('h3', null, '3. Link tables'), h('p', null, 'A “Link to another table” field connects records, such as an invoice line to its invoice, or an invoice to its customer. Calculated fields work things out, like [Quantity] * [Unit price].'),
      h('h3', null, '4. Design pages'), h('p', null, 'Pages › New page builds a starting layout. Type fixed text and {Field names} in text boxes, add a table for line items, then Preview and Print. In the print window you can choose “Save as PDF”.'),
      h('h3', null, '5. Export'), h('p', null, 'Export CSV saves into your project’s exports folder, ready for Excel or another program.')) });
  }

  function buildMenubar() {
    const bar = $('#menubar');
    let open = null;
    const close = () => { if (!open) return; open.btn.setAttribute('aria-expanded', 'false'); open.list.remove(); open = null; };
    MENUS.forEach(([name, items]) => {
      const wrap = h('div', { class: 'menu' });
      const btn = h('button', { class: 'menu-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, name);
      const show = () => {
        close();
        const list = h('div', { class: 'menu-list', role: 'menu' }, items.map((it) => it === '-' ? h('div', { class: 'menu-sep' }) :
          h('button', { class: 'menu-item', role: 'menuitem', disabled: !!(it.disabled && it.disabled()), onclick: () => { close(); it.run(); } }, it.label)));
        wrap.append(list); btn.setAttribute('aria-expanded', 'true'); open = { btn, list, wrap };
        list.addEventListener('keydown', (e) => {
          const b = [...list.querySelectorAll('.menu-item:not(:disabled)')], i = b.indexOf(document.activeElement);
          if (e.key === 'ArrowDown') { e.preventDefault(); b[(i + 1) % b.length].focus(); }
          if (e.key === 'ArrowUp') { e.preventDefault(); b[(i - 1 + b.length) % b.length].focus(); }
        });
      };
      btn.onclick = () => (open && open.btn === btn ? close() : show());
      btn.onmouseenter = () => { if (open && open.btn !== btn) show(); };
      btn.onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); show(); open.list.querySelector('.menu-item:not(:disabled)')?.focus(); } };
      wrap.append(btn); bar.append(wrap);
    });
    document.addEventListener('mousedown', (e) => { if (open && !open.wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { const b = open.btn; close(); b.focus(); } });
  }

  // ---------- Start ----------
  // Light / dark choice is remembered on this computer.
  function setTheme(t) {
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    try { localStorage.setItem('datacraft-theme', t); } catch (e) { /* ignore */ }
  }
  try { const t = localStorage.getItem('datacraft-theme'); if (t) setTheme(t); } catch (e) { /* ignore */ }

  // Light / dark toggle in the top bar
  const THEME_ICONS = { sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6"/></svg>', moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>' };
  const themeIsDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  function paintThemeButton() {
    const b = document.getElementById('theme-btn'); if (!b) return;
    const dark = themeIsDark();
    b.innerHTML = dark ? THEME_ICONS.sun : THEME_ICONS.moon;
    b.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    b.setAttribute('aria-label', b.title);
  }
  document.getElementById('theme-btn').addEventListener('click', () => { setTheme(themeIsDark() ? 'light' : 'dark'); paintThemeButton(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeButton);
  paintThemeButton();

  async function start() {
    buildMenubar();
    $('#nav-toggle').onclick = () => document.body.classList.toggle('nav-open');
    $('#brand').onclick = () => (DC.project ? DC.go({ view: 'home-project' }) : DC.render());
    $('#settings-btn').onclick = () => DC.project && settingsDialog();
    $('#close-btn').onclick = () => closeProject();
    window.addEventListener('beforeunload', (e) => { if (DC.project && DC.project.dirty) { DC.saveProject(); e.preventDefault(); e.returnValue = ''; } });
    try { await DC.sqlReady(); } catch (e) { $('#main').textContent = 'The database engine could not start: ' + e.message; return; }
    await DC.store.init();
    DC.render();
  }
  start();
})(window.DC);
