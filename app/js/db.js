/* DataCraft — the project database (SQLite via sql.js): schema, categories, pages, records. */
(function (DC) {
  'use strict';
  const { qi, ident, uniq } = DC;

  let SQL = null;
  async function sqlReady() { if (!SQL) SQL = await window.initSqlJs({ locateFile: (f) => 'lib/' + f }); return SQL; }

  const META = `
    CREATE TABLE IF NOT EXISTS _dc_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS _dc_tables (name TEXT PRIMARY KEY, label TEXT, ord INTEGER, display TEXT);
    CREATE TABLE IF NOT EXISTS _dc_fields (tbl TEXT, name TEXT, label TEXT, type TEXT, ord INTEGER, opts TEXT, PRIMARY KEY (tbl, name));
    CREATE TABLE IF NOT EXISTS _dc_lists (name TEXT PRIMARY KEY, label TEXT);
    CREATE TABLE IF NOT EXISTS _dc_list_items (list TEXT, value TEXT, ord INTEGER, PRIMARY KEY (list, value));
    CREATE TABLE IF NOT EXISTS _dc_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, json TEXT, ord INTEGER);`;
  const DEFAULT_SETTINGS = { currency: 'USD', dateFormat: 'MM/DD/YYYY', pageSize: 'letter', taxRate: '0', locale: '' };
  const AFFINITY = { text: 'TEXT', longtext: 'TEXT', category: 'TEXT', number: 'REAL', currency: 'REAL', date: 'TEXT', yesno: 'INTEGER', link: 'INTEGER' };
  const TYPES = [
    ['text', 'Text'], ['longtext', 'Notes (long text)'], ['number', 'Number'], ['currency', 'Money'],
    ['date', 'Date'], ['yesno', 'Yes / No'], ['category', 'Category (pick from a list)'], ['link', 'Link to another table'], ['formula', 'Calculated (formula)'],
  ];

  // ---------- Low-level ----------
  const P = () => DC.project;
  function q(sql, params) {
    const st = P().db.prepare(sql);
    try { if (params) st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
    finally { st.free(); }
  }
  const one = (sql, params) => q(sql, params)[0];
  function run(sql, params) { P().db.run(sql, params); }

  // ---------- Project lifecycle ----------
  async function openBytes(name, bytes) {
    await sqlReady();
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    DC.project = { name, db, settings: {}, schema: null, dirty: false };
    db.run(META);
    adoptForeignTables();
    loadSettings();
    loadSchema();
    return DC.project;
  }
  function loadSettings() {
    const s = { ...DEFAULT_SETTINGS };
    q('SELECT key, value FROM _dc_settings').forEach((r) => { s[r.key] = r.value; });
    P().settings = s;
  }
  function setSettings(patch) {
    Object.entries(patch).forEach(([k, v]) => run('INSERT OR REPLACE INTO _dc_settings (key, value) VALUES (?, ?)', [k, String(v)]));
    loadSettings(); changed();
  }
  // Tables made by other programs get metadata so they can be browsed (used when opening any .db file).
  function adoptForeignTables() {
    const known = new Set(q('SELECT name FROM _dc_tables').map((r) => r.name));
    const tables = q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_dc_%' AND name NOT LIKE 'sqlite_%'");
    tables.forEach(({ name }, i) => {
      if (known.has(name)) return;
      run('INSERT INTO _dc_tables (name, label, ord, display) VALUES (?, ?, ?, NULL)', [name, labelize(name), 1000 + i]);
      q(`PRAGMA table_info(${qi(name)})`).forEach((c, j) => {
        if (c.pk && /INT/i.test(c.type)) return; // rowid alias, shown as the record number
        const t = /INT/i.test(c.type) ? 'number' : /REAL|FLOA|DOUB|NUM|DEC/i.test(c.type) ? 'number' : /DATE/i.test(c.type) ? 'date' : 'text';
        run('INSERT INTO _dc_fields (tbl, name, label, type, ord, opts) VALUES (?, ?, ?, ?, ?, ?)', [name, c.name, labelize(c.name), t, j, '{}']);
      });
    });
  }
  const labelize = (n) => String(n).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // Save shortly after each change.
  const saveSoon = DC.debounce(() => DC.saveProject(), 700);
  function changed() { if (!P()) return; P().dirty = true; DC.emit && DC.emit('dirty'); saveSoon(); }
  async function saveProject() {
    const p = P(); if (!p || !p.dirty) return;
    try {
      p.dirty = false;
      await DC.store.save(p.name, p.db.export());
      DC.emit && DC.emit('saved');
    } catch (e) {
      p.dirty = true;
      DC.toast('Could not save: ' + e.message);
      DC.emit && DC.emit('save-error', e);
    }
  }

  // ---------- Schema ----------
  function loadSchema() {
    const lists = q('SELECT name, label FROM _dc_lists ORDER BY label COLLATE NOCASE').map((l) => ({
      ...l, items: q('SELECT value FROM _dc_list_items WHERE list = ? ORDER BY ord, value', [l.name]).map((r) => r.value),
    }));
    const tables = q('SELECT name, label, display FROM _dc_tables ORDER BY ord, label').map((t) => {
      const fields = q('SELECT name, label, type, opts FROM _dc_fields WHERE tbl = ? ORDER BY ord', [t.name])
        .map((f) => ({ ...f, opts: safeJson(f.opts) }));
      return { ...t, fields };
    });
    tables.forEach((t) => {
      t.displayField = t.fields.find((f) => f.name === t.display) || t.fields.find((f) => ['text', 'category'].includes(f.type)) || t.fields[0] || null;
      t.fields.forEach((f) => { if (f.type === 'formula') { try { f.calc = DC.compileFormula(f.opts.formula); f.calcError = null; } catch (e) { f.calc = null; f.calcError = e.message; } } });
    });
    const pages = q('SELECT id, name, json FROM _dc_pages ORDER BY ord, id').map((p) => ({ id: p.id, ...safeJson(p.json), name: p.name }));
    P().schema = { tables, lists, pages };
    return P().schema;
  }
  const safeJson = (s) => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };
  const S = () => P().schema;
  const table = (name) => S().tables.find((t) => t.name === name);
  const list = (name) => S().lists.find((l) => l.name === name);
  const field = (tbl, name) => (table(tbl) || { fields: [] }).fields.find((f) => f.name === name);
  const allNames = () => q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);

  function createTable(label) {
    const name = uniq(ident(label), allNames());
    run(`CREATE TABLE ${qi(name)} (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
    const ord = (one('SELECT MAX(ord) AS m FROM _dc_tables').m || 0) + 1;
    run('INSERT INTO _dc_tables (name, label, ord) VALUES (?, ?, ?)', [name, label.trim(), ord]);
    loadSchema(); changed();
    return name;
  }
  function renameTable(name, label) { run('UPDATE _dc_tables SET label = ? WHERE name = ?', [label.trim(), name]); loadSchema(); changed(); }
  function setDisplayField(name, fieldName) { run('UPDATE _dc_tables SET display = ? WHERE name = ?', [fieldName, name]); loadSchema(); changed(); }
  function deleteTable(name) {
    run(`DROP TABLE IF EXISTS ${qi(name)}`);
    run('DELETE FROM _dc_tables WHERE name = ?', [name]);
    run('DELETE FROM _dc_fields WHERE tbl = ?', [name]);
    // Links pointing at this table become plain numbers.
    q('SELECT tbl, name, opts FROM _dc_fields WHERE type = ?', ['link']).forEach((f) => {
      const o = safeJson(f.opts); if (o.link === name) run("UPDATE _dc_fields SET type = 'number', opts = '{}' WHERE tbl = ? AND name = ?", [f.tbl, f.name]);
    });
    loadSchema(); changed();
  }

  function addField(tbl, { label, type = 'text', opts = {} }) {
    const t = table(tbl);
    const name = uniq(ident(label), ['id', ...t.fields.map((f) => f.name), ...q(`PRAGMA table_info(${qi(tbl)})`).map((c) => c.name)]);
    if (type !== 'formula') run(`ALTER TABLE ${qi(tbl)} ADD COLUMN ${qi(name)} ${AFFINITY[type] || 'TEXT'}`);
    const ord = (one('SELECT MAX(ord) AS m FROM _dc_fields WHERE tbl = ?', [tbl]).m ?? -1) + 1;
    run('INSERT INTO _dc_fields (tbl, name, label, type, ord, opts) VALUES (?, ?, ?, ?, ?, ?)', [tbl, name, label.trim(), type, ord, JSON.stringify(opts)]);
    loadSchema(); changed();
    return name;
  }
  function updateField(tbl, name, patch) {
    const f = field(tbl, name); if (!f) return;
    const next = { label: patch.label ?? f.label, type: patch.type ?? f.type, opts: { ...f.opts, ...(patch.opts || {}) } };
    const hasColumn = q(`PRAGMA table_info(${qi(tbl)})`).some((c) => c.name === name);
    if (next.type !== 'formula' && !hasColumn) run(`ALTER TABLE ${qi(tbl)} ADD COLUMN ${qi(name)} ${AFFINITY[next.type] || 'TEXT'}`);
    run('UPDATE _dc_fields SET label = ?, type = ?, opts = ? WHERE tbl = ? AND name = ?', [next.label, next.type, JSON.stringify(next.opts), tbl, name]);
    loadSchema(); changed();
  }
  function deleteField(tbl, name) {
    if (q(`PRAGMA table_info(${qi(tbl)})`).some((c) => c.name === name)) run(`ALTER TABLE ${qi(tbl)} DROP COLUMN ${qi(name)}`);
    run('DELETE FROM _dc_fields WHERE tbl = ? AND name = ?', [tbl, name]);
    loadSchema(); changed();
  }
  function moveField(tbl, name, dir) {
    const fs = table(tbl).fields.map((f) => f.name);
    const i = fs.indexOf(name), j = i + dir;
    if (i < 0 || j < 0 || j >= fs.length) return;
    [fs[i], fs[j]] = [fs[j], fs[i]];
    fs.forEach((n, k) => run('UPDATE _dc_fields SET ord = ? WHERE tbl = ? AND name = ?', [k, tbl, n]));
    loadSchema(); changed();
  }

  // ---------- Category lists ----------
  function createList(label, items = []) {
    const name = uniq(ident(label), S().lists.map((l) => l.name));
    run('INSERT INTO _dc_lists (name, label) VALUES (?, ?)', [name, label.trim()]);
    setListItems(name, items, false);
    loadSchema(); changed();
    return name;
  }
  function setListItems(name, items, reload = true) {
    run('DELETE FROM _dc_list_items WHERE list = ?', [name]);
    [...new Set(items.map((s) => String(s).trim()).filter(Boolean))].forEach((v, i) => run('INSERT INTO _dc_list_items (list, value, ord) VALUES (?, ?, ?)', [name, v, i]));
    if (reload) { loadSchema(); changed(); }
  }
  function renameList(name, label) { run('UPDATE _dc_lists SET label = ? WHERE name = ?', [label.trim(), name]); loadSchema(); changed(); }
  // Renames a category value everywhere it is used.
  function renameListValue(name, from, to) {
    to = String(to).trim(); if (!to || to === from) return 0;
    let n = 0;
    S().tables.forEach((t) => t.fields.filter((f) => f.type === 'category' && f.opts.list === name).forEach((f) => {
      run(`UPDATE ${qi(t.name)} SET ${qi(f.name)} = ? WHERE ${qi(f.name)} = ?`, [to, from]);
      n += P().db.getRowsModified();
    }));
    const l = list(name);
    setListItems(name, l.items.map((v) => (v === from ? to : v)));
    return n;
  }
  function listUsage(name) {
    const out = [];
    S().tables.forEach((t) => t.fields.filter((f) => f.type === 'category' && f.opts.list === name).forEach((f) => {
      const counts = new Map(q(`SELECT ${qi(f.name)} AS v, COUNT(*) AS n FROM ${qi(t.name)} GROUP BY ${qi(f.name)}`).map((r) => [r.v, r.n]));
      out.push({ table: t, field: f, counts });
    }));
    return out;
  }
  function deleteList(name) {
    run('DELETE FROM _dc_lists WHERE name = ?', [name]);
    run('DELETE FROM _dc_list_items WHERE list = ?', [name]);
    q("SELECT tbl, name, opts FROM _dc_fields WHERE type = 'category'").forEach((f) => {
      const o = safeJson(f.opts); if (o.list === name) run("UPDATE _dc_fields SET type = 'text', opts = '{}' WHERE tbl = ? AND name = ?", [f.tbl, f.name]);
    });
    loadSchema(); changed();
  }

  // ---------- Records ----------
  const isStored = (f) => f.type !== 'formula';
  // opts: { search, filters: {field: value}, sort: {field, dir}, limit, offset, where: {field: value} }
  function rows(tblName, opts = {}) {
    const t = table(tblName);
    const cols = t.fields.filter(isStored);
    const where = [], params = [];
    if (opts.search) {
      const like = '%' + opts.search + '%';
      const searchable = cols.filter((f) => !['yesno', 'link'].includes(f.type));
      if (searchable.length) { where.push('(' + searchable.map((f) => `CAST(${qi(f.name)} AS TEXT) LIKE ?`).join(' OR ') + ')'); searchable.forEach(() => params.push(like)); }
    }
    Object.entries({ ...(opts.filters || {}), ...(opts.where || {}) }).forEach(([k, v]) => {
      if (v === '' || v == null) return;
      if (v === '__none__') where.push(`(${qi(k)} IS NULL OR ${qi(k)} = '')`);
      else { where.push(`${qi(k)} = ?`); params.push(v); }
    });
    const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const sortF = opts.sort && cols.find((f) => f.name === opts.sort.field);
    const order = sortF ? ` ORDER BY ${qi(sortF.name)} ${opts.sort.dir === 'desc' ? 'DESC' : 'ASC'}, rowid` : ' ORDER BY rowid';
    const lim = opts.limit ? ` LIMIT ${+opts.limit} OFFSET ${+(opts.offset || 0)}` : '';
    const sel = ['rowid AS _rid', ...cols.map((f) => qi(f.name))].join(', ');
    const out = q(`SELECT ${sel} FROM ${qi(t.name)}${w}${order}${lim}`, params);
    const total = opts.limit ? one(`SELECT COUNT(*) AS n FROM ${qi(t.name)}${w}`, params).n : out.length;
    out.forEach((r) => computeFormulas(t, r));
    return { rows: out, total };
  }
  function getRow(tblName, rid) { const t = table(tblName); const r = one(`SELECT rowid AS _rid, * FROM ${qi(t.name)} WHERE rowid = ?`, [rid]); if (r) computeFormulas(t, r); return r || null; }
  function computeFormulas(t, r) {
    const calcs = t.fields.filter((f) => f.type === 'formula');
    if (!calcs.length) return r;
    const vals = {};
    t.fields.forEach((f) => { vals[f.label.toLowerCase()] = r[f.name]; });
    calcs.forEach((f) => { r[f.name] = f.calc ? f.calc(vals) : null; vals[f.label.toLowerCase()] = r[f.name]; });
    return r;
  }
  function defaults(t) {
    const v = {};
    t.fields.forEach((f) => { if (f.opts.def != null && f.opts.def !== '' && isStored(f)) v[f.name] = f.opts.def === 'today' && f.type === 'date' ? DC.todayIso() : f.opts.def; });
    return v;
  }
  function insertRow(tblName, values) {
    const t = table(tblName);
    const cols = t.fields.filter(isStored).filter((f) => f.name in values);
    if (!cols.length) run(`INSERT INTO ${qi(t.name)} DEFAULT VALUES`);
    else run(`INSERT INTO ${qi(t.name)} (${cols.map((f) => qi(f.name)).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((f) => normalize(f, values[f.name])));
    const rid = one('SELECT last_insert_rowid() AS id').id;
    changed();
    return rid;
  }
  function updateRow(tblName, rid, values) {
    const t = table(tblName);
    const cols = t.fields.filter(isStored).filter((f) => f.name in values);
    if (!cols.length) return;
    run(`UPDATE ${qi(t.name)} SET ${cols.map((f) => qi(f.name) + ' = ?').join(', ')} WHERE rowid = ?`, [...cols.map((f) => normalize(f, values[f.name])), rid]);
    changed();
  }
  function deleteRows(tblName, rids) {
    if (!rids.length) return;
    run(`DELETE FROM ${qi(tblName)} WHERE rowid IN (${rids.map(() => '?').join(',')})`, rids);
    changed();
  }
  function count(tblName) { try { return one(`SELECT COUNT(*) AS n FROM ${qi(tblName)}`).n; } catch (e) { return 0; } }
  function normalize(f, v) {
    if (v === '' || v === undefined) return null;
    switch (f.type) {
      case 'number': case 'currency': { const n = typeof v === 'number' ? v : DC.parseNumber(v); return n == null ? null : n; }
      case 'yesno': return v === true || v === 1 || v === '1' ? 1 : v === false || v === 0 || v === '0' ? 0 : DC.parseYesNo(v);
      case 'link': return v == null ? null : +v || null;
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : DC.parseDate(v);
      default: return v == null ? null : String(v);
    }
  }
  // Map of rowid -> display text for a table, for showing link fields.
  function linkMap(tblName) {
    const t = table(tblName); if (!t) return new Map();
    const d = t.displayField;
    if (!d) return new Map(q(`SELECT rowid AS r FROM ${qi(t.name)}`).map((r) => [r.r, '#' + r.r]));
    if (d.type === 'formula') return new Map(rows(t.name).rows.map((r) => [r._rid, String(r[d.name] ?? '')]));
    return new Map(q(`SELECT rowid AS r, ${qi(d.name)} AS v FROM ${qi(t.name)} ORDER BY ${qi(d.name)}`).map((r) => [r.r, r.v == null || r.v === '' ? '#' + r.r : DC.fmtValue(d, r.v)]));
  }
  function linkMapsFor(t) {
    const maps = {};
    t.fields.filter((f) => f.type === 'link' && f.opts.link).forEach((f) => { if (!maps[f.opts.link]) maps[f.opts.link] = linkMap(f.opts.link); });
    return maps;
  }

  // ---------- Pages ----------
  function savePage(page) {
    const { id, name, ...rest } = page;
    if (id) run('UPDATE _dc_pages SET name = ?, json = ? WHERE id = ?', [name, JSON.stringify(rest), id]);
    else run('INSERT INTO _dc_pages (name, json, ord) VALUES (?, ?, (SELECT IFNULL(MAX(ord), 0) + 1 FROM _dc_pages))', [name, JSON.stringify(rest)]);
    const newId = id || one('SELECT last_insert_rowid() AS id').id;
    loadSchema(); changed();
    return newId;
  }
  function deletePage(id) { run('DELETE FROM _dc_pages WHERE id = ?', [id]); loadSchema(); changed(); }

  DC.TYPES = TYPES;
  Object.assign(DC, {
    sqlReady, openBytes, saveProject, setSettings, loadSchema, changed,
    db: { q, one, run, table, list, field, createTable, renameTable, setDisplayField, deleteTable, addField, updateField, deleteField, moveField,
      createList, setListItems, renameList, renameListValue, listUsage, deleteList,
      rows, getRow, insertRow, updateRow, deleteRows, count, defaults, normalize, linkMap, linkMapsFor, computeFormulas, savePage, deletePage },
  });
})(window.DC);
