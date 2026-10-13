DataCraft
=========

Start it: open  app\index.html  in Chrome or Edge (double-click it).
The first time, click "Choose the datacraft folder" and pick THIS folder
(the one that contains app, projects and php).

Folders
-------
app\                     The program. Updating it never touches your projects.
projects\<name>\         One folder per project:
    <name>.db              Everything: tables, records, categories and page designs.
                           It is a standard SQLite database, so other tools
                           (for example "DB Browser for SQLite") can open it too.
    imports\               Copies of the text/CSV files you imported.
    exports\               CSV and .sql files you exported.
php\sites\<site>\        PHP websites made with Developer > Make a PHP website.
php\sites\<site>-database.sql   Its tables and records, to import with phpMyAdmin
                                (keep it on your computer; do not upload it).

Developer mode
--------------
Help > Turn on developer mode adds a Developer menu:
  Export for MySQL (.sql)     Saves projects\<name>\exports\<name>-<date>.sql for phpMyAdmin
                              or "mysql -u USER -p DATABASE < file.sql" (MySQL 5.7+, MariaDB 10.2+).
                              Category lists go in a dc_categories table; calculated fields
                              become generated columns; links can become foreign keys.
  Import a MySQL .sql file    Reads tables and records from phpMyAdmin / mysqldump / DataCraft
                              .sql files, into this project or a new one. Foreign keys become
                              links, ENUM columns become category lists. Views, triggers,
                              procedures and binary (BLOB) columns are skipped.
  SQL console                 Runs SQLite commands on the open project (saved straight away).
  Make a PHP website          Writes a small website into php\sites\<site>: log in, then list,
                              search, filter, add, edit and delete records, download CSV, and
                              see linked records (an invoice's lines). PHP 7.4+ with PDO MySQL.
                              config.php (your database password) and assets\custom.css are
                              written only the first time, never replaced. The first user needs
                              the setup key shown by DataCraft (also in config.php).
                              Other browsers get a .zip instead.

Backing up
----------
Copy the projects folder. Each project's .db file holds all of its data.

Printing and PDF
----------------
Open a page, pick a record, click "Print this" (or "Print all").
In the print window choose your printer, or "Save as PDF".

Other browsers
--------------
Firefox and Safari can't save into folders. DataCraft still works there,
but keeps projects inside the browser. Use File > Save a copy (.db) to back them up.
