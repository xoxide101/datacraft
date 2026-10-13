/* DataCraft — PHP site generator: writes a small admin website (PDO, logins, CSRF) into php\sites\<name>. */
(function (DC) {
  'use strict';
  const { h } = DC;

  const CURRENCY = { USD: '$', CAD: '$', AUD: '$', NZD: '$', MXN: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', CHF: 'CHF ', ZAR: 'R' };
  const DATES = { 'MM/DD/YYYY': 'm/d/Y', 'DD/MM/YYYY': 'd/m/Y', 'DD.MM.YYYY': 'd.m.Y', 'YYYY-MM-DD': 'Y-m-d', long: 'F j, Y' };
  // Files that belong to the person once made: never replaced when the site is generated again.
  const KEEP = new Set(['config.php', 'assets/custom.css']);

  // ---------- PHP literals ----------
  const ps = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  function phpVal(v, ind = '') {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return ps(v);
    const inner = ind + '    ';
    if (Array.isArray(v)) return v.length ? '[' + v.map((x) => phpVal(x, inner)).join(', ') + ']' : '[]';
    const ents = Object.entries(v);
    if (!ents.length) return '[]';
    return '[\n' + ents.map(([k, x]) => `${inner}${ps(k)} => ${phpVal(x, inner)},`).join('\n') + '\n' + ind + ']';
  }
  function randomKey(n = 12) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  // ---------- What the site knows about the tables (inc/schema.php) ----------
  function siteSchema(o) {
    const S = DC.project.schema, M = DC._mysql, set = DC.project.settings;
    const tables = {};
    S.tables.filter((t) => o.tables.has(t.name)).forEach((t) => {
      const key = M.keyColumn(t.name);
      const fields = {};
      t.fields.forEach((f) => {
        const d = { label: f.label, type: f.type };
        if (f.type === 'formula') {
          try { M.formulaSql(t, f.opts.formula, new Set([f.name])); } catch (e) { return; } // left out of the .sql file too
          if (f.opts.currency) d.money = true;
        } else if (['text', 'longtext', 'category'].includes(f.type)) {
          const ty = M.myType(f, M.colStats(t.name, f.name));
          d.max = ty.startsWith('VARCHAR') ? 255 : ty === 'TEXT' ? 16000 : 4000000; // characters; TEXT holds 64 KB
        }
        if (f.type === 'category') d.list = f.opts.list || '';
        if (f.type === 'link') { if (f.opts.link && o.tables.has(f.opts.link)) d.link = f.opts.link; else d.type = 'number'; }
        fields[f.name] = d;
      });
      const disp = t.displayField && fields[t.displayField.name] ? t.displayField.name : key;
      const columns = Object.keys(fields).filter((n) => fields[n].type !== 'longtext').slice(0, 7);
      tables[t.name] = { label: t.label, key, display: disp, fields, columns };
    });
    return { title: o.title, currency: CURRENCY[set.currency] || '$', date_format: DATES[set.dateFormat] || 'm/d/Y', tables };
  }

  const USERS_SQL = `CREATE TABLE IF NOT EXISTS dc_users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(60) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  failed INT NOT NULL DEFAULT 0,
  locked_until INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

  // ---------- The files ----------
  function buildSite(o) {
    const schema = siteSchema(o);
    const sql = DC._mysql.buildMysql({ tables: o.tables, data: o.data, drop: true, lists: true, formulas: true, foreignKeys: false, database: '' });
    const sqlText = sql.text.replace(/SET FOREIGN_KEY_CHECKS = 1;\n$/, `-- User accounts for the PHP site. Never dropped, so importing this file again keeps them.\n${USERS_SQL};\n\nSET FOREIGN_KEY_CHECKS = 1;\n`);
    const stamp = `Made by DataCraft on ${new Date().toLocaleString()}`;
    const files = {
      'config.php': CONFIG_PHP(o),
      'inc/schema.php': `<?php\n// ${stamp}. Rebuilt each time the site is generated.\nreturn ${phpVal(schema)};\n`,
      'inc/app.php': APP_PHP,
      'index.php': INDEX_PHP,
      'list.php': LIST_PHP,
      'edit.php': EDIT_PHP,
      'login.php': LOGIN_PHP,
      'logout.php': LOGOUT_PHP,
      'users.php': USERS_PHP,
      'assets/style.css': STYLE_CSS,
      'assets/custom.css': '/* Your own style changes go here. DataCraft never replaces this file. */\n',
      '.htaccess': HTACCESS,
      'inc/.htaccess': DENY_ALL,
      'README.txt': README(o, stamp),
    };
    // The database file sits next to the site folder, not in it: it is imported with phpMyAdmin, never uploaded.
    return { files, sqlName: `${o.site}-database.sql`, sql: sqlText, notes: sql.notes, rows: sql.rows };
  }

  // ---------- Writing ----------
  async function sitesDir() {
    const php = await DC.store.root.getDirectoryHandle('php', { create: true });
    return php.getDirectoryHandle('sites', { create: true });
  }
  async function configExists(site) {
    if (DC.store.mode !== 'folder' || DC.store.needsPermission) return false;
    try { await (await (await sitesDir()).getDirectoryHandle(site)).getFileHandle('config.php'); return true; } catch (e) { return false; }
  }
  async function writeSite(site, files, sqlName, sql) {
    const sites = await sitesDir();
    const dir = await sites.getDirectoryHandle(site, { create: true });
    const written = [], kept = [];
    for (const [path, text] of Object.entries(files)) {
      const parts = path.split('/');
      let d = dir;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const name = parts[parts.length - 1];
      if (KEEP.has(path)) {
        try { await d.getFileHandle(name); kept.push(path); continue; } catch (e) { /* not made yet */ }
      }
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
      written.push(path);
    }
    const w = await (await sites.getFileHandle(sqlName, { create: true })).createWritable();
    await w.write(sql);
    await w.close();
    return { written, kept, where: `${DC.store.root.name}\\php\\sites\\${site}` };
  }

  // A plain (stored) .zip, for browsers that cannot write into folders.
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let offset = 0;
    for (const [path, text] of Object.entries(files)) {
      const name = enc.encode(path), data = enc.encode(text), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((n, b) => n + b.length, 0), count = Object.keys(files).length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, count, true); end.setUint16(10, count, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // ---------- Dialog ----------
  async function generateDialog() {
    if (!DC.project) return;
    const S = DC.project.schema;
    if (!S.tables.length) { DC.toast('There are no tables to put on a site yet.'); return; }
    const o = { site: DC.ident(DC.project.name).replace(/_/g, '-'), title: DC.project.name, tables: new Set(S.tables.map((t) => t.name)), data: true,
      host: 'localhost', dbname: DC.ident(DC.project.name), user: '', pass: '' };
    const body = h('div', { class: 'stack' });
    const m = DC.modal({ title: 'Make a PHP website', body, wide: true });
    const folderMode = DC.store.mode === 'folder' && !DC.store.needsPermission && !DC.inFrame;
    const input = (key, attrs = {}) => { const i = h('input', { class: 'input', value: o[key], ...attrs }); i.oninput = () => { o[key] = i.value; }; return i; };
    let hasConfig = false;
    const put = (...items) => body.append(...items.flat(Infinity).filter((x) => x != null && x !== false));

    async function render() {
      hasConfig = await configExists(o.site.trim());
      body.textContent = '';
      const siteIn = input('site', { 'aria-label': 'Site folder' });
      siteIn.onchange = render;
      const dbFields = h('div', { class: 'opts' },
        h('label', { class: 'field' }, h('span', null, 'Database server'), input('host')),
        h('label', { class: 'field' }, h('span', null, 'Database name'), input('dbname')),
        h('label', { class: 'field' }, h('span', null, 'Database user'), input('user', { autocomplete: 'off' })),
        h('label', { class: 'field' }, h('span', null, 'Database password'), input('pass', { type: 'password', autocomplete: 'new-password' })));
      put(
        h('p', { class: 'muted' }, 'Makes a small website for your web host: log in, then list, search, add, edit and delete records. It uses PHP and a MySQL database.'),
        h('div', { class: 'opts' },
          h('label', { class: 'field' }, h('span', null, folderMode ? 'Folder (in php\\sites)' : 'Folder name in the .zip'), siteIn),
          h('label', { class: 'field' }, h('span', null, 'Site title'), input('title'))),
        h('div', null, h('span', { class: 'label' }, 'Tables on the site'), h('div', { class: 'checks' }, S.tables.map((t) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: o.tables.has(t.name), onchange: (e) => { if (e.target.checked) o.tables.add(t.name); else o.tables.delete(t.name); } }), ' ', t.label)))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.data, onchange: (e) => { o.data = e.target.checked; } }), ' Put the current records in the .sql file (untick for empty tables)'),
        hasConfig
          ? h('p', { class: 'muted' }, 'This site already has a config.php with your database settings. It is kept as it is; everything else is made again.')
          : [h('span', { class: 'label' }, 'Database on the web host (goes into config.php; you can change it there later)'), dbFields],
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('span', { class: 'spacer' }),
          h('button', { class: 'btn primary', onclick: run }, folderMode ? 'Make the site' : 'Download the site (.zip)')));
    }
    async function run() {
      o.site = o.site.trim();
      if (!/^[A-Za-z0-9][\w.-]{0,63}$/.test(o.site)) { DC.toast('Use letters, numbers, - or _ for the folder name.'); return; }
      if (!o.tables.size) { DC.toast('Pick at least one table.'); return; }
      if (!o.title.trim()) o.title = DC.project.name;
      o.setupKey = randomKey();
      const { files, notes, sqlName, sql } = buildSite(o);
      let result;
      try {
        if (folderMode) result = await writeSite(o.site, files, sqlName, sql);
        else {
          const zipped = { [sqlName]: sql };
          Object.entries(files).forEach(([p, t]) => { zipped[`${o.site}/${p}`] = t; });
          DC.download(`${o.site}-php-site.zip`, zip(zipped));
          result = { written: Object.keys(files), kept: [], where: `${o.site}-php-site.zip` };
        }
      } catch (e) { DC.toast('Could not write the site: ' + e.message, 6000); return; }
      done(result, notes);
    }
    function done(r, notes) {
      body.textContent = '';
      const newConfig = !r.kept.includes('config.php');
      put(
        h('p', { class: 'big' }, DC.store.mode === 'folder' ? `Made the site in ${r.where}` : `Downloaded ${r.where}`),
        r.kept.length ? h('p', { class: 'muted' }, `Kept your own ${r.kept.join(' and ')}.`) : null,
        newConfig ? h('div', { class: 'card' }, h('b', null, 'Setup key: '), h('code', null, o.setupKey),
          h('p', { class: 'muted small' }, 'You need it once, on the login page, to make the first user. It is also written in config.php.')) : null,
        h('h3', null, 'Put it online'),
        h('ol', null,
          h('li', null, 'Make a MySQL database and user on your web host.'),
          h('li', null, `In phpMyAdmin, pick the database, then Import › ${o.site}-database.sql. It is next to the ${o.site} folder; do not upload it, it holds your records.`),
          h('li', null, 'Check the database settings in config.php.'),
          h('li', null, `Upload the ${o.site} folder to the web host, then open it in a browser and log in.`)),
        h('p', { class: 'muted small' }, `README.txt in the folder has the details. Importing ${o.site}-database.sql again replaces those tables and their records (user accounts are kept).`),
        notes.length ? h('ul', { class: 'problems' }, notes.map((n) => h('li', null, n))) : null,
        h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => m.close() }, 'Done')));
    }
    render();
  }

  // =====================================================================
  // File templates. PHP 7.4+; no backticks here (they would end the JS strings), so SQL names go through q().
  // =====================================================================
  const CONFIG_PHP = (o) => `<?php
// Settings for this site. DataCraft writes this file only the first time and never replaces it,
// so your database password and setup key stay as you set them.
return [
    'db' => [
        'host' => ${ps(o.host || 'localhost')},
        'port' => 3306,
        'name' => ${ps(o.dbname || '')},
        'user' => ${ps(o.user || '')},
        'pass' => ${ps(o.pass || '')},
    ],
    // Needed once, on the login page, to make the first user account. You can change it.
    'setup_key' => ${ps(o.setupKey)},
    // Site title shown at the top. Leave empty to use the one from DataCraft.
    'title' => '',
    // true shows error details. Only while testing.
    'debug' => false,
];
`;

  const APP_PHP = String.raw`<?php
// Shared code for every page. Made by DataCraft and replaced each time the site is generated;
// your settings live in ../config.php.

if (!is_file(__DIR__ . '/../config.php')) {
    http_response_code(500);
    exit('config.php is missing. Generate the site again in DataCraft, or copy config.php from a backup.');
}
$CONFIG = require __DIR__ . '/../config.php';
$SCHEMA = require __DIR__ . '/schema.php';
if (!empty($CONFIG['title'])) $SCHEMA['title'] = $CONFIG['title'];

ini_set('display_errors', !empty($CONFIG['debug']) ? '1' : '0');
error_reporting(E_ALL);
mb_internal_encoding('UTF-8');

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') == 443;
session_name('dcsite_' . substr(md5(__DIR__), 0, 10));
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
session_start();
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

// ---------- Helpers ----------
function h($v): string { return htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
// Quotes a table or column name. Names only ever come from inc/schema.php, never from the browser.
function q(string $name): string { return chr(96) . str_replace(chr(96), chr(96) . chr(96), $name) . chr(96); }
function url(string $page, array $params = []): string { return $page . ($params ? '?' . http_build_query($params) : ''); }
function redirect(string $to): void { header('Location: ' . $to); exit; }
function str_param(array $from, string $key): string { $v = $from[$key] ?? ''; return is_string($v) ? $v : ''; }
function sub_param(array $from, string $key, string $sub): string { $v = $from[$key][$sub] ?? ''; return isset($from[$key]) && is_array($from[$key]) && is_string($v) ? $v : ''; }
function cut(string $s, int $n): string { return mb_substr($s, 0, $n); }

function db(): PDO {
    static $pdo = null;
    global $CONFIG;
    if ($pdo === null) {
        $c = $CONFIG['db'];
        $dsn = 'mysql:host=' . $c['host'] . ';port=' . (int)($c['port'] ?? 3306) . ';dbname=' . $c['name'] . ';charset=utf8mb4';
        try {
            $pdo = new PDO($dsn, $c['user'], $c['pass'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        } catch (PDOException $e) {
            fail('Could not connect to the database. Check the settings in config.php.', $e);
        }
    }
    return $pdo;
}
function fail(string $msg, ?Throwable $e = null): void {
    global $CONFIG;
    if ($e) error_log('DataCraft site: ' . $e->getMessage());
    if (!headers_sent()) http_response_code(500);
    page_start('Problem');
    echo '<div class="msg bad">' . h($msg) . '</div>';
    if ($e && !empty($CONFIG['debug'])) echo '<pre class="debug">' . h($e->getMessage()) . '</pre>';
    page_end();
    exit;
}

// ---------- Forms ----------
function csrf_token(): string { if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32)); return $_SESSION['csrf']; }
function csrf_field(): string { return '<input type="hidden" name="csrf" value="' . h(csrf_token()) . '">'; }
function check_csrf(): void {
    if (!hash_equals(csrf_token(), str_param($_POST, 'csrf'))) {
        http_response_code(400);
        exit('This form has expired. Go back, reload the page and try again.');
    }
}
function flash(?string $msg = null, string $kind = 'ok'): ?array {
    if ($msg !== null) { $_SESSION['flash'] = [$kind, $msg]; return null; }
    $f = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $f;
}

// ---------- Accounts ----------
function current_user(): ?array { return $_SESSION['user'] ?? null; }
function require_login(): void {
    if (!current_user()) redirect(url('login.php', ['next' => $_SERVER['REQUEST_URI'] ?? '']));
}
function login_as(array $row): void {
    session_regenerate_id(true);
    $_SESSION['user'] = ['id' => (int)$row['id'], 'name' => $row['username']];
}
// Only send people back to pages on this site after logging in.
function safe_next(string $n): string {
    if ($n === '' || $n[0] !== '/' || (isset($n[1]) && ($n[1] === '/' || $n[1] === '\\')) || preg_match('/[\r\n]/', $n)) return 'index.php';
    return $n;
}
// Number of accounts, or null when the accounts table cannot be made.
function user_count(): ?int {
    try {
        return (int)db()->query('SELECT COUNT(*) FROM dc_users')->fetchColumn();
    } catch (PDOException $e) {
        try {
            db()->exec("CREATE TABLE IF NOT EXISTS dc_users (id INT UNSIGNED NOT NULL AUTO_INCREMENT, username VARCHAR(60) NOT NULL, password_hash VARCHAR(255) NOT NULL, failed INT NOT NULL DEFAULT 0, locked_until INT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY username (username)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            return 0;
        } catch (PDOException $e2) {
            return null;
        }
    }
}
function valid_username(string $u): bool { return (bool)preg_match('/^[\w.@-]{3,60}$/u', $u); }
function add_user(string $u, string $p): void {
    db()->prepare('INSERT INTO dc_users (username, password_hash) VALUES (?, ?)')->execute([$u, password_hash($p, PASSWORD_DEFAULT)]);
}

// ---------- Tables ----------
function table_def(string $t): array {
    global $SCHEMA;
    if ($t === '' || !isset($SCHEMA['tables'][$t])) {
        http_response_code(404);
        page_start('Not found');
        echo '<div class="msg bad">That table is not on this site.</div>';
        page_end();
        exit;
    }
    return $SCHEMA['tables'][$t];
}
function category_items(string $list): array {
    static $cache = [];
    if (!isset($cache[$list])) {
        try {
            $st = db()->prepare('SELECT ' . q('value') . ' FROM dc_categories WHERE ' . q('list') . ' = ? AND ' . q('value') . ' IS NOT NULL ORDER BY ord, ' . q('value'));
            $st->execute([$list]);
            $cache[$list] = $st->fetchAll(PDO::FETCH_COLUMN);
        } catch (PDOException $e) {
            $cache[$list] = [];
        }
    }
    return $cache[$list];
}
// [record number => label] for a link drop-down.
function link_options(string $t): array {
    static $cache = [];
    global $SCHEMA;
    if (!isset($cache[$t])) {
        $d = $SCHEMA['tables'][$t];
        $rows = db()->query('SELECT ' . q($d['key']) . ' AS k, ' . q($d['display']) . ' AS v FROM ' . q($t) . ' ORDER BY ' . q($d['display']) . ' LIMIT 5000')->fetchAll();
        $cache[$t] = [];
        $df = $d['fields'][$d['display']] ?? ['type' => 'number'];
        if ($df['type'] === 'link') $df = ['type' => 'number']; // never follow links in a loop
        foreach ($rows as $r) $cache[$t][$r['k']] = ($r['v'] === null || $r['v'] === '') ? '#' . $r['k'] : fmt($df, $r['v']);
    }
    return $cache[$t];
}
function link_label(string $t, $id): string {
    if ($id === null || $id === '') return '';
    $o = link_options($t);
    return (string)($o[$id] ?? '#' . $id);
}
// Tables with a link field pointing at $t: [[table, field], ...]
function links_to(string $t): array {
    global $SCHEMA;
    $out = [];
    foreach ($SCHEMA['tables'] as $name => $d) foreach ($d['fields'] as $fname => $f) if ($f['type'] === 'link' && $f['link'] === $t) $out[] = [$name, $fname];
    return $out;
}

// ---------- Showing values ----------
function money($v): string {
    global $SCHEMA;
    $n = (float)$v;
    return ($n < 0 ? '-' : '') . $SCHEMA['currency'] . number_format(abs($n), 2);
}
function num($v): string {
    $s = number_format((float)$v, 6, '.', ',');
    return rtrim(rtrim($s, '0'), '.');
}
function fmt_date(string $v): string {
    global $SCHEMA;
    $d = DateTime::createFromFormat('!Y-m-d', substr($v, 0, 10));
    return $d ? $d->format($SCHEMA['date_format']) : $v;
}
function fmt(array $f, $v): string {
    if ($v === null || $v === '') return '';
    switch ($f['type']) {
        case 'currency': return money($v);
        case 'formula': return !empty($f['money']) ? money($v) : num($v);
        case 'number': return num($v);
        case 'yesno': return $v ? 'Yes' : 'No';
        case 'date': return fmt_date((string)$v);
        case 'link': return link_label($f['link'], $v);
        default: return (string)$v;
    }
}

// ---------- Reading form input ----------
function read_input(array $f, string $name) {
    $raw = $_POST['f'][$name] ?? null;
    if (is_array($raw)) $raw = '';
    $s = trim((string)$raw);
    switch ($f['type']) {
        case 'yesno':
            return $s !== '' && $s !== '0' ? 1 : 0;
        case 'number':
        case 'currency':
            $s = str_replace([',', ' ', '$', '€', '£'], '', $s);
            if ($s === '') return null;
            if (!is_numeric($s)) throw new InvalidArgumentException($f['label'] . ' must be a number.');
            return $f['type'] === 'currency' ? round((float)$s, 2) : $s + 0;
        case 'date':
            if ($s === '') return null;
            $d = DateTime::createFromFormat('!Y-m-d', $s);
            if (!$d || $d->format('Y-m-d') !== $s) throw new InvalidArgumentException($f['label'] . ' must be a date.');
            return $s;
        case 'link':
            if ($s === '') return null;
            if (!ctype_digit($s) || !array_key_exists((int)$s, link_options($f['link']))) throw new InvalidArgumentException('Pick a ' . $f['label'] . ' from the list.');
            return (int)$s;
        case 'category':
            if ($s === '') return null;
            $items = category_items($f['list'] ?? '');
            if ($items && !in_array($s, $items, true)) throw new InvalidArgumentException('Pick a ' . $f['label'] . ' from the list.');
            return cut($s, (int)($f['max'] ?? 255));
        case 'longtext':
            $s = str_replace("\r\n", "\n", (string)$raw);
            return trim($s) === '' ? null : cut($s, (int)($f['max'] ?? 16000));
        default:
            return $s === '' ? null : cut($s, (int)($f['max'] ?? 255));
    }
}
function field_input(string $name, array $f, $v, ?string $err): string {
    $id = 'f_' . $name;
    $attr = 'id="' . h($id) . '" name="f[' . h($name) . ']"';
    $val = $v === null ? '' : (string)$v;
    switch ($f['type']) {
        case 'longtext':
            $in = '<textarea ' . $attr . ' rows="4">' . h($val) . '</textarea>';
            break;
        case 'number':
            $in = '<input ' . $attr . ' type="text" inputmode="decimal" value="' . h($val) . '">';
            break;
        case 'currency':
            $in = '<input ' . $attr . ' type="text" inputmode="decimal" value="' . h($val === '' ? '' : (is_numeric($val) ? number_format((float)$val, 2, '.', '') : $val)) . '">';
            break;
        case 'date':
            $in = '<input ' . $attr . ' type="date" value="' . h(substr($val, 0, 10)) . '">';
            break;
        case 'yesno':
            return '<label class="field check"><input ' . $attr . ' type="checkbox" value="1"' . ($val !== '' && $val !== '0' ? ' checked' : '') . '> <span>' . h($f['label']) . '</span></label>';
        case 'category':
            $items = category_items($f['list'] ?? '');
            if ($val !== '' && !in_array($val, $items, true)) array_unshift($items, $val);
            $in = '<select ' . $attr . '><option value=""></option>';
            foreach ($items as $it) $in .= '<option' . ($it === $val ? ' selected' : '') . '>' . h($it) . '</option>';
            $in .= '</select>';
            break;
        case 'link':
            $in = '<select ' . $attr . '><option value=""></option>';
            foreach (link_options($f['link']) as $k => $label) $in .= '<option value="' . h($k) . '"' . ((string)$k === $val ? ' selected' : '') . '>' . h($label) . '</option>';
            $in .= '</select>';
            break;
        case 'formula':
            $in = '<output id="' . h($id) . '">' . h(fmt($f, $v)) . '</output>';
            break;
        default:
            $in = '<input ' . $attr . ' type="text" maxlength="' . (int)($f['max'] ?? 255) . '" value="' . h($val) . '">';
    }
    return '<label class="field' . ($err ? ' has-error' : '') . '"><span>' . h($f['label']) . '</span>' . $in . ($err ? '<small class="err">' . h($err) . '</small>' : '') . '</label>';
}

// ---------- Page layout ----------
function page_start(string $title): void {
    global $SCHEMA;
    $u = current_user();
    $here = str_param($_GET, 't');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>' . h($title . ' – ' . $SCHEMA['title']) . '</title>';
    echo '<link rel="stylesheet" href="assets/style.css"><link rel="stylesheet" href="assets/custom.css"></head><body>';
    echo '<header class="top"><a class="brand" href="index.php">' . h($SCHEMA['title']) . '</a>';
    if ($u) {
        echo '<nav>';
        foreach ($SCHEMA['tables'] as $name => $t) echo '<a href="' . h(url('list.php', ['t' => $name])) . '"' . ($here === $name ? ' class="on"' : '') . '>' . h($t['label']) . '</a>';
        echo '</nav><div class="me"><a href="users.php">' . h($u['name']) . '</a>';
        echo '<form method="post" action="logout.php">' . csrf_field() . '<button class="linkbtn" type="submit">Log out</button></form></div>';
    }
    echo '</header><main>';
    $f = flash();
    if ($f) echo '<div class="msg ' . h($f[0]) . '">' . h($f[1]) . '</div>';
}
function page_end(): void {
    echo '</main><footer>Made with DataCraft</footer></body></html>';
}
`;

  const INDEX_PHP = String.raw`<?php
require __DIR__ . '/inc/app.php';
require_login();
page_start('Home');
echo '<h1>' . h($SCHEMA['title']) . '</h1><div class="cards">';
foreach ($SCHEMA['tables'] as $name => $t) {
    try {
        $n = (int)db()->query('SELECT COUNT(*) FROM ' . q($name))->fetchColumn();
        $info = $n . ' record' . ($n === 1 ? '' : 's');
    } catch (PDOException $e) {
        $info = 'Not in the database yet: import the .sql file';
    }
    echo '<a class="card" href="' . h(url('list.php', ['t' => $name])) . '"><b>' . h($t['label']) . '</b><span>' . h($info) . '</span></a>';
}
echo '</div>';
page_end();
`;

  const LIST_PHP = String.raw`<?php
require __DIR__ . '/inc/app.php';
require_login();
$t = str_param($_GET, 't');
$T = table_def($t);
$fields = $T['fields'];
$key = $T['key'];
$search = trim(str_param($_GET, 'q'));
$sort = str_param($_GET, 'sort');
$desc = str_param($_GET, 'dir') === 'desc';
$page = max(1, (int)str_param($_GET, 'page'));
$per = 50;

// Search, category filters and "records for" a linked record
$where = [];
$args = [];
$keep = ['t' => $t];
if ($search !== '') {
    $like = [];
    foreach ($fields as $name => $f) {
        if (in_array($f['type'], ['text', 'longtext', 'category'], true)) {
            $like[] = q($name) . ' LIKE ?';
            $args[] = '%' . addcslashes($search, '%_\\') . '%';
        }
    }
    if ($like) $where[] = '(' . implode(' OR ', $like) . ')';
    $keep['q'] = $search;
}
$filters = [];
foreach ($fields as $name => $f) {
    $v = sub_param($_GET, 'c', $name);
    if ($f['type'] === 'category' && $v !== '') { $where[] = q($name) . ' = ?'; $args[] = $v; $filters[$name] = $v; $keep['c'][$name] = $v; }
}
$parent = null;
foreach ($fields as $name => $f) {
    $v = sub_param($_GET, 'l', $name);
    if ($f['type'] === 'link' && ctype_digit($v)) { $where[] = q($name) . ' = ?'; $args[] = (int)$v; $parent = [$name, $f, (int)$v]; $keep['l'][$name] = $v; }
}
$from = ' FROM ' . q($t) . ($where ? ' WHERE ' . implode(' AND ', $where) : '');
$order = (isset($fields[$sort]) || $sort === $key) ? q($sort) . ($desc ? ' DESC' : ' ASC') . ', ' . q($key) : q($key);

try {
    // CSV of everything that matches
    if (isset($_GET['csv'])) {
        $st = db()->prepare('SELECT ' . implode(', ', array_merge([q($key)], array_map('q', array_keys($fields)))) . $from . ' ORDER BY ' . $order);
        $st->execute($args);
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . preg_replace('/[^\w-]/', '_', $t) . '-' . date('Y-m-d') . '.csv"');
        $out = fopen('php://output', 'w');
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, array_merge(['#'], array_map(function ($f) { return $f['label']; }, array_values($fields))));
        while ($r = $st->fetch()) {
            $line = [$r[$key]];
            foreach ($fields as $name => $f) $line[] = $f['type'] === 'link' ? link_label($f['link'], $r[$name]) : ($f['type'] === 'yesno' ? fmt($f, $r[$name]) : $r[$name]);
            fputcsv($out, $line);
        }
        exit;
    }
    $st = db()->prepare('SELECT COUNT(*)' . $from);
    $st->execute($args);
    $total = (int)$st->fetchColumn();
    $pages = max(1, (int)ceil($total / $per));
    $page = min($page, $pages);
    $cols = $T['columns'];
    $st = db()->prepare('SELECT ' . implode(', ', array_merge([q($key) . ' AS _k'], array_map('q', $cols))) . $from . ' ORDER BY ' . $order . ' LIMIT ' . $per . ' OFFSET ' . (($page - 1) * $per));
    $st->execute($args);
    $rows = $st->fetchAll();
} catch (PDOException $e) {
    fail('Could not read ' . $T['label'] . '. Has the .sql file been imported?', $e);
}

page_start($T['label']);
$addParams = ['t' => $t];
if ($parent) $addParams['pre'] = [$parent[0] => $parent[2]];
echo '<div class="head"><h1>' . h($T['label']) . '</h1><a class="btn primary" href="' . h(url('edit.php', $addParams)) . '">+ Add</a></div>';
if ($parent) echo '<p class="muted">Only records where ' . h($parent[1]['label']) . ' is <b>' . h(link_label($parent[1]['link'], $parent[2])) . '</b>. <a href="' . h(url('list.php', ['t' => $t])) . '">Show all</a></p>';

echo '<form class="filters" method="get"><input type="hidden" name="t" value="' . h($t) . '">';
if ($parent) echo '<input type="hidden" name="l[' . h($parent[0]) . ']" value="' . h($parent[2]) . '">';
echo '<input type="search" name="q" value="' . h($search) . '" placeholder="Search" aria-label="Search">';
foreach ($fields as $name => $f) {
    if ($f['type'] !== 'category') continue;
    echo '<select name="c[' . h($name) . ']" aria-label="' . h($f['label']) . '"><option value="">All ' . h($f['label']) . '</option>';
    foreach (category_items($f['list'] ?? '') as $it) echo '<option' . (($filters[$name] ?? null) === $it ? ' selected' : '') . '>' . h($it) . '</option>';
    echo '</select>';
}
echo '<button class="btn" type="submit">Find</button>';
echo '<a class="btn" href="' . h(url('list.php', $keep + ['csv' => 1])) . '">Download CSV</a></form>';

echo '<p class="muted">' . $total . ' record' . ($total === 1 ? '' : 's') . '</p>';
echo '<div class="tablewrap"><table><thead><tr>';
$sortLink = function ($name, $label) use ($keep, $sort, $desc) {
    $on = $sort === $name;
    $p = $keep + ['sort' => $name, 'dir' => ($on && !$desc) ? 'desc' : 'asc'];
    return '<a href="' . h(url('list.php', $p)) . '">' . h($label) . ($on ? ($desc ? ' ▼' : ' ▲') : '') . '</a>';
};
echo '<th class="num">' . $sortLink($key, '#') . '</th>';
foreach ($T['columns'] as $c) echo '<th' . (in_array($fields[$c]['type'], ['number', 'currency', 'formula'], true) ? ' class="num"' : '') . '>' . $sortLink($c, $fields[$c]['label']) . '</th>';
echo '</tr></thead><tbody>';
foreach ($rows as $r) {
    $edit = h(url('edit.php', ['t' => $t, 'id' => $r['_k']]));
    echo '<tr><td class="num"><a href="' . $edit . '">' . h($r['_k']) . '</a></td>';
    foreach ($T['columns'] as $c) {
        $f = $fields[$c];
        echo '<td' . (in_array($f['type'], ['number', 'currency', 'formula'], true) ? ' class="num"' : '') . '>' . nl2br(h(fmt($f, $r[$c]))) . '</td>';
    }
    echo '</tr>';
}
if (!$rows) echo '<tr><td colspan="' . (count($T['columns']) + 1) . '" class="muted">Nothing here yet.</td></tr>';
echo '</tbody></table></div>';

if ($pages > 1) {
    echo '<nav class="pages">';
    if ($page > 1) echo '<a class="btn" href="' . h(url('list.php', $keep + ['sort' => $sort, 'dir' => $desc ? 'desc' : 'asc', 'page' => $page - 1])) . '">‹ Back</a>';
    echo '<span>Page ' . $page . ' of ' . $pages . '</span>';
    if ($page < $pages) echo '<a class="btn" href="' . h(url('list.php', $keep + ['sort' => $sort, 'dir' => $desc ? 'desc' : 'asc', 'page' => $page + 1])) . '">Next ›</a>';
    echo '</nav>';
}
page_end();
`;

  const EDIT_PHP = String.raw`<?php
require __DIR__ . '/inc/app.php';
require_login();
$t = str_param($_GET, 't');
$T = table_def($t);
$key = $T['key'];
$idParam = str_param($_GET, 'id');
$id = ctype_digit($idParam) ? (int)$idParam : null;
$editable = array_filter($T['fields'], function ($f) { return $f['type'] !== 'formula'; });

$row = [];
try {
    if ($id !== null) {
        $st = db()->prepare('SELECT * FROM ' . q($t) . ' WHERE ' . q($key) . ' = ?');
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) { flash('That record no longer exists.', 'bad'); redirect(url('list.php', ['t' => $t])); }
    } else {
        // New record: "+ Add" from a linked list fills in the link
        foreach ($editable as $name => $f) {
            $v = sub_param($_GET, 'pre', $name);
            if ($v !== '') $row[$name] = $v;
        }
    }
} catch (PDOException $e) {
    fail('Could not read ' . $T['label'] . '. Has the .sql file been imported?', $e);
}

$errors = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    try {
        if (isset($_POST['delete']) && $id !== null) {
            db()->prepare('DELETE FROM ' . q($t) . ' WHERE ' . q($key) . ' = ?')->execute([$id]);
            flash('Record deleted.');
            redirect(url('list.php', ['t' => $t]));
        }
        $vals = [];
        foreach ($editable as $name => $f) {
            try {
                $vals[$name] = read_input($f, $name);
            } catch (InvalidArgumentException $e) {
                $errors[$name] = $e->getMessage();
                $raw = $_POST['f'][$name] ?? null;
                $vals[$name] = is_string($raw) ? $raw : null;
            }
        }
        if (!$errors) {
            $names = array_keys($vals);
            if ($id === null) {
                db()->prepare('INSERT INTO ' . q($t) . ' (' . implode(', ', array_map('q', $names)) . ') VALUES (' . implode(', ', array_fill(0, count($names), '?')) . ')')->execute(array_values($vals));
                $id = (int)db()->lastInsertId();
                flash('Record added.');
            } else {
                $sets = implode(', ', array_map(function ($n) { return q($n) . ' = ?'; }, $names));
                if ($sets !== '') db()->prepare('UPDATE ' . q($t) . ' SET ' . $sets . ' WHERE ' . q($key) . ' = ?')->execute(array_merge(array_values($vals), [$id]));
                flash('Saved.');
            }
            redirect(isset($_POST['and_new']) ? url('edit.php', ['t' => $t]) : url('edit.php', ['t' => $t, 'id' => $id]));
        }
        $row = array_merge($row ?: [], $vals);
    } catch (PDOException $e) {
        fail('The record could not be saved.', $e);
    }
}

page_start(($id === null ? 'New ' : 'Edit ') . $T['label']);
echo '<div class="head"><h1>' . ($id === null ? 'New record' : h(link_label($t, $id))) . ' <small class="muted">' . h($T['label']) . ($id !== null ? ' #' . h($id) : '') . '</small></h1>';
echo '<a class="btn" href="' . h(url('list.php', ['t' => $t])) . '">Back to the list</a></div>';
if ($errors) echo '<div class="msg bad">Please check the fields marked in red.</div>';
echo '<form class="record" method="post" action="' . h(url('edit.php', $id === null ? ['t' => $t] : ['t' => $t, 'id' => $id])) . '">' . csrf_field();
foreach ($T['fields'] as $name => $f) {
    if ($f['type'] === 'formula' && $id === null) continue;
    echo field_input($name, $f, $row[$name] ?? null, $errors[$name] ?? null);
}
echo '<div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="submit" name="and_new" value="1">Save and add another</button>';
echo '</div></form>';

if ($id !== null) {
    // Records in other tables that link to this one
    foreach (links_to($t) as [$other, $field]) {
        $O = $SCHEMA['tables'][$other];
        try {
            $st = db()->prepare('SELECT COUNT(*) FROM ' . q($other) . ' WHERE ' . q($field) . ' = ?');
            $st->execute([$id]);
            $n = (int)$st->fetchColumn();
        } catch (PDOException $e) {
            continue;
        }
        echo '<p class="related"><a href="' . h(url('list.php', ['t' => $other, 'l' => [$field => $id]])) . '">' . h($O['label']) . ': ' . $n . ' record' . ($n === 1 ? '' : 's') . '</a>';
        echo ' · <a href="' . h(url('edit.php', ['t' => $other, 'pre' => [$field => $id]])) . '">+ Add</a></p>';
    }
    echo '<form class="danger" method="post" action="' . h(url('edit.php', ['t' => $t, 'id' => $id])) . '" onsubmit="return confirm(\'Delete this record? This cannot be undone.\')">' . csrf_field();
    echo '<button class="btn danger" type="submit" name="delete" value="1">Delete this record</button></form>';
}
page_end();
`;

  const LOGIN_PHP = String.raw`<?php
require __DIR__ . '/inc/app.php';
$next = safe_next(str_param($_GET, 'next'));
if (current_user()) redirect($next);
$count = user_count();
$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $count !== null) {
    check_csrf();
    $u = trim(str_param($_POST, 'username'));
    $p = str_param($_POST, 'password');
    if ($count === 0) {
        // The very first visit: make the first account. The setup key from config.php proves it is you.
        $p2 = str_param($_POST, 'password2');
        $setup = (string)($CONFIG['setup_key'] ?? '');
        if ($setup === '' || !hash_equals($setup, trim(str_param($_POST, 'setup_key')))) $error = 'The setup key is wrong. You can find it in config.php.';
        elseif (!valid_username($u)) $error = 'Use 3 to 60 letters, numbers, dots, dashes, _ or @ for the user name.';
        elseif (strlen($p) < 8) $error = 'Use at least 8 characters for the password.';
        elseif ($p !== $p2) $error = 'The two passwords are different.';
        else {
            add_user($u, $p);
            $st = db()->prepare('SELECT * FROM dc_users WHERE username = ?');
            $st->execute([$u]);
            login_as($st->fetch());
            flash('Welcome! Your account is ready.');
            redirect('index.php');
        }
    } else {
        $st = db()->prepare('SELECT * FROM dc_users WHERE username = ?');
        $st->execute([$u]);
        $row = $st->fetch();
        if ($row && (int)$row['locked_until'] > time()) {
            $error = 'Too many wrong passwords. Try again in a few minutes.';
        } elseif ($row && password_verify($p, $row['password_hash'])) {
            db()->prepare('UPDATE dc_users SET failed = 0, locked_until = 0 WHERE id = ?')->execute([$row['id']]);
            if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
                db()->prepare('UPDATE dc_users SET password_hash = ? WHERE id = ?')->execute([password_hash($p, PASSWORD_DEFAULT), $row['id']]);
            }
            login_as($row);
            redirect($next);
        } else {
            if ($row) {
                $failed = (int)$row['failed'] + 1;
                db()->prepare('UPDATE dc_users SET failed = ?, locked_until = ? WHERE id = ?')->execute([$failed >= 5 ? 0 : $failed, $failed >= 5 ? time() + 300 : 0, $row['id']]);
            }
            usleep(500000);
            $error = 'Wrong user name or password.';
        }
    }
}
page_start('Log in');
echo '<form class="login" method="post" action="' . h(url('login.php', ['next' => $next])) . '">' . csrf_field();
if ($count === null) {
    echo '<h1>Almost there</h1><div class="msg bad">The database is not ready. Check config.php, and import the .sql file with phpMyAdmin.</div>';
} elseif ($count === 0) {
    echo '<h1>Make the first account</h1><p class="muted">This site has no users yet. The setup key is in config.php.</p>';
    if ($error) echo '<div class="msg bad">' . h($error) . '</div>';
    echo '<label class="field"><span>Setup key</span><input name="setup_key" autocomplete="off" required></label>';
    echo '<label class="field"><span>User name</span><input name="username" value="' . h(str_param($_POST, 'username')) . '" autocomplete="username" required></label>';
    echo '<label class="field"><span>Password (8 or more characters)</span><input type="password" name="password" autocomplete="new-password" required></label>';
    echo '<label class="field"><span>Password again</span><input type="password" name="password2" autocomplete="new-password" required></label>';
    echo '<button class="btn primary" type="submit">Make the account</button>';
} else {
    echo '<h1>Log in</h1>';
    if ($error) echo '<div class="msg bad">' . h($error) . '</div>';
    echo '<label class="field"><span>User name</span><input name="username" value="' . h(str_param($_POST, 'username')) . '" autocomplete="username" required autofocus></label>';
    echo '<label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>';
    echo '<button class="btn primary" type="submit">Log in</button>';
}
echo '</form>';
page_end();
`;

  const LOGOUT_PHP = String.raw`<?php
require __DIR__ . '/inc/app.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    $_SESSION = [];
    session_regenerate_id(true);
    session_destroy();
}
redirect('login.php');
`;

  const USERS_PHP = String.raw`<?php
require __DIR__ . '/inc/app.php';
require_login();
$me = current_user();
$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    $do = str_param($_POST, 'do');
    try {
        if ($do === 'add') {
            $u = trim(str_param($_POST, 'username'));
            $p = str_param($_POST, 'password');
            if (!valid_username($u)) $error = 'Use 3 to 60 letters, numbers, dots, dashes, _ or @ for the user name.';
            elseif (strlen($p) < 8) $error = 'Use at least 8 characters for the password.';
            else {
                $st = db()->prepare('SELECT COUNT(*) FROM dc_users WHERE username = ?');
                $st->execute([$u]);
                if ($st->fetchColumn()) $error = 'That user name is taken.';
                else { add_user($u, $p); flash('Added ' . $u . '.'); redirect('users.php'); }
            }
        } elseif ($do === 'delete') {
            $id = (int)str_param($_POST, 'id');
            if ($id === $me['id']) $error = 'You cannot delete your own account while you are logged in.';
            else { db()->prepare('DELETE FROM dc_users WHERE id = ?')->execute([$id]); flash('User deleted.'); redirect('users.php'); }
        } elseif ($do === 'password') {
            $st = db()->prepare('SELECT password_hash FROM dc_users WHERE id = ?');
            $st->execute([$me['id']]);
            $hash = (string)$st->fetchColumn();
            $new = str_param($_POST, 'new');
            if (!password_verify(str_param($_POST, 'current'), $hash)) $error = 'Your current password is wrong.';
            elseif (strlen($new) < 8) $error = 'Use at least 8 characters for the new password.';
            elseif ($new !== str_param($_POST, 'new2')) $error = 'The two new passwords are different.';
            else {
                db()->prepare('UPDATE dc_users SET password_hash = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $me['id']]);
                session_regenerate_id(true);
                flash('Your password is changed.');
                redirect('users.php');
            }
        }
    } catch (PDOException $e) {
        fail('Could not change the accounts.', $e);
    }
}
$users = db()->query('SELECT id, username, created_at FROM dc_users ORDER BY username')->fetchAll();
page_start('Users');
echo '<h1>Users</h1>';
if ($error) echo '<div class="msg bad">' . h($error) . '</div>';
echo '<div class="tablewrap"><table><thead><tr><th>User name</th><th>Added</th><th></th></tr></thead><tbody>';
foreach ($users as $u) {
    echo '<tr><td>' . h($u['username']) . ((int)$u['id'] === $me['id'] ? ' <span class="muted">(you)</span>' : '') . '</td><td>' . h(fmt_date((string)$u['created_at'])) . '</td><td>';
    if ((int)$u['id'] !== $me['id']) echo '<form method="post" onsubmit="return confirm(\'Delete this user?\')">' . csrf_field() . '<input type="hidden" name="do" value="delete"><input type="hidden" name="id" value="' . h($u['id']) . '"><button class="linkbtn danger" type="submit">Delete</button></form>';
    echo '</td></tr>';
}
echo '</tbody></table></div>';
echo '<div class="cols"><form class="record" method="post">' . csrf_field() . '<h2>Add a user</h2><input type="hidden" name="do" value="add">';
echo '<label class="field"><span>User name</span><input name="username" autocomplete="off" required></label>';
echo '<label class="field"><span>Password (8 or more characters)</span><input type="password" name="password" autocomplete="new-password" required></label>';
echo '<div class="actions"><button class="btn primary" type="submit">Add user</button></div></form>';
echo '<form class="record" method="post">' . csrf_field() . '<h2>Change your password</h2><input type="hidden" name="do" value="password">';
echo '<label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>';
echo '<label class="field"><span>New password</span><input type="password" name="new" autocomplete="new-password" required></label>';
echo '<label class="field"><span>New password again</span><input type="password" name="new2" autocomplete="new-password" required></label>';
echo '<div class="actions"><button class="btn primary" type="submit">Change password</button></div></form></div>';
page_end();
`;

  const STYLE_CSS = `/* Made by DataCraft and replaced each time the site is generated. Put your own changes in custom.css. */
:root {
  --bg: #f4f5f7; --panel: #ffffff; --panel-2: #eef0f3; --fg: #1d2330; --muted: #667085; --line: #d9dde3;
  --accent: #2f6fdd; --accent-fg: #ffffff; --ok: #1e7a46; --ok-bg: #e5f5ec; --bad: #b42318; --bad-bg: #fdecea;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171c; --panel: #1c2027; --panel-2: #252a33; --fg: #e7eaf0; --muted: #98a2b3; --line: #343a45;
    --accent: #6b9cff; --accent-fg: #0d1320; --ok: #6fd39b; --ok-bg: #173325; --bad: #ff8a80; --bad-bg: #3a1d1b;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: var(--accent); }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; padding: 10px 20px; background: var(--panel); border-bottom: 1px solid var(--line); }
.brand { font-weight: 700; font-size: 17px; color: var(--fg); text-decoration: none; }
.top nav { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
.top nav a { padding: 5px 10px; border-radius: 6px; text-decoration: none; color: var(--fg); }
.top nav a:hover, .top nav a.on { background: var(--panel-2); }
.me { display: flex; align-items: center; gap: 12px; }
.me form { margin: 0; }
main { max-width: 1180px; margin: 0 auto; padding: 22px 20px 40px; }
footer { text-align: center; color: var(--muted); font-size: 12px; padding: 0 0 24px; }
h1 { font-size: 24px; margin: 0 0 14px; }
h2 { font-size: 17px; margin: 0 0 10px; }
.muted { color: var(--muted); }
.head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.head h1 { margin: 0; }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--fg); font: inherit; text-decoration: none; cursor: pointer; }
.btn:hover { background: var(--panel-2); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.danger { color: var(--bad); }
.linkbtn { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; cursor: pointer; }
.linkbtn.danger { color: var(--bad); }
.msg { padding: 10px 14px; border-radius: 8px; margin: 0 0 14px; background: var(--ok-bg); color: var(--ok); }
.msg.bad { background: var(--bad-bg); color: var(--bad); }
.debug { white-space: pre-wrap; background: var(--panel-2); padding: 10px; border-radius: 8px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.card { display: grid; gap: 4px; padding: 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; text-decoration: none; color: var(--fg); }
.card:hover { border-color: var(--accent); }
.card span { color: var(--muted); font-size: 13px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
input, select, textarea { font: inherit; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; min-height: 36px; }
input[type="search"] { min-width: 220px; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
.tablewrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 8px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { background: var(--panel-2); font-size: 13px; white-space: nowrap; }
th a { color: var(--fg); text-decoration: none; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: var(--panel-2); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.pages { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 16px 0; }
.record { display: grid; gap: 12px; max-width: 640px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; }
.field { display: grid; gap: 4px; }
.field > span { font-size: 13px; font-weight: 600; }
.field.check { display: flex; align-items: center; gap: 8px; }
.field.check input { min-height: 0; width: 18px; height: 18px; }
.field.has-error input, .field.has-error select, .field.has-error textarea { border-color: var(--bad); }
.err { color: var(--bad); }
output { padding: 7px 0; font-variant-numeric: tabular-nums; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.related { margin: 14px 0 0; }
.danger { margin-top: 24px; }
.login { max-width: 380px; margin: 40px auto; display: grid; gap: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 22px; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-top: 18px; }
@media (max-width: 600px) { main { padding: 16px; } .top { padding: 10px 16px; } input[type="search"] { min-width: 0; flex: 1; } }
@media print { .top, .filters, .pages, .actions, .danger, footer, .btn { display: none !important; } body { background: #fff; color: #000; } }
`;

  const DENY_ALL = `# Made by DataCraft: nothing in this folder is opened directly from the web.
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
</IfModule>
`;
  const HTACCESS = `# Made by DataCraft. Keeps the settings, any .sql file and the notes private.
<FilesMatch "(^config\\.php|\\.sql|^README\\.txt)$">
    <IfModule mod_authz_core.c>
        Require all denied
    </IfModule>
    <IfModule !mod_authz_core.c>
        Order allow,deny
        Deny from all
    </IfModule>
</FilesMatch>
DirectoryIndex index.php
`;

  const README = (o, stamp) => `${o.title} – PHP website
${'='.repeat(Math.min(70, o.title.length + 16))}
${stamp}.

What is here
  index.php, list.php, edit.php   The pages. Everyone has to log in first.
  login.php, users.php            Accounts: add users, change your password.
  config.php                      Your database settings and setup key.
                                  DataCraft never replaces this file.
  inc\\                            Shared code. inc\\schema.php describes your tables.
  assets\\style.css                The look. Put your own changes in assets\\custom.css
                                  (never replaced).

Put it online
  1. Make a MySQL database and a database user on your web host
     (for example cPanel > MySQL Databases).
  2. Open phpMyAdmin, pick the database, then Import > choose ${o.site}-database.sql > Go.
     That file is next to this folder (in php\\sites). Do not upload it: it holds your records.
     Importing it again later REPLACES those tables and their records.
     User accounts (the dc_users table) are kept.
  3. Edit config.php: database server, name, user and password.
  4. Upload this whole folder with FTP or the host's file manager,
     for example into public_html.
  5. Open it in a browser. The first time, it asks you to make a user;
     you need the setup key from config.php.

Needs PHP 7.4 or newer with PDO MySQL, and MySQL 5.7+ or MariaDB 10.2+.
On Apache the .htaccess files keep config.php and inc\\ private. On nginx, block inc\\
in the server settings (its files show nothing even when opened directly).

Try it on this computer (when PHP and MySQL are installed):
  php -S localhost:8000      (run it inside this folder, then open http://localhost:8000)

Making the site again in DataCraft replaces every file except config.php and assets\\custom.css.
`;

  Object.assign(DC, { phpSiteDialog: generateDialog, _php: { buildSite, siteSchema, zip, phpVal } });
})(window.DC);
