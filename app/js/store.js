/* DataCraft — where projects live.
   Folder mode (Chrome/Edge): datacraft\projects\<name>\<name>.db, imports\, exports\ and datacraft\php\sites\.
   Browser mode (other browsers, or by choice): projects are kept in this browser's storage. */
(function (DC) {
  'use strict';
  const { h } = DC;

  const IDB = {
    _db: null,
    open() {
      return this._db || (this._db = new Promise((res, rej) => {
        const r = indexedDB.open('datacraft', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('projects'); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      }));
    },
    async tx(store, mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => { const q = fn(db.transaction(store, mode).objectStore(store)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    },
    get(store, key) { return this.tx(store, 'readonly', (s) => s.get(key)); },
    set(store, key, val) { return this.tx(store, 'readwrite', (s) => s.put(val, key)); },
    del(store, key) { return this.tx(store, 'readwrite', (s) => s.delete(key)); },
    keys(store) { return this.tx(store, 'readonly', (s) => s.getAllKeys()); },
  };

  const folderSupported = 'showDirectoryPicker' in window && !DC.inFrame;

  const store = {
    mode: null,            // 'folder' | 'browser' | null (not chosen yet)
    root: null,            // FileSystemDirectoryHandle of the datacraft folder
    needsPermission: false,
    folderSupported,

    async init() {
      try {
        if (folderSupported) {
          const root = await IDB.get('kv', 'root');
          if (root) {
            this.root = root; this.mode = 'folder';
            this.needsPermission = (await root.queryPermission({ mode: 'readwrite' })) !== 'granted';
            return;
          }
        }
        const m = await IDB.get('kv', 'mode');
        this.mode = (m === 'browser' || !folderSupported) ? 'browser' : null;
      } catch (e) { this.mode = folderSupported ? null : 'browser'; }
    },
    async chooseFolder() {
      const root = await window.showDirectoryPicker({ id: 'datacraft', mode: 'readwrite' });
      this.root = root; this.mode = 'folder'; this.needsPermission = false;
      await IDB.set('kv', 'root', root).catch(() => {});
      await IDB.set('kv', 'mode', 'folder').catch(() => {});
      await root.getDirectoryHandle('projects', { create: true });
      const php = await root.getDirectoryHandle('php', { create: true });
      await php.getDirectoryHandle('sites', { create: true });
    },
    async reconnect() {
      const p = await this.root.requestPermission({ mode: 'readwrite' });
      this.needsPermission = p !== 'granted';
      return !this.needsPermission;
    },
    async useBrowser() { this.mode = 'browser'; this.root = null; await IDB.set('kv', 'mode', 'browser').catch(() => {}); await IDB.del('kv', 'root').catch(() => {}); },
    get place() { return this.mode === 'folder' ? `${this.root.name} folder` : 'this browser'; },

    async projectsDir() { return this.root.getDirectoryHandle('projects', { create: true }); },
    async projectDir(name) { return (await this.projectsDir()).getDirectoryHandle(name, { create: true }); },

    async list() {
      const out = [];
      if (this.mode === 'folder') {
        const dir = await this.projectsDir();
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind !== 'directory') continue;
          try { const f = await (await handle.getFileHandle(name + '.db')).getFile(); out.push({ name, modified: f.lastModified, size: f.size }); } catch (e) { /* not a project */ }
        }
      } else {
        for (const name of await IDB.keys('projects')) { const p = await IDB.get('projects', name); out.push({ name, modified: p.modified, size: p.bytes.length }); }
      }
      return out.sort((a, b) => b.modified - a.modified);
    },
    async exists(name) { return (await this.list()).some((p) => p.name.toLowerCase() === name.toLowerCase()); },
    async load(name) {
      if (this.mode === 'folder') {
        const f = await (await (await this.projectDir(name)).getFileHandle(name + '.db')).getFile();
        return new Uint8Array(await f.arrayBuffer());
      }
      return (await IDB.get('projects', name)).bytes;
    },
    async save(name, bytes) {
      if (this.mode === 'folder') {
        const dir = await this.projectDir(name);
        await dir.getDirectoryHandle('imports', { create: true });
        await dir.getDirectoryHandle('exports', { create: true });
        const w = await (await dir.getFileHandle(name + '.db', { create: true })).createWritable();
        await w.write(bytes); await w.close();
      } else {
        await IDB.set('projects', name, { bytes, modified: Date.now() });
      }
    },
    async remove(name) {
      if (this.mode === 'folder') await (await this.projectsDir()).removeEntry(name, { recursive: true });
      else await IDB.del('projects', name);
    },
    // Saves a file into projects\<name>\<sub>\. Returns the path shown to the user, or null when it was downloaded instead.
    async writeExtra(name, sub, filename, data) {
      if (this.mode === 'folder') {
        const dir = await (await this.projectDir(name)).getDirectoryHandle(sub, { create: true });
        const w = await (await dir.getFileHandle(filename, { create: true })).createWritable();
        await w.write(data); await w.close();
        return `${this.root.name}\\projects\\${name}\\${sub}\\${filename}`;
      }
      if (!DC.inFrame) DC.download(filename, data);
      return null;
    },
  };

  DC.store = store;
  DC.IDB = IDB;
})(window.DC);
