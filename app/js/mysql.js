/* DataCraft — developer tools: MySQL .sql export, reading MySQL / phpMyAdmin .sql files, SQL console. */
(function (DC) {
  'use strict';
  const { h, db, qi } = DC;

  // =====================================================================
  // Developer mode (remembered on this computer)
  // =====================================================================
  const DEV_KEY = 'datacraft-dev';
  DC.devMode = () => { try { return localStorage.getItem(DEV_KEY) === '1'; } catch (e) { return false; } };
  DC.setDevMode = (on) => { try { localStorage.setItem(DEV_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ } };

  const CATEGORY_TABLE = 'dc_categories';
  const labelize = (n) => String(n).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // =====================================================================
  // MySQL export
  // =====================================================================
  const bq = (n) => '`' + String(n).replace(/`/g, '``') + '`';
  const MY_ESC = { '\0': '\\0', '\n': '\\n', '\r': '\\r', '\x1a': '\\Z', "'": "\\'", '\\': '\\\\' };
  const myStr = (s) => "'" + String(s).replace(/[\0\n\r\x1a'\\]/g, (c) => MY_ESC[c]) + "'";

  // The record-number column of a table: its INTEGER PRIMARY KEY, or a made-up name for the hidden rowid.
  function keyColumn(tblName) {
    const cols = db.q(`PRAGMA table_info(${qi(tblName)})`);
    const pks = cols.filter((c) => c.pk);
    if (pks.length === 1 && /INT/i.test(pks[0].type)) return pks[0].name;
    const taken = new Set(cols.map((c) => c.name.toLowerCase()));
    return ['id', 'dc_id', 'dc_rowid'].find((n) => !taken.has(n)) || 'dc_key';
  }
  function colStats(tbl, col) {
    const c = qi(col);
    return db.one(`SELECT COUNT(${c}) AS n, IFNULL(MAX(LENGTH(CAST(${c} AS TEXT))), 0) AS maxLen,
      SUM(CASE WHEN ${c} IS NOT NULL AND NOT (typeof(${c}) = 'integer' OR (typeof(${c}) = 'real' AND ${c} = CAST(${c} AS INTEGER))) THEN 1 ELSE 0 END) AS nonInt,
      IFNULL(MAX(ABS(${c})), 0) AS big FROM ${qi(tbl)}`);
  }
  function myType(f, st) {
    switch (f.type) {
      case 'longtext': return st.maxLen > 65535 ? 'MEDIUMTEXT' : 'TEXT';
      case 'number': if (st.n && !st.nonInt) return st.big > 2147483647 ? 'BIGINT' : 'INT'; return 'DOUBLE';
      case 'currency': return 'DECIMAL(12,2)';
      case 'date': return 'DATE';
      case 'yesno': return 'TINYINT(1)';
      case 'link': return 'INT UNSIGNED';
      case 'category': return st.maxLen > 255 ? 'TEXT' : st.maxLen > 100 ? 'VARCHAR(255)' : 'VARCHAR(100)';
      default: return st.maxLen > 255 ? 'TEXT' : 'VARCHAR(255)';
    }
  }
  function myVal(f, v) {
    if (v == null || v === '') return 'NULL';
    switch (f.type) {
      case 'number': case 'currency': case 'link': case 'yesno': { const n = Number(v); return isFinite(n) ? String(n) : 'NULL'; }
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `'${v}'` : 'NULL';
      default: return myStr(v instanceof Uint8Array ? new TextDecoder().decode(v) : v);
    }
  }

  // Turns a DataCraft formula into a MySQL expression. As in DataCraft, empty values count as 0
  // and dividing by 0 gives an empty result. Other calculated fields are written out in full.
  function formulaSql(t, src, seen) {
    const toks = [];
    const re = /\s*(?:(\d+(?:\.\d+)?)|\[([^\]]+)\]|([-+*/()]))/y;
    const s = String(src || '').trim();
    let pos = 0;
    while (pos < s.length) {
      re.lastIndex = pos;
      const m = re.exec(s);
      if (!m) throw new Error('formula');
      pos = re.lastIndex;
      toks.push(m[1] ? { n: m[1] } : m[2] ? { f: m[2].trim().toLowerCase() } : { o: m[3] });
      while (pos < s.length && s[pos] === ' ') pos++;
    }
    let i = 0;
    const peek = () => toks[i] && toks[i].o;
    const ref = (label) => {
      const f = t.fields.find((x) => x.label.toLowerCase() === label);
      if (!f) return '0';
      if (f.type !== 'formula') return `IFNULL(${bq(f.name)}, 0)`;
      if (seen.has(f.name)) throw new Error('loop');
      return '(' + formulaSql(t, f.opts.formula, new Set([...seen, f.name])) + ')';
    };
    function expr() { let x = term(); while (peek() === '+' || peek() === '-') { const op = toks[i++].o; x = `${x} ${op} ${term()}`; } return x; }
    function term() { let x = unary(); while (peek() === '*' || peek() === '/') { const op = toks[i++].o; const r = unary(); x = op === '*' ? `${x} * ${r}` : `${x} / NULLIF(${r}, 0)`; } return x; }
    function unary() { if (peek() === '-') { i++; return '-(' + unary() + ')'; } return atom(); }
    function atom() {
      const k = toks[i++];
      if (!k) throw new Error('formula');
      if (k.n) return k.n;
      if (k.f) return ref(k.f);
      if (k.o === '(') { const x = expr(); if (peek() !== ')') throw new Error('formula'); i++; return '(' + x + ')'; }
      throw new Error('formula');
    }
    if (!toks.length) throw new Error('formula');
    const out = expr();
    if (i < toks.length) throw new Error('formula');
    return out;
  }

  // o: { tables: Set(names), data, drop, lists, formulas, foreignKeys, database }
  function buildMysql(o) {
    const S = DC.project.schema;
    const out = [], notes = [];
    const L = (s = '') => out.push(s);
    const ENGINE = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    L('-- DataCraft MySQL export');
    L(`-- Project: ${DC.project.name.replace(/[\r\n]/g, ' ')}`);
    L(`-- Made: ${new Date().toLocaleString()}`);
    L('-- For MySQL 5.7+ and MariaDB 10.2+. Import it with phpMyAdmin (Import tab), or from a command prompt:');
    L('--   mysql -u USER -p DATABASE < this-file.sql');
    L();
    L('SET NAMES utf8mb4;');
    L('SET FOREIGN_KEY_CHECKS = 0;');
    L("SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';");
    L();
    if (o.database) {
      L(`CREATE DATABASE IF NOT EXISTS ${bq(o.database)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
      L(`USE ${bq(o.database)};`);
      L();
    }
    const keys = Object.fromEntries(S.tables.map((t) => [t.name, keyColumn(t.name)]));
    let rowCount = 0, tableCount = 0;
    S.tables.filter((t) => o.tables.has(t.name)).forEach((t) => {
      tableCount++;
      const key = keys[t.name];
      const cols = [`  ${bq(key)} INT UNSIGNED NOT NULL AUTO_INCREMENT`];
      const extra = [`  PRIMARY KEY (${bq(key)})`];
      const stored = [];
      t.fields.forEach((f) => {
        // {dc:...} markers let DataCraft read its own exports back with categories and links intact.
        const marker = f.type === 'category' && f.opts.list ? ` {dc:category=${f.opts.list}}` : f.type === 'link' && f.opts.link ? ` {dc:link=${f.opts.link}}` : '';
        const comment = ` COMMENT ${myStr((f.label + marker).slice(0, 1024))}`;
        if (f.type === 'formula') {
          if (!o.formulas) return;
          let ex;
          try { ex = formulaSql(t, f.opts.formula, new Set([f.name])); } catch (e) { notes.push(`${t.label} › ${f.label}: this calculation could not be written for MySQL, so it was left out.`); return; }
          cols.push(`  ${bq(f.name)} ${f.opts.currency ? 'DECIMAL(15,2)' : 'DOUBLE'} AS (${ex}) VIRTUAL${comment}`);
          return;
        }
        cols.push(`  ${bq(f.name)} ${myType(f, colStats(t.name, f.name))} NULL${comment}`);
        stored.push(f);
        if (f.type === 'link' && f.opts.link && keys[f.opts.link]) {
          extra.push(`  KEY ${bq(('ix_' + f.name).slice(0, 64))} (${bq(f.name)})`);
          if (o.foreignKeys && o.tables.has(f.opts.link)) {
            extra.push(`  CONSTRAINT ${bq(('fk_' + t.name + '_' + f.name).slice(0, 64))} FOREIGN KEY (${bq(f.name)}) REFERENCES ${bq(f.opts.link)} (${bq(keys[f.opts.link])}) ON DELETE SET NULL ON UPDATE CASCADE`);
          }
        }
      });
      const tComment = t.label + (t.display ? ` {dc:display=${t.display}}` : '');
      L(`-- ${t.label.replace(/[\r\n]/g, ' ')}`);
      if (o.drop) L(`DROP TABLE IF EXISTS ${bq(t.name)};`);
      L(`CREATE TABLE ${bq(t.name)} (`);
      L([...cols, ...extra].join(',\n'));
      L(`) ${ENGINE} COMMENT=${myStr(tComment.slice(0, 2048))};`);
      L();
      if (o.data) {
        const res = DC.project.db.exec(`SELECT ${['rowid', ...stored.map((f) => qi(f.name))].join(', ')} FROM ${qi(t.name)} ORDER BY rowid`)[0];
        const vals = res ? res.values : [];
        const names = [key, ...stored.map((f) => f.name)].map(bq).join(', ');
        for (let i = 0; i < vals.length; i += 200) {
          L(`INSERT INTO ${bq(t.name)} (${names}) VALUES`);
          L(vals.slice(i, i + 200).map((r) => '(' + r.map((v, j) => (j === 0 ? String(v) : myVal(stored[j - 1], v))).join(', ') + ')').join(',\n') + ';');
        }
        if (vals.length) L();
        rowCount += vals.length;
      }
    });
    if (o.lists && S.lists.length) {
      L('-- Category lists (the choices for the category fields)');
      if (o.drop) L(`DROP TABLE IF EXISTS ${bq(CATEGORY_TABLE)};`);
      L(`CREATE TABLE ${bq(CATEGORY_TABLE)} (`);
      L('  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,\n  `list` VARCHAR(64) NOT NULL,\n  `label` VARCHAR(255) NOT NULL,\n  `value` TEXT NULL,\n  `ord` INT NOT NULL DEFAULT 0,\n  PRIMARY KEY (`id`),\n  KEY `list` (`list`, `ord`)');
      L(`) ${ENGINE} COMMENT='DataCraft category lists';`);
      const rows = [];
      S.lists.forEach((l) => {
        if (!l.items.length) rows.push(`(${myStr(l.name)}, ${myStr(l.label)}, NULL, 0)`);
        l.items.forEach((v, i) => rows.push(`(${myStr(l.name)}, ${myStr(l.label)}, ${myStr(v)}, ${i})`));
      });
      L(`INSERT INTO ${bq(CATEGORY_TABLE)} (\`list\`, \`label\`, \`value\`, \`ord\`) VALUES`);
      L(rows.join(',\n') + ';');
      L();
    }
    L('SET FOREIGN_KEY_CHECKS = 1;');
    return { text: out.join('\n') + '\n', tables: tableCount, rows: rowCount, notes };
  }

  function exportMysqlDialog() {
    if (!DC.project) return;
    const S = DC.project.schema;
    if (!S.tables.length) { DC.toast('There are no tables to export yet.'); return; }
    const sel = new Set(S.tables.map((t) => t.name));
    const o = { data: true, drop: true, lists: true, formulas: true, foreignKeys: false, database: '' };
    const chk = (key, label, hint) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: o[key], onchange: (e) => { o[key] = e.target.checked; } }), ' ', label, hint ? h('span', { class: 'muted small' }, ' – ' + hint) : null);
    const dbIn = h('input', { class: 'input', placeholder: 'Leave empty to use the database you pick in phpMyAdmin', oninput: () => { o.database = dbIn.value.trim(); } });
    const body = h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Makes a .sql file you can import into MySQL or MariaDB, for example with phpMyAdmin on your web host.'),
      h('div', null, h('span', { class: 'label' }, 'Tables'), h('div', { class: 'checks' }, S.tables.map((t) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: true, onchange: (e) => { if (e.target.checked) sel.add(t.name); else sel.delete(t.name); } }), ' ', t.label, h('span', { class: 'muted small' }, ` (${db.count(t.name)})`))))),
      chk('data', 'Include the records', 'untick for the table structure only'),
      chk('drop', 'Replace tables that already exist', 'adds DROP TABLE IF EXISTS'),
      S.lists.length ? chk('lists', 'Include the category lists', `as a table named ${CATEGORY_TABLE}`) : null,
      chk('formulas', 'Include calculated fields', 'as generated columns'),
      chk('foreignKeys', 'Add foreign keys for links', 'stricter: MySQL then refuses links to records that do not exist'),
      h('label', { class: 'field narrow' }, h('span', null, 'Create a database named (optional)'), dbIn));
    DC.modal({ title: 'Export for MySQL (.sql)', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Export', primary: true, onClick: async () => {
      if (!sel.size) { DC.toast('Pick at least one table.'); return false; }
      if (o.database && !/^[\w$]{1,64}$/.test(o.database)) { DC.toast('A database name can only use letters, numbers and _.'); return false; }
      const r = buildMysql({ ...o, tables: sel });
      const name = `${DC.ident(DC.project.name)}-${DC.todayIso()}.sql`;
      const what = `${plural(r.tables, 'table')} and ${plural(r.rows, 'record')}`;
      if (DC.inFrame) {
        setTimeout(() => DC.modal({ title: 'Your .sql file', wide: true, actions: [{ label: 'Close', primary: true }],
          body: [h('p', null, `Downloads are blocked in this viewer. Copy the text below into a file named ${name}.`), h('textarea', { class: 'input mono', rows: 14, readOnly: true }, r.text)] }), 0);
        return;
      }
      const path = await DC.store.writeExtra(DC.project.name, 'exports', name, r.text);
      DC.toast(path ? `Exported ${what} to ${path}` : `Downloaded ${name} (${what})`, 6000);
      if (r.notes.length) setTimeout(() => DC.modal({ title: 'Exported, with notes', actions: [{ label: 'OK', primary: true }], body: h('ul', { class: 'problems' }, r.notes.map((n) => h('li', null, n))) }), 0);
    } }] });
  }

  // =====================================================================
  // Reading .sql files (phpMyAdmin, mysqldump, DataCraft)
  // =====================================================================
  // Index just past the closing quote that matches the one at i.
  function endQuote(s, i) {
    const q = s[i];
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\' && q !== '`') { j++; continue; }
      if (s[j] === q) { if (s[j + 1] === q) { j++; continue; } return j + 1; }
    }
    return s.length;
  }
  // Splits a script into statements, leaving out comments and /*!...*/ version comments.
  function splitSql(src) {
    const out = [];
    const n = src.length;
    const delimRe = /\s*DELIMITER[ \t]+(\S+)[^\n]*/iy;
    let delim = ';', parts = [], start = 0, i = 0, empty = true;
    const flush = (to) => { if (to > start) parts.push(src.slice(start, to)); };
    while (i < n) {
      if (empty) { // DELIMITER lines (used around triggers and stored procedures)
        delimRe.lastIndex = i;
        const m = delimRe.exec(src);
        if (m) { delim = m[1]; i = start = delimRe.lastIndex; continue; }
      }
      const c = src[i], d = src[i + 1];
      if (c === "'" || c === '"' || c === '`') { i = endQuote(src, i); empty = false; continue; }
      if (c === '#' || (c === '-' && d === '-' && (i + 2 >= n || /\s/.test(src[i + 2])))) {
        flush(i); const j = src.indexOf('\n', i); i = start = j < 0 ? n : j + 1; parts.push(' '); continue;
      }
      if (c === '/' && d === '*') {
        flush(i); const j = src.indexOf('*/', i + 2); i = start = j < 0 ? n : j + 2; parts.push(' '); continue;
      }
      if (c === delim[0] && src.startsWith(delim, i)) {
        flush(i);
        const st = parts.join('').trim();
        if (st) out.push(st);
        parts = []; i = start = i + delim.length; empty = true; continue;
      }
      if (empty && !/\s/.test(c)) empty = false;
      i++;
    }
    flush(n);
    const last = parts.join('').trim();
    if (last) out.push(last);
    return out;
  }
  const unq = (x) => (x[0] === '`' ? x.slice(1, -1).replace(/``/g, '`') : x[0] === '"' ? x.slice(1, -1).replace(/""/g, '"') : x);
  const IDENT = /\s*(`(?:[^`]|``)*`|"(?:[^"]|"")*"|[\w$]+)/y;
  // Reads a name at pos; for db.table it keeps the table part.
  function readName(s, pos) {
    IDENT.lastIndex = pos;
    const m = IDENT.exec(s);
    if (!m) return null;
    let name = unq(m[1]);
    pos = IDENT.lastIndex;
    const dot = /\s*\.\s*/y;
    dot.lastIndex = pos;
    if (dot.exec(s)) { IDENT.lastIndex = dot.lastIndex; const m2 = IDENT.exec(s); if (m2) { name = unq(m2[1]); pos = IDENT.lastIndex; } }
    return { name, pos };
  }
  // Index of the bracket that closes the one at i.
  function closeParen(s, i) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === "'" || c === '"' || c === '`') { j = endQuote(s, j) - 1; continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return j;
    }
    return -1;
  }
  function inParens(s, from) {
    const o = s.indexOf('(', from);
    if (o < 0) return null;
    const c = closeParen(s, o);
    return c < 0 ? null : { inner: s.slice(o + 1, c), end: c + 1 };
  }
  // Splits at commas that are not inside brackets or quotes.
  function splitTop(s) {
    const out = [];
    let depth = 0, start = 0;
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (c === "'" || c === '"' || c === '`') { j = endQuote(s, j) - 1; continue; }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) { out.push(s.slice(start, j).trim()); start = j + 1; }
    }
    const last = s.slice(start).trim();
    if (last) out.push(last);
    return out;
  }
  const nameList = (s) => splitTop(s).map((x) => { const r = readName(x, 0); return r ? r.name : x; });
  // Reads a quoted string starting at i. Returns [text, next index].
  function readString(s, i) {
    const q = s[i];
    let out = '';
    for (let j = i + 1; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') { const e = s[++j] || ''; out += { 0: '\0', n: '\n', r: '\r', t: '\t', b: '\b', Z: '\x1a' }[e] ?? e; continue; }
      if (c === q) { if (s[j + 1] === q) { out += q; j++; continue; } return [out, j + 1]; }
      out += c;
    }
    return [out, s.length];
  }
  function hexText(hx) {
    const b = new Uint8Array(hx.length >> 1);
    for (let k = 0; k < b.length; k++) b[k] = parseInt(hx.substr(k * 2, 2), 16);
    return new TextDecoder().decode(b);
  }
  const LIT = /(NULL|TRUE|FALSE|0x[0-9a-f]*|x'[0-9a-f]*'|b'[01]*'|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(?![\w.(])/iy;
  const INTRO = /(?:_\w+|N)(?=')/y;
  // Reads one value in an INSERT. Returns [value, next index].
  function readValue(s, i) {
    INTRO.lastIndex = i;
    const im = INTRO.exec(s);
    if (im) i += im[0].length;
    if (s[i] === "'" || s[i] === '"') return readString(s, i);
    LIT.lastIndex = i;
    const m = LIT.exec(s);
    if (m) {
      const t = m[1], u = t.toUpperCase(), end = LIT.lastIndex;
      if (u === 'NULL') return [null, end];
      if (u === 'TRUE') return [1, end];
      if (u === 'FALSE') return [0, end];
      if (u.startsWith('0X')) return [hexText(t.slice(2)), end];
      if (u.startsWith("X'")) return [hexText(t.slice(2, -1)), end];
      if (u.startsWith("B'")) return [parseInt(t.slice(2, -1) || '0', 2), end];
      return [Number(t), end];
    }
    // Anything else, such as NOW() or CURRENT_TIMESTAMP, is left empty.
    let depth = 0, j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === "'" || c === '"') { j = endQuote(s, j) - 1; continue; }
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0) break;
    }
    return [null, j];
  }
  const COMMENT_RE = /\bCOMMENT\s*=?\s*('(?:[^'\\]|\\.|'')*')/i;
  function parseColumn(part) {
    const nm = readName(part, 0);
    if (!nm) return null;
    let rest = part.slice(nm.pos).trim();
    const tm = /^(\w+)/.exec(rest);
    if (!tm) return null;
    const c = { name: nm.name, base: tm[1].toLowerCase(), args: '', autoInc: false, pk: false, comment: '', gen: null, values: null };
    rest = rest.slice(tm[0].length);
    if (/^\s*\(/.test(rest)) { const p = inParens(rest, 0); if (p) { c.args = p.inner; rest = rest.slice(p.end); } }
    const flags = rest.replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
    c.autoInc = /\bAUTO_INCREMENT\b/i.test(flags);
    c.pk = /\bPRIMARY\s+KEY\b/i.test(flags);
    const cm = COMMENT_RE.exec(rest);
    if (cm) c.comment = readString(cm[1], 0)[0];
    const GEN = /\b(?:GENERATED\s+ALWAYS\s+)?AS\s*\(/i;
    const g = GEN.test(flags) && GEN.exec(rest);
    if (g) { const p = inParens(rest, g.index); if (p) c.gen = p.inner; }
    if (c.base === 'enum' || c.base === 'set') c.values = splitTop(c.args).map((v) => readString(v.trim(), 0)[0]);
    return c;
  }
  function parseFk(part) {
    const k = part.search(/FOREIGN\s+KEY/i);
    const a = inParens(part, k);
    const r = part.search(/\bREFERENCES\b/i);
    if (!a || r < 0) return null;
    const nm = readName(part, r + 10);
    if (!nm) return null;
    const b = inParens(part, nm.pos);
    return { cols: nameList(a.inner), table: nm.name, refCols: b ? nameList(b.inner) : [] };
  }
  const CONSTRAINT = '(?:CONSTRAINT\\s+(?:`(?:[^`]|``)*`|[\\w$]+)\\s+)?';
  function parseCreate(stmt) {
    const m = /^CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(stmt);
    const nm = m && readName(stmt, m[0].length);
    if (!nm) return null;
    const open = stmt.indexOf('(', nm.pos);
    const close = open < 0 ? -1 : closeParen(stmt, open);
    if (close < 0) return null;
    const t = { name: nm.name, cols: [], pk: [], fks: [], comment: '', rows: [] };
    splitTop(stmt.slice(open + 1, close)).forEach((part) => {
      if (new RegExp('^' + CONSTRAINT + 'PRIMARY\\s+KEY', 'i').test(part)) { const p = inParens(part, part.search(/KEY/i)); if (p) t.pk = nameList(p.inner); }
      else if (new RegExp('^' + CONSTRAINT + 'FOREIGN\\s+KEY', 'i').test(part)) { const fk = parseFk(part); if (fk) t.fks.push(fk); }
      else if (/^(?:UNIQUE|KEY|INDEX|FULLTEXT|SPATIAL|CONSTRAINT|CHECK|PERIOD)\b/i.test(part)) { /* indexes and checks are not needed */ }
      else { const c = parseColumn(part); if (c) { t.cols.push(c); if (c.pk) t.pk = [c.name]; } }
    });
    const cm = COMMENT_RE.exec(stmt.slice(close + 1));
    if (cm) t.comment = readString(cm[1], 0)[0];
    return t;
  }
  // phpMyAdmin adds keys and AUTO_INCREMENT afterwards with ALTER TABLE.
  function parseAlter(stmt, tables) {
    const m = /^ALTER\s+(?:ONLINE\s+|IGNORE\s+)*TABLE\s+/i.exec(stmt);
    const nm = m && readName(stmt, m[0].length);
    const t = nm && tables.get(nm.name.toLowerCase());
    if (!t) return;
    splitTop(stmt.slice(nm.pos)).forEach((part) => {
      let mm;
      if (new RegExp('^ADD\\s+' + CONSTRAINT + 'PRIMARY\\s+KEY', 'i').test(part)) { const p = inParens(part, part.search(/KEY/i)); if (p) t.pk = nameList(p.inner); }
      else if (new RegExp('^ADD\\s+' + CONSTRAINT + 'FOREIGN\\s+KEY', 'i').test(part)) { const fk = parseFk(part); if (fk) t.fks.push(fk); }
      else if ((mm = /^(MODIFY|CHANGE)\s+(?:COLUMN\s+)?/i.exec(part))) {
        let def = part.slice(mm[0].length), target = null;
        if (/^CHANGE/i.test(mm[1])) { const old = readName(def, 0); if (!old) return; target = old.name; def = def.slice(old.pos); }
        const c = parseColumn(def.trim());
        if (!c) return;
        const i = t.cols.findIndex((x) => x.name.toLowerCase() === (target || c.name).toLowerCase());
        if (i >= 0) t.cols[i] = { ...c, comment: c.comment || t.cols[i].comment };
        if (c.pk) t.pk = [c.name];
      } else if ((mm = /^ADD\s+(?:COLUMN\s+)?/i.exec(part)) && !/^ADD\s+(?:UNIQUE|KEY|INDEX|FULLTEXT|SPATIAL|CONSTRAINT|CHECK|PRIMARY|FOREIGN)\b/i.test(part)) {
        const c = parseColumn(part.slice(mm[0].length));
        if (c) t.cols.push(c);
      }
    });
  }
  function parseInsert(stmt, tables) {
    const m = /^(?:INSERT|REPLACE)\s+(?:LOW_PRIORITY\s+|DELAYED\s+|HIGH_PRIORITY\s+)?(?:IGNORE\s+)?(?:INTO\s+)?/i.exec(stmt);
    const nm = m && readName(stmt, m[0].length);
    const t = nm && tables.get(nm.name.toLowerCase());
    if (!t) return;
    let pos = nm.pos;
    const ws = () => { while (pos < stmt.length && /\s/.test(stmt[pos])) pos++; };
    ws();
    let cols = null;
    if (stmt[pos] === '(') { const c = closeParen(stmt, pos); if (c < 0) return; cols = nameList(stmt.slice(pos + 1, c)); pos = c + 1; ws(); }
    const vm = /VALUES?\b/iy;
    vm.lastIndex = pos;
    if (!vm.exec(stmt)) return;
    pos = vm.lastIndex;
    const names = (cols || t.cols.map((c) => c.name)).map((x) => x.toLowerCase());
    while (pos < stmt.length) {
      ws();
      if (stmt[pos] !== '(') break;
      pos++;
      const row = [];
      for (;;) {
        ws();
        const [v, next] = readValue(stmt, pos);
        row.push(v); pos = next; ws();
        if (stmt[pos] === ',') { pos++; continue; }
        if (stmt[pos] === ')') { pos++; break; }
        return; // not something DataCraft understands
      }
      const rec = {};
      names.forEach((k, i) => { rec[k] = row[i]; });
      t.rows.push(rec);
      ws();
      if (stmt[pos] === ',') pos++; else break;
    }
  }
  function parseDump(text) {
    const tables = new Map(), skipped = {};
    splitSql(text.replace(/^\uFEFF/, '')).forEach((st) => {
      const kw = (/^\w+(?:\s+\w+)?/.exec(st) || [''])[0].toUpperCase().replace(/\s+/g, ' ');
      if (/^CREATE (TEMPORARY|TABLE)/.test(kw)) { const t = parseCreate(st); if (t) tables.set(t.name.toLowerCase(), t); }
      else if (/^(INSERT|REPLACE)\b/.test(kw)) parseInsert(st, tables);
      else if (/^ALTER (ONLINE|IGNORE|TABLE)/.test(kw)) parseAlter(st, tables);
      else if (/^CREATE /.test(kw)) {
        const what = (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?(?:UNIQUE\s+)?(VIEW|TRIGGER|PROCEDURE|FUNCTION|EVENT|INDEX)/i.exec(st) || [])[1];
        if (what) skipped[what.toLowerCase()] = (skipped[what.toLowerCase()] || 0) + 1;
      }
    });
    return { tables: [...tables.values()], skipped };
  }

  // ---------- Turning MySQL tables into DataCraft tables ----------
  const INTS = ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'serial', 'int1', 'int2', 'int3', 'int4', 'int8'];
  const BINARY = ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection'];
  const AFFINITY = { text: 'TEXT', longtext: 'TEXT', category: 'TEXT', number: 'REAL', currency: 'REAL', date: 'TEXT', yesno: 'INTEGER', link: 'INTEGER' };
  function dcType(c) {
    const b = c.base, a = c.args.replace(/\s/g, '');
    if (b === 'bool' || b === 'boolean' || (b === 'tinyint' && a === '1') || (b === 'bit' && (a === '' || a === '1'))) return 'yesno';
    if (INTS.includes(b) || b === 'bit') return 'number';
    if (['decimal', 'numeric', 'dec', 'fixed'].includes(b)) return /,2$/.test(a) ? 'currency' : 'number';
    if (['float', 'double', 'real'].includes(b)) return 'number';
    if (b === 'date') return 'date';
    if (['text', 'mediumtext', 'longtext', 'json'].includes(b)) return 'longtext';
    if (b === 'enum') return 'category';
    if (BINARY.includes(b)) return null;
    return 'text'; // char, varchar, tinytext, datetime, timestamp, time, year, set ...
  }
  // A comment like "Customer type {dc:category=customer_type}" gives the label and DataCraft's own field type.
  function marker(comment) {
    const m = /\s*\{dc:(\w+)(?:=([^}]*))?\}/.exec(comment || '');
    const text = (m ? comment.replace(m[0], '') : comment || '').trim();
    return { label: text && text.length <= 48 && !/[\r\n]/.test(text) ? text : '', kind: m ? m[1] : '', arg: m ? m[2] || '' : '' };
  }
  // A MySQL generated column becomes a calculated field when it only uses + - * / ( ), numbers and columns.
  function genToFormula(expr, labelOf) {
    let s = expr;
    for (let k = 0; k < 20; k++) {
      const n = s.replace(/\b(?:IFNULL|COALESCE|NULLIF)\s*\(((?:[^()]|\([^()]*\))*?)\s*,\s*0\s*\)/gi, '($1)');
      if (n === s) break;
      s = n;
    }
    const re = /\s*(?:(\d+(?:\.\d+)?)|(`(?:[^`]|``)*`|[A-Za-z_][\w$]*)|([-+*/()]))/y;
    s = s.trim();
    let pos = 0, out = '';
    while (pos < s.length) {
      re.lastIndex = pos;
      const m = re.exec(s);
      if (!m) return null;
      pos = re.lastIndex;
      if (m[1]) out += m[1];
      else if (m[2]) { const l = labelOf(unq(m[2]).toLowerCase()); if (!l) return null; out += `[${l}]`; }
      else out += ` ${m[3]} `;
      while (pos < s.length && /\s/.test(s[pos])) pos++;
    }
    out = out.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/\((\[[^\]]+\]|\d+(?:\.\d+)?)\)/g, '$1').trim();
    try { DC.compileFormula(out); return out; } catch (e) { return null; }
  }
  const SAFE_NAME = /^[A-Za-z_][\w$]*$/;
  const RESERVED = /^(rowid|oid|_rowid_|_rid)$/i;

  // dump: from parseDump. o: { tables: Set(lower-case names), data }
  function importDump(dump, o) {
    const warnings = [], made = [];
    const byLower = new Map(dump.tables.map((t) => [t.name.toLowerCase(), t]));
    const catT = byLower.get(CATEGORY_TABLE);
    const chosen = dump.tables.filter((t) => t !== catT && o.tables.has(t.name.toLowerCase()));
    const keyOf = (t) => {
      const pk = t.pk.length === 1 && t.cols.find((c) => c.name.toLowerCase() === t.pk[0].toLowerCase());
      if (pk) return INTS.includes(pk.base) ? pk : null;
      return t.pk.length ? null : t.cols.find((c) => c.autoInc && INTS.includes(c.base)) || null;
    };
    const taken = db.q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    const tblName = new Map();
    chosen.forEach((t) => {
      const n = DC.uniq(SAFE_NAME.test(t.name) && !/^(_dc|sqlite)/i.test(t.name) ? t.name : DC.ident(t.name), taken);
      taken.push(n);
      tblName.set(t.name.toLowerCase(), n);
    });

    db.run('BEGIN');
    try {
      // Category lists saved by DataCraft
      const listName = new Map();
      const makeList = (label, items) => {
        const ex = DC.project.schema.lists.find((l) => l.label.toLowerCase() === label.toLowerCase());
        if (ex) { db.setListItems(ex.name, [...ex.items, ...items]); return ex.name; }
        return db.createList(label, items);
      };
      if (catT) {
        const lists = new Map();
        catT.rows.forEach((r) => {
          if (r.list == null) return;
          if (!lists.has(r.list)) lists.set(r.list, { label: String(r.label || r.list), items: [] });
          if (r.value != null && r.value !== '') lists.get(r.list).items.push([+r.ord || 0, String(r.value)]);
        });
        lists.forEach((l, k) => listName.set(k, makeList(l.label, l.items.sort((a, b) => a[0] - b[0]).map((x) => x[1]))));
      }

      chosen.forEach((t) => {
        const name = tblName.get(t.name.toLowerCase());
        const key = keyOf(t);
        const used = new Set(key ? [key.name.toLowerCase()] : []);
        const fields = [];
        t.cols.forEach((c) => {
          if (c === key) return;
          const mk = marker(c.comment);
          let type = c.gen != null ? 'formula' : dcType(c);
          if (type === null) { warnings.push(`${t.name}.${c.name}: ${c.base.toUpperCase()} columns hold binary data, so it was left out.`); return; }
          const opts = {};
          // Links: from a foreign key, or from DataCraft's own marker
          const fk = t.fks.find((x) => x.cols.length === 1 && x.cols[0].toLowerCase() === c.name.toLowerCase());
          const target = mk.kind === 'link' ? mk.arg : fk ? fk.table : null;
          if (target && type !== 'formula') {
            const tt = byLower.get(String(target).toLowerCase());
            const tk = tt && keyOf(tt);
            if (tt && tblName.has(tt.name.toLowerCase()) && tk && (!fk || mk.kind === 'link' || !fk.refCols.length || fk.refCols[0].toLowerCase() === tk.name.toLowerCase())) { type = 'link'; opts.link = tblName.get(tt.name.toLowerCase()); }
            else if (!tt && db.table(target)) { type = 'link'; opts.link = target; }
            else if (type === 'link') type = 'number';
          }
          if (type === 'number' && INTS.includes(c.base)) opts.decimals = '0';
          if (mk.kind === 'category' && type !== 'formula') { type = 'category'; if (listName.has(mk.arg)) opts.list = listName.get(mk.arg); }
          if (type === 'category' && !opts.list && c.values) opts.list = makeList(mk.label || labelize(c.name), c.values);
          let fname = SAFE_NAME.test(c.name) && !RESERVED.test(c.name) && !/^_dc/i.test(c.name) ? c.name : DC.ident(c.name);
          fname = DC.uniq(fname, used);
          used.add(fname.toLowerCase());
          const label = mk.label || (type === 'link' ? labelize(c.name.replace(/_?id$/i, '')) || labelize(c.name) : labelize(c.name));
          fields.push({ col: c, src: c.name.toLowerCase(), name: fname, label, type, opts });
        });
        // Category lists that still need their choices: take them from the records.
        fields.filter((f) => f.type === 'category' && !f.opts.list).forEach((f) => {
          const vals = [...new Set(t.rows.map((r) => r[f.src]).filter((v) => v != null && v !== '').map(String))].sort((a, b) => a.localeCompare(b));
          f.opts.list = makeList(f.label, vals);
        });
        // Calculated fields
        const labelOf = (lower) => { const f = fields.find((x) => x.src === lower); return f ? f.label : null; };
        for (const f of fields.filter((x) => x.type === 'formula')) {
          const formula = genToFormula(f.col.gen, labelOf);
          if (formula) { f.opts.formula = formula; if (/,2$/.test(f.col.args.replace(/\s/g, ''))) f.opts.currency = true; }
          else { warnings.push(`${t.name}.${f.col.name}: the calculation “${f.col.gen.trim()}” is too complex for DataCraft, so it was left out.`); fields.splice(fields.indexOf(f), 1); }
        }
        const stored = fields.filter((f) => f.type !== 'formula');
        const keyName = key ? (SAFE_NAME.test(key.name) && !RESERVED.test(key.name) ? key.name : DC.ident(key.name)) : null;
        const defs = [];
        if (keyName) defs.push(`${qi(keyName)} INTEGER PRIMARY KEY AUTOINCREMENT`);
        stored.forEach((f) => defs.push(`${qi(f.name)} ${AFFINITY[f.type] || 'TEXT'}`));
        if (!defs.length) defs.push('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
        db.run(`CREATE TABLE ${qi(name)} (${defs.join(', ')})`);
        const tm = marker(t.comment);
        const display = tm.kind === 'display' ? (fields.find((f) => f.src === tm.arg.toLowerCase()) || {}).name || null : null;
        const ord = (db.one('SELECT MAX(ord) AS m FROM _dc_tables').m || 0) + 1;
        db.run('INSERT INTO _dc_tables (name, label, ord, display) VALUES (?, ?, ?, ?)', [name, tm.label || labelize(t.name), ord, display]);
        fields.forEach((f, i) => db.run('INSERT INTO _dc_fields (tbl, name, label, type, ord, opts) VALUES (?, ?, ?, ?, ?, ?)', [name, f.name, f.label, f.type, i, JSON.stringify(f.opts)]));
        // Records
        let rows = 0;
        if (o.data && t.rows.length && (keyName || stored.length)) {
          const cols = [...(keyName ? [keyName] : []), ...stored.map((f) => f.name)];
          const st = DC.project.db.prepare(`INSERT INTO ${qi(name)} (${cols.map(qi).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
          try {
            t.rows.forEach((r) => {
              const vals = [];
              if (keyName) { const v = r[key.name.toLowerCase()]; vals.push(v == null || v === '' || !isFinite(+v) ? null : +v); }
              stored.forEach((f) => vals.push(toValue(f, r[f.src])));
              st.run(vals);
              rows++;
            });
          } finally { st.free(); }
        }
        made.push({ name, label: tm.label || labelize(t.name), rows });
      });
      db.run('COMMIT');
    } catch (e) {
      try { db.run('ROLLBACK'); } catch (e2) { /* already rolled back */ }
      DC.loadSchema();
      throw e;
    }
    DC.loadSchema();
    DC.changed();
    return { made, warnings };
  }
  function toValue(f, v) {
    if (v == null || v === '') return null;
    switch (f.type) {
      case 'date': { const d = DC.parseDate(String(v)); return d && !d.startsWith('0000') ? d : null; }
      case 'text': case 'longtext': case 'category': return String(v);
      default: return db.normalize(f, v);
    }
  }

  async function readSqlFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder('utf-8').decode(bytes);
    return text.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : text;
  }

  function importMysqlDialog() {
    const body = h('div', { class: 'stack' });
    const m = DC.modal({ title: 'Import a MySQL .sql file', body, wide: true });
    const st = { dump: null, fileName: '', sel: new Set(), data: true, target: DC.project ? 'this' : 'new', newName: '' };
    const put = (...items) => body.append(...items.flat(Infinity).filter((x) => x != null && x !== false));
    const actions = (...btns) => h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('span', { class: 'spacer' }), ...btns);

    function step1(msg) {
      body.textContent = '';
      const fileIn = h('input', { type: 'file', accept: '.sql,.txt', hidden: true, onchange: () => fileIn.files[0] && load(fileIn.files[0]) });
      const drop = h('div', { class: 'drop', tabIndex: 0, role: 'button', onclick: () => fileIn.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') fileIn.click(); } },
        h('b', null, 'Choose a .sql file'), h('span', { class: 'muted' }, 'or drop it here'));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) load(f); });
      put(
        h('p', null, 'Reads the tables and records from a .sql file made by phpMyAdmin (Export › SQL), mysqldump, or DataCraft. Views, triggers and stored procedures are skipped.'),
        msg ? h('p', { class: 'error' }, msg) : null, fileIn, drop, actions());
    }
    async function load(file) {
      body.textContent = '';
      put(h('p', { class: 'muted' }, `Reading ${file.name}…`));
      await new Promise((r) => setTimeout(r, 30));
      try { st.dump = parseDump(await readSqlFile(file)); } catch (e) { step1('Could not read that file: ' + e.message); return; }
      st.fileName = file.name;
      st.newName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/[\\/:*?"<>|]/g, '').trim() || 'Imported';
      const tables = st.dump.tables.filter((t) => t.name.toLowerCase() !== CATEGORY_TABLE);
      if (!tables.length) { step1(`No tables were found in ${file.name}. Export it again with the structure (CREATE TABLE) included.`); return; }
      st.sel = new Set(tables.map((t) => t.name.toLowerCase()));
      step2();
    }
    function step2() {
      body.textContent = '';
      const d = st.dump;
      const tables = d.tables.filter((t) => t.name.toLowerCase() !== CATEGORY_TABLE);
      const hasLists = d.tables.length !== tables.length;
      const grid = h('div', { class: 'grid-wrap preview' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Table'), h('th', { class: 'num' }, 'Columns'), h('th', { class: 'num' }, 'Records'), h('th', null, 'Links to'))),
        h('tbody', null, tables.map((t) => h('tr', null,
          h('td', null, h('input', { type: 'checkbox', checked: st.sel.has(t.name.toLowerCase()), 'aria-label': 'Import ' + t.name, onchange: (e) => { if (e.target.checked) st.sel.add(t.name.toLowerCase()); else st.sel.delete(t.name.toLowerCase()); } })),
          h('td', null, h('b', null, t.name), t.comment && marker(t.comment).label ? h('span', { class: 'muted small' }, ' ' + marker(t.comment).label) : null),
          h('td', { class: 'num' }, t.cols.length),
          h('td', { class: 'num' }, t.rows.length),
          h('td', { class: 'muted small' }, [...new Set(t.fks.map((f) => f.table))].join(', ') || '—'))))));
      const skipped = Object.entries(d.skipped).map(([k, n]) => plural(n, k)).join(', ');
      const nameIn = h('input', { class: 'input', value: st.newName, oninput: () => { st.newName = nameIn.value; } });
      put(
        h('p', null, h('b', null, st.fileName), ` · ${plural(tables.length, 'table')}`, hasLists ? ' and DataCraft category lists' : '', skipped ? ` · skipped: ${skipped}` : ''),
        grid,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.data, onchange: (e) => { st.data = e.target.checked; } }), ' Include the records (untick for the tables only)'),
        DC.project ? h('div', { class: 'seg', role: 'radiogroup' },
          h('button', { class: 'btn', 'aria-pressed': String(st.target === 'this'), onclick: () => { st.target = 'this'; step2(); } }, `Add to “${DC.project.name}”`),
          h('button', { class: 'btn', 'aria-pressed': String(st.target === 'new'), onclick: () => { st.target = 'new'; step2(); } }, 'Make a new project')) : null,
        st.target === 'new' ? h('label', { class: 'field narrow' }, h('span', null, 'New project name'), nameIn) : null,
        actions(h('button', { class: 'btn', onclick: () => step1() }, '‹ Back'), h('button', { class: 'btn primary', onclick: run }, 'Import')));
    }
    async function run() {
      if (!st.sel.size) { DC.toast('Pick at least one table.'); return; }
      if (st.target === 'new') {
        const err = await DC.checkProjectName(st.newName);
        if (err) { DC.toast(err); return; }
        await DC.newEmptyProject(st.newName.trim());
      }
      let r;
      try { r = importDump(st.dump, { tables: st.sel, data: st.data }); } catch (e) { DC.toast('Import stopped: ' + e.message, 6000); return; }
      await DC.saveProject();
      DC.go({ view: 'home-project' });
      step3(r);
    }
    function step3(r) {
      body.textContent = '';
      const total = r.made.reduce((n, t) => n + t.rows, 0);
      put(
        h('p', { class: 'big' }, `Imported ${plural(r.made.length, 'table')} and ${plural(total, 'record')}.`),
        h('ul', { class: 'problems' }, r.made.map((t) => h('li', null, `${t.label} – ${plural(t.rows, 'record')}`))),
        r.warnings.length ? [h('p', null, 'Some columns were left out:'), h('ul', { class: 'problems' }, r.warnings.slice(0, 12).map((w) => h('li', null, w)))] : null,
        h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }),
          h('button', { class: 'btn', onclick: () => m.close() }, 'Close'),
          r.made[0] ? h('button', { class: 'btn primary', onclick: () => { m.close(); DC.go({ view: 'table', id: r.made[0].name }); } }, `Open ${r.made[0].label}`) : null));
    }
    step1();
  }

  // =====================================================================
  // SQL console
  // =====================================================================
  function sqlConsole() {
    if (!DC.project) return;
    const P = DC.project;
    const ta = h('textarea', { class: 'input mono', rows: 6, spellcheck: false, 'aria-label': 'SQL', placeholder: 'SELECT * FROM customers LIMIT 20' });
    const out = h('div', { class: 'stack' });
    const scalar = (sql) => { const r = P.db.exec(sql)[0]; return r ? r.values[0][0] : null; };
    function run() {
      const sql = ta.value.trim();
      if (!sql) return;
      out.textContent = '';
      const before = [scalar('SELECT total_changes()'), scalar('PRAGMA schema_version')];
      let res;
      try { res = P.db.exec(sql); } catch (e) { out.append(h('p', { class: 'error' }, e.message)); return; }
      const rowsChanged = scalar('SELECT total_changes()') - before[0];
      const changed = rowsChanged > 0 || scalar('PRAGMA schema_version') !== before[1];
      if (changed) { db.sync(); DC.loadSchema(); DC.changed(); DC.renderSidebar(); }
      res.forEach((r) => out.append(
        h('span', { class: 'label' }, `${plural(r.values.length, 'row')}${r.values.length > 500 ? ' (showing the first 500)' : ''}`),
        h('div', { class: 'grid-wrap preview' }, h('table', { class: 'grid' },
          h('thead', null, h('tr', null, r.columns.map((c) => h('th', null, c)))),
          h('tbody', null, r.values.slice(0, 500).map((row) => h('tr', null, row.map((v) => h('td', null, v == null ? h('span', { class: 'muted' }, 'NULL') : v instanceof Uint8Array ? `(${v.length} bytes)` : String(v))))))))));
      if (!res.length) out.append(h('p', null, changed ? `Done. ${plural(rowsChanged, 'row')} changed; saved.` : 'Done.'));
    }
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
    const picks = h('div', { class: 'checks' }, P.schema.tables.map((t) => h('button', { class: 'btn ghost xs', type: 'button', onclick: () => { ta.value = `SELECT * FROM ${qi(t.name)} LIMIT 100`; ta.focus(); } }, t.name)));
    const m = DC.modal({ title: 'SQL console', wide: true, body: [
      h('p', { class: 'muted' }, 'Runs SQLite commands on this project. Changes are saved straight away, so use File › Save a copy (.db) first if you are unsure. Ctrl+Enter runs.'),
      picks, ta,
      h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Close'), h('button', { class: 'btn primary', type: 'button', onclick: run }, 'Run')),
      out] });
    m.el.classList.add('xl');
  }

  Object.assign(DC, { exportMysqlDialog, importMysqlDialog, sqlConsole, _mysql: { buildMysql, parseDump, importDump, splitSql, formulaSql, genToFormula } });
})(window.DC);
