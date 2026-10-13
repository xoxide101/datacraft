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
    exports\               CSV files you exported.
php\sites\<name>\        Generated PHP sites (coming in stage 3).

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
