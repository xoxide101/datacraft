# DataCraft – development notes

How DataCraft is built, the decisions behind it, and what to watch for. For what it does and how to use it, see [README.md](README.md).

## Aim

Simple enough for anyone (tables, imports, printable invoices), with developer power underneath: MySQL `.sql` in and out, and a PHP website generator for your own server.

## Folders

```
datacraft\app\                  the program (no build step)
datacraft\projects\<name>\      <name>.db + imports\ + exports\
datacraft\php\sites\<site>\     a generated PHP site (upload this)
datacraft\php\sites\<site>-database.sql   its tables and records (kept beside the site, never uploaded)
```

`projects/` and `php/sites/` are git-ignored: people's own data never goes to GitHub.

## How it is built

- **Plain scripts, loaded in order** by `app/index.html`: `util.js`, `store.js`, `db.js`, `tables.js`, `dataio.js`, `pages.js`, `mysql.js`, `php.js`, `main.js`. They share one namespace, `window.DC`. Styles are in `app/css/app.css`.
- **SQLite runs in the browser** with sql.js 1.10.3 using the **pure-JavaScript build (`sql-asm.js`)**. The WebAssembly build cannot load from `file://`, so this keeps double-click opening working. PapaParse 5.4.1 parses CSV.
- **Storage:**
  - Chrome and Edge save into a real folder through the File System Access API; the folder handle is remembered in IndexedDB.
  - Other browsers keep projects in IndexedDB.
- **Every project is a normal SQLite file.** DataCraft's own metadata lives in `_dc_*` tables:
  - `_dc_settings`, `_dc_tables`, `_dc_fields`, `_dc_lists`, `_dc_list_items`, `_dc_pages`
  - Records are addressed by `rowid` (`_rid` in the app).
- **`db.sync`** (on open, and after the SQL console) adopts tables and columns that other tools added, and drops metadata for ones that are gone.
- **Field types:** text, notes, number, money, date (stored `YYYY-MM-DD`), yes/no, category, link (stores the other table's rowid), formula. Formulas are computed in JavaScript, never stored.

## Title bar

`app/js/craft-titlebar.js` (the shared `CraftTitlebar` component, the same file as in SiteCraft) is set up by `buildTitlebar()` in `main.js`.

- **Quick buttons:** overview, new table, import, export CSV, save a copy.
- **Info chips:** tables, where projects are kept, developer mode (click to switch).
- **Search:** Alt+Q searches every menu command, including the Developer menu when it is on.

## MySQL (`mysql.js`)

**Export**
- Writes `CREATE TABLE` + `INSERT` statements for MySQL 5.7+ and MariaDB 10.2+.
- Category lists go into `dc_categories`.
- Formulas become `VIRTUAL` generated columns:
  - empty values count as 0 (`IFNULL`)
  - dividing by zero gives NULL (`NULLIF`), matching DataCraft
  - formulas that use other formulas are written out in full
- Foreign keys are optional, because they make MySQL refuse links to records that don't exist.
- **Round trips:** column comments carry markers like `{dc:category=list}`, `{dc:link=table}` and `{dc:display=field}`, so DataCraft can read its own exports back with nothing lost.

**Import**
- Reads phpMyAdmin, mysqldump and DataCraft dumps, including:
  - `/*!…*/` version comments and `DELIMITER` blocks
  - keys added later with `ALTER TABLE`
  - escaped strings and hex values
- Foreign keys become links, ENUM columns become category lists, and generated columns become formulas (when they only use + − × ÷ and columns).
- Views, triggers, procedures and binary columns are skipped, and the import says what it left out.

## PHP site maker (`php.js`)

**Writes:** `config.php`, `inc/app.php`, `inc/schema.php`, the pages (`index`, `list`, `edit`, `login`, `logout`, `users`), `assets/` and `.htaccess`, for PHP 7.4+ with PDO MySQL.
- `config.php` and `assets/custom.css` are **never replaced** once made.

**Security choices**
- PDO prepared statements everywhere. Table and column names only ever come from `inc/schema.php`, never from the browser.
- CSRF token on every form; `password_hash` / `password_verify`.
- 5 wrong passwords lock the account for 5 minutes (stored in the database).
- The **first account needs the setup key** from `config.php`, so nobody else can claim a fresh site.
- Redirects after login only go to pages on the same site.
- **The `.sql` file is written beside the site folder, not inside it.** It contains every record, and a server that ignores `.htaccess` (nginx, or PHP's built-in server) would otherwise let anyone download it.

**Features:** list pages with search, category filters, sorting, paging and CSV download; add, edit and delete with server-side checks; links to related records, such as an invoice's lines.

## Version history

All built on 2026-10-13.

| Version | Added |
| --- | --- |
| 0.1 | Tables, fields, categories, TXT/CSV import (delimited and fixed-width), CSV export, page designer (invoices, sheets, lists), sample shop |
| 0.2 | Developer mode: MySQL `.sql` export and import, SQL console |
| 0.3 | PHP website maker |
| — | Fixed the light/dark button icon being squeezed by the general button padding |

## Testing approach

- **Browser:** the real app, driven in a browser.
- **Node harness:** loads `app/js/*.js` in a Node `vm` with sql.js, to build projects and run exports without a browser.
- **Real servers:** MySQL 8.0, MariaDB 11.4 and PHP 8.2 in throwaway Docker containers:
  - the export was loaded into both databases
  - real `mysqldump` and `mariadb-dump` output was read back
  - the generated PHP site was linted with `php -l` and clicked through: login, lockout, CSRF, add/edit/delete, CSV and injection attempts
- **Not yet tested:** a real web host.

## Ideas for later

- Test imports on real-world TXT exports.
- More page designer elements: barcodes, signatures.
- MongoDB was deliberately left out.
