/* Craft AI settings (window.CraftKeys): where AI runs (local only, both, cloud) and your cloud AI keys, shared by every
   Craft app in this browser, saved to a file and loaded back (another browser or computer). One format for every app (each keeps its own copy of this file):
     { craft: 'ai-keys', version: 1, saved, keys: { anthropic, gemini, openai, openrouter, runware }, workspace? }
   or, locked with a password: { craft: 'ai-keys', version: 1, saved, locked: { salt, iv, data } } where data is that same
   JSON encrypted with AES-GCM under a key made from the password (PBKDF2-SHA256, 250,000 rounds). All of it happens in
   this browser; the password is never kept.
     CraftKeys.save({ keys, workspace }, { app })  → asks whether to lock it, then the file is saved
     CraftKeys.load()                               → { keys, workspace } or null (asks for the password if locked) */
(function () {
  'use strict';
  const ROUNDS = 250000, enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (u8) => btoa(String.fromCharCode(...u8)), unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function keyFrom(password, salt) { const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ROUNDS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
  async function lock(obj, password) { const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), k = await keyFrom(password, salt); const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(obj)))); return { salt: b64(salt), iv: b64(iv), data: b64(data) }; }
  async function unlock(locked, password) { const k = await keyFrom(password, unb64(locked.salt)); const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(locked.iv) }, k, unb64(locked.data)); return JSON.parse(dec.decode(plain)); }

  // a small window of its own (the apps' own dialogs differ), in the app's colours where it has them
  function dialog(title, html, buttons) {
    return new Promise((done) => {
      const back = document.createElement('div'); back.style.cssText = 'position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.5)';
      back.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${title}" style="width:min(440px,100%);display:grid;gap:10px;padding:18px;border-radius:12px;border:1px solid var(--line,#555);background:var(--panel,#222);color:var(--fg,#eee);font:14px system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.4)">
        <b style="font-size:16px">${title}</b>${html}<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">${buttons.map(([v, l, main]) => `<button type="button" data-v="${v}" class="btn ${main ? 'primary' : 'outline'}" style="padding:6px 12px;border-radius:7px;cursor:pointer">${l}</button>`).join('')}</div></div>`;
      const finish = (v) => { const vals = {}; back.querySelectorAll('input').forEach((i) => { vals[i.name] = i.type === 'checkbox' ? i.checked : i.value; }); back.remove(); done(v === null ? null : { v, ...vals }); };
      back.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) finish(b.dataset.v); else if (e.target === back) finish(null); });
      back.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(null); if (e.key === 'Enter' && e.target.tagName === 'INPUT') finish(buttons.find((b) => b[2])[0]); });
      back.querySelectorAll('input').forEach((i) => { i.style.cssText = 'padding:7px 9px;border-radius:7px;border:1px solid var(--line,#555);background:var(--panel-2,#2a2a2a);color:inherit;font:inherit'; });
      document.body.append(back); (back.querySelector('input:not([type=checkbox])') || back.querySelector('[data-v]')).focus();
    });
  }
  const say = (t) => dialog(t, '', [['ok', 'OK', true]]);

  async function save(data, { app = 'Craft' } = {}) {
    const keys = Object.fromEntries(Object.entries(data.keys || {}).filter(([, v]) => String(v || '').trim()).map(([k, v]) => [k, String(v).trim()]));
    if (!Object.keys(keys).length) { await say('There are no keys to save yet.'); return false; }
    const a = await dialog('Save keys to a file', `<p style="margin:0;opacity:.85">${Object.keys(keys).length} key${Object.keys(keys).length === 1 ? '' : 's'} (${Object.keys(keys).join(', ')}). The file loads into any Craft app or another browser.</p>
      <label style="display:grid;gap:4px">Password to lock the file <small style="opacity:.75">(recommended: without it, anyone who has the file can use your keys)</small><input name="p1" type="password" autocomplete="new-password"></label>
      <label style="display:grid;gap:4px">The password again<input name="p2" type="password" autocomplete="new-password"></label>`, [['cancel', 'Cancel'], ['save', 'Save', true]]);
    if (!a || a.v !== 'save') return false;
    if (a.p1 !== a.p2) { await say('The two passwords are not the same: nothing was saved.'); return false; }
    if (!a.p1) { const s = await dialog('Save it unlocked?', '<p style="margin:0">Anyone who gets the file could use your keys (and your accounts would pay). Keep it somewhere private.</p>', [['cancel', 'Back'], ['yes', 'Save it unlocked', true]]); if (!s || s.v !== 'yes') return false; }
    const body = { keys, ...(data.workspace ? { workspace: data.workspace } : {}) }, file = { craft: 'ai-keys', version: 1, saved: new Date().toISOString(), from: app, ...(a.p1 ? { locked: await lock(body, a.p1) } : body) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })), l = document.createElement('a'); l.href = url; l.download = 'craft-ai-keys.json'; document.body.append(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }
  function pick() { return new Promise((ok) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = () => ok(i.files[0] || null); i.click(); }); }
  async function load() {
    const f = await pick(); if (!f) return null; let j;
    try { j = JSON.parse(await f.text()); } catch (e) { await say('That file is not a keys file.'); return null; }
    if (!j || j.craft !== 'ai-keys') { await say('That file is not a Craft keys file (saved with “Save keys to a file”).'); return null; }
    let body = j;
    if (j.locked) for (;;) {
      const a = await dialog('Load keys', `<p style="margin:0;opacity:.85">This keys file is locked${j.from ? ` (saved from ${j.from})` : ''}.</p><label style="display:grid;gap:4px">Its password<input name="p" type="password" autocomplete="current-password"></label>`, [['cancel', 'Cancel'], ['open', 'Open', true]]);
      if (!a || a.v !== 'open') return null;
      try { body = await unlock(j.locked, a.p); break; } catch (e) { await say('That is not its password.'); }
    }
    return { keys: body.keys || {}, workspace: body.workspace || '' };
  }
  // ------------------------------------------------------------------ the keys every Craft app shares in this browser
  // (apps opened from files on this computer share the browser's storage, so a key typed in one is there in all)
  const SHARED = 'craft-ai-keys', PROVIDERS = ['anthropic', 'gemini', 'openai', 'openrouter', 'runware'];
  const NAMES = { anthropic: 'Claude (Anthropic)', gemini: 'Gemini (Google)', openai: 'GPT (OpenAI)', openrouter: 'OpenRouter (many models)', runware: 'Runware (pictures)' };
  const LINKS = { anthropic: 'https://console.anthropic.com/settings/keys', gemini: 'https://aistudio.google.com/apikey', openai: 'https://platform.openai.com/api-keys', openrouter: 'https://openrouter.ai/keys', runware: 'https://my.runware.ai/keys' };
  // where AI runs, for every app: 'local' (only this computer, nothing sent), 'both', or 'cloud'
  const MODE = 'craft-ai-mode', MODES = [['local', 'Local only', 'Only the AI on this computer: nothing is sent anywhere'], ['both', 'Both', 'This computer’s AI, and cloud AI where you ask for it or where it does better'], ['cloud', 'Cloud', 'The cloud AI does the work (with your keys)']];
  function mode() { try { return localStorage.getItem(MODE) || 'both'; } catch (e) { return 'both'; } }
  function setMode(m) { try { localStorage.setItem(MODE, m); } catch (e) { /* blocked */ } window.dispatchEvent(new CustomEvent('craft-keys')); }
  function shared() { try { const s = JSON.parse(localStorage.getItem(SHARED) || 'null'); return { keys: { ...(s && s.keys) }, workspace: (s && s.workspace) || '' }; } catch (e) { return { keys: {}, workspace: '' }; } }
  // keys given here are added to (or replace) the shared ones; an empty string takes one away
  function share(o) { const s = shared(); for (const [k, v] of Object.entries(o.keys || {})) { if (v === '') delete s.keys[k]; else if (v) s.keys[k] = String(v).trim(); } if (o.workspace !== undefined) s.workspace = o.workspace; try { localStorage.setItem(SHARED, JSON.stringify(s)); } catch (e) { /* blocked */ } window.dispatchEvent(new CustomEvent('craft-keys')); return s; }
  // the AI keys window, the same in every app (onChange: the app's own copy of the keys follows)
  function open({ app = 'Craft', onChange } = {}) {
    const back = document.createElement('div'); back.style.cssText = 'position:fixed;inset:0;z-index:4500;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.45)';
    const draw = () => { const s = shared();
      back.innerHTML = `<div role="dialog" aria-modal="true" aria-label="AI settings" style="width:min(560px,100%);max-height:calc(100vh - 40px);overflow:auto;display:grid;gap:10px;padding:18px;border-radius:12px;border:1px solid var(--line,#555);background:var(--panel,#222);color:var(--fg,#eee);font:14px system-ui,sans-serif">
        <div style="display:flex;align-items:center;gap:10px"><b style="font-size:16px;flex:1">AI settings</b><button type="button" data-a="close" class="btn outline">Close</button></div>
        <div style="display:grid;gap:4px"><span>Where AI runs <small style="opacity:.75">(every Craft app in this browser)</small></span><div role="group" style="display:flex;gap:0;border:1px solid var(--line,#555);border-radius:8px;overflow:hidden">${MODES.map(([k, l, t]) => `<button type="button" data-mode="${k}" title="${t}" aria-pressed="${mode() === k}" style="flex:1;display:flex;gap:6px;align-items:center;justify-content:center;padding:7px 8px;border:0;cursor:pointer;font:inherit;color:inherit;background:${mode() === k ? 'var(--accent,#7c6cf0)' : 'transparent'};${mode() === k ? 'color:var(--accent-ink,#fff);font-weight:600' : ''}">${ico(k)} ${l}</button>`).join('')}</div><small style="opacity:.75">${MODES.find((m) => m[0] === mode())[2]}.</small></div>
        <b style="margin-top:4px">Keys</b>
        <p style="margin:0;opacity:.8">Your own keys for the cloud AI services. They are kept in this browser, shared by every Craft app opened from files on this computer, and sent only to their own company when you use them. Each use is billed to your account there.</p>
        ${PROVIDERS.map((k) => `<label style="display:grid;gap:3px"><span>${NAMES[k]}${s.keys[k] ? ' · <b>saved</b>' : ''} <a href="${LINKS[k]}" target="_blank" rel="noopener" style="font-size:12px;margin-left:6px">get a key</a></span><input data-k="${k}" type="password" autocomplete="off" spellcheck="false" placeholder="${s.keys[k] ? '•••••••• (saved; type to replace)' : 'paste the key here'}" style="padding:7px 9px;border-radius:7px;border:1px solid var(--line,#555);background:var(--panel-2,#2a2a2a);color:inherit;font:inherit"></label>`).join('')}
        <div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" data-a="keep" class="btn primary">Keep these keys</button><button type="button" data-a="save" class="btn outline">Save keys to a file…</button><button type="button" data-a="load" class="btn outline">Load keys from a file…</button><button type="button" data-a="forget" class="btn outline">Forget them</button></div>
        <p data-out style="margin:0;opacity:.85"></p></div>`; };
    const out = (t) => { const o = back.querySelector('[data-out]'); if (o) o.textContent = t; };
    back.addEventListener('click', async (e) => {
      if (e.target === back) { back.remove(); return; } const md = e.target.closest('[data-mode]'); if (md) { setMode(md.dataset.mode); if (onChange) onChange(shared()); draw(); return; } const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'close') { back.remove(); return; }
      if (a.dataset.a === 'keep') { const keys = {}; back.querySelectorAll('[data-k]').forEach((i) => { if (i.value.trim()) keys[i.dataset.k] = i.value.trim(); }); share({ keys }); if (onChange) onChange(shared()); draw(); out(Object.keys(keys).length ? 'Kept: every Craft app in this browser has them now.' : 'Nothing typed.'); return; }
      if (a.dataset.a === 'save') { const s = shared(); if (await save(s, { app })) out('Saved craft-ai-keys.json.'); return; }
      if (a.dataset.a === 'load') { const got = await load(); if (!got) return; share(got); if (onChange) onChange(shared()); draw(); out(`Loaded ${Object.keys(got.keys).length} key${Object.keys(got.keys).length === 1 ? '' : 's'}: every Craft app in this browser has them now.`); return; }
      if (a.dataset.a === 'forget') { const c = await dialog('Forget the keys?', '<p style="margin:0">Every Craft app in this browser forgets them. The keys stay valid at each company.</p>', [['cancel', 'Cancel'], ['yes', 'Forget them', true]]); if (!c || c.v !== 'yes') return; try { localStorage.removeItem(SHARED); localStorage.setItem('craft-ai-forget', String(Date.now())); } catch (err) { /* blocked */ } if (onChange) onChange({ keys: Object.fromEntries(PROVIDERS.map((k) => [k, ''])), workspace: '' }); window.dispatchEvent(new CustomEvent('craft-keys', { detail: { forget: true } })); draw(); out('Forgotten.'); }
    });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog][aria-label="Save keys to a file"], [role=dialog][aria-label="Load keys"]')) back.remove(); });
    draw(); document.body.append(back); back.querySelector('input').focus();
  }
  // ------------------------------------------------------------------ activity (local and cloud AI) and debug
  // Apps tell what their AI did: CraftKeys.activity('local' | 'cloud', { what, model, ms, ok, sent, came }). The debug list
  // catches errors and warnings by itself. All of it is kept for this session only, and never holds a key.
  const ACT = { local: [], cloud: [], debug: [] }, cap = (a) => { if (a.length > 300) a.shift(); };
  function activity(where, e) { const list = ACT[where] || ACT.local; list.push({ at: Date.now(), ...e }); cap(list); window.dispatchEvent(new CustomEvent('craft-activity')); }
  const dbg = (level, args) => { ACT.debug.push({ at: Date.now(), level, text: args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })() : String(a))).join(' ').replace(/(sk-ant-|sk-|AIza)[\w-]{8,}/g, '$1…') }); cap(ACT.debug); window.dispatchEvent(new CustomEvent('craft-activity')); };
  for (const level of ['error', 'warn']) { const real = console[level].bind(console); console[level] = (...a) => { dbg(level, a); real(...a); }; }
  window.addEventListener('error', (e) => dbg('error', [e.message + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '')]));
  window.addEventListener('unhandledrejection', (e) => dbg('error', ['Unhandled:', e.reason]));
  const hasErrors = () => ACT.debug.some((d) => d.level === 'error');
  function openActivity(tab = 'local') {
    // ImageCraft has its own windows for these
    const IC = window.IC; if (IC && IC.openLocalLog && IC.openCloudLog && IC.openDebug) { ({ local: IC.openLocalLog, cloud: IC.openCloudLog, debug: IC.openDebug })[tab](); return; }
    let back = document.querySelector('.craft-activity'); if (back) back.remove();
    back = document.createElement('div'); back.className = 'craft-activity'; back.style.cssText = 'position:fixed;inset:0;z-index:4500;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.45)';
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]), time = (t) => new Date(t).toLocaleTimeString();
    const row = (e) => (tab === 'debug' ? `<div style="padding:5px 0;border-bottom:1px solid var(--line,#444)"><small style="opacity:.7">${time(e.at)} · ${e.level}</small><pre style="margin:2px 0 0;white-space:pre-wrap;font:12px ui-monospace,monospace;color:${e.level === 'error' ? '#f87171' : 'inherit'}">${esc(e.text)}</pre></div>`
      : `<div style="padding:6px 0;border-bottom:1px solid var(--line,#444)"><b>${esc(e.what || 'AI')}</b> <small style="opacity:.75">${time(e.at)}${e.model ? ' · ' + esc(e.model) : ''}${e.ms != null ? ` · ${(e.ms / 1000).toFixed(1)} s` : ''} · ${e.ok === false ? '<span style="color:#f87171">failed</span>' : 'OK'}</small>${e.sent ? `<div style="font-size:12.5px;opacity:.85">Sent: ${esc(e.sent)}</div>` : ''}${e.came ? `<div style="font-size:12.5px">Came back: ${esc(e.came)}</div>` : ''}</div>`);
    const draw = () => { const list = ACT[tab].slice().reverse();
      back.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Activity" style="width:min(720px,100%);max-height:calc(100vh - 40px);display:grid;grid-template-rows:auto auto 1fr auto;gap:10px;padding:18px;border-radius:12px;border:1px solid var(--line,#555);background:var(--panel,#222);color:var(--fg,#eee);font:14px system-ui,sans-serif">
        <div style="display:flex;align-items:center;gap:10px"><b style="font-size:16px;flex:1">Activity</b><button type="button" data-a="close" class="btn outline">Close</button></div>
        <div role="tablist" style="display:flex;gap:6px">${[['local', 'Local AI'], ['cloud', 'Cloud AI'], ['debug', 'Debug']].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}" class="btn ${tab === k ? 'primary' : 'outline'}">${l} (${ACT[k].length})</button>`).join('')}</div>
        <div style="overflow:auto;min-height:120px">${list.length ? list.map(row).join('') : `<p style="opacity:.75">${tab === 'local' ? 'Nothing done by the AI on this computer yet this session.' : tab === 'cloud' ? 'Nothing sent to a cloud AI yet this session.' : 'No errors or warnings this session.'}</p>`}</div>
        <div style="display:flex;gap:8px;align-items:center"><button type="button" data-a="copy" class="btn outline">Copy all</button><button type="button" data-a="clear" class="btn outline">Clear</button><small style="opacity:.7">This session only; keys are never shown or kept here.</small></div></div>`; };
    const shut = () => { back.remove(); window.removeEventListener('craft-activity', draw); };
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-a=close]')) return shut(); const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; draw(); return; }
      if (e.target.closest('[data-a=clear]')) { ACT[tab].length = 0; draw(); window.dispatchEvent(new CustomEvent('craft-activity')); return; }
      const cp = e.target.closest('[data-a=copy]'); if (cp) { const text = ACT[tab].map((x) => `${new Date(x.at).toISOString()} ${tab === 'debug' ? x.level + ' ' + x.text : `${x.what || ''} ${x.model || ''} ${x.ms != null ? x.ms + 'ms' : ''} ${x.ok === false ? 'FAILED' : 'OK'} ${x.sent || ''} => ${x.came || ''}`}`).join('\n'); navigator.clipboard.writeText(text).then(() => { cp.textContent = 'Copied'; }); } });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut(); });
    window.addEventListener('craft-activity', draw); draw(); document.body.append(back); back.querySelector('[data-a=close]').focus();
  }
  // ------------------------------------------------------------------ the little switch in the title bar
  // computer (local only) · computer + cloud (both) · cloud, and a key that opens the AI settings. It puts itself just
  // before the title bar's search box in any Craft app that loads this file.
  const ICON = {
    local: '<rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 14v3"/>',
    both: '<rect x="1.5" y="7" width="11" height="8" rx="1.2"/><path d="M5 18h4M7 15v3"/><path d="M14 12.5h3.2a2.3 2.3 0 0 0 .3-4.6 3.2 3.2 0 0 0-6.1-.4" />',
    cloud: '<path d="M6 16h8.5a3.5 3.5 0 0 0 .5-7 4.8 4.8 0 0 0-9.2 1.2A2.9 2.9 0 0 0 6 16z"/>',
    key: '<circle cx="7" cy="12" r="3.2"/><path d="M10.2 12H18M15 12v2.8M17.5 12v2"/>',
    bug: '<rect x="6.5" y="7" width="7" height="9" rx="3.5"/><path d="M8 7a2 2 0 0 1 4 0M10 9.5V16M3.5 9.5l3 1.2M16.5 9.5l-3 1.2M3 13h3.5M17 13h-3.5M4 16.8l2.8-1.5M16 16.8l-2.8-1.5"/>',
  };
  const ico = (k) => `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  function chip(small) {
    const el = document.createElement('div'); el.className = small ? 'craft-ai-bottom' : 'ctb-ai'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Where AI runs');
    el.style.cssText = 'display:inline-flex;align-items:center;gap:1px;margin-right:8px;padding:2px;border-radius:8px;background:rgba(0,0,0,.18)';
    const paint = () => { const m = mode(), has = Object.keys(shared().keys).length;
      el.innerHTML = MODES.map(([k, l, t]) => `<button type="button" data-mode="${k}" aria-pressed="${m === k}" title="${l}: ${t}" style="display:grid;place-items:center;width:28px;height:24px;border:0;border-radius:6px;cursor:pointer;color:inherit;background:${m === k ? 'rgba(255,255,255,.28)' : 'transparent'};opacity:${m === k ? 1 : 0.7}">${ico(k)}</button>`).join('')
        + `<button type="button" data-keys title="AI settings: where AI runs and your cloud keys${has ? ` (${has} saved)` : ' (none saved yet)'}" style="display:grid;place-items:center;width:28px;height:24px;border:0;border-radius:6px;cursor:pointer;color:inherit;background:transparent;opacity:${has ? 1 : 0.7}">${ico('key')}</button>`
        + `<button type="button" data-activity title="Activity: what the AI here and in the cloud did, and the debug messages${hasErrors() ? ' (there are errors)' : ''}" style="position:relative;display:grid;place-items:center;width:28px;height:24px;border:0;border-radius:6px;cursor:pointer;color:inherit;background:transparent;opacity:.85">${ico('bug')}${hasErrors() ? '<i style="position:absolute;top:3px;right:4px;width:6px;height:6px;border-radius:50%;background:#ef4444"></i>' : ''}</button>`;
      if (small) { el.style.cssText = 'display:inline-flex;align-items:center;gap:1px;margin-left:auto;padding:1px;border-radius:7px;background:rgba(127,127,127,.12)'; if (document.getElementById('st-aimode')) el.querySelectorAll('[data-mode]').forEach((b) => { b.hidden = true; }); } el._dot = hasErrors(); };
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { setMode(b.dataset.mode); return; } if (e.target.closest('[data-keys]')) open({ app: document.title.split(/[–—-]/)[0].trim() || 'Craft' }); if (e.target.closest('[data-activity]')) openActivity(hasErrors() ? 'debug' : 'local'); });
    window.addEventListener('craft-keys', paint); window.addEventListener('craft-activity', () => { if (hasErrors() !== el._dot) paint(); }); window.addEventListener('storage', (e) => { if (e.key === MODE || e.key === SHARED) paint(); });
    paint(); return el;
  }
  // at the top (before the title bar's search box) and at the bottom (the end of the status bar; put back when the app
  // redraws its status bar). ImageCraft's status bar has its own switch: there only the key and the bug are added.
  let bottom = null;
  function mount() {
    const s = document.querySelector('.ctb .ctb-search'); if (s && !document.querySelector('.ctb-ai')) s.before(chip());
    const sb = document.querySelector('.statusbar'); if (sb && !sb.contains(bottom)) { bottom = bottom || chip(true); sb.append(bottom); }
  }
  mount(); { const mo = new MutationObserver(() => { const sb = document.querySelector('.statusbar'); if ((!document.querySelector('.ctb-ai') && document.querySelector('.ctb .ctb-search')) || (sb && !sb.contains(bottom))) mount(); }); mo.observe(document.documentElement, { childList: true, subtree: true }); }
  // a change in another tab or app (same browser) shows here too
  // (forgetting in another app or tab: every app forgets its own copy too)
  window.addEventListener('storage', (e) => { if (e.key === MODE || e.key === SHARED) window.dispatchEvent(new CustomEvent('craft-keys')); if (e.key === 'craft-ai-forget') window.dispatchEvent(new CustomEvent('craft-keys', { detail: { forget: true } })); });
  window.CraftKeys = { save, load, shared, share, open, mode, setMode, activity, openActivity, PROVIDERS, NAMES };
})();
