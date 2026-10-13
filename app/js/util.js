/* DataCraft — shared helpers: DOM, dialogs, formatting, parsing, formulas. */
window.DC = window.DC || {};
(function (DC) {
  'use strict';

  // ---------- DOM ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (typeof v !== 'string' && k in e) e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
    return e;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

  // ---------- Toast ----------
  let toastT;
  function toast(msg, ms = 3200) {
    let t = $('#toast');
    if (!t) { t = h('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- Modal dialogs ----------
  function modal({ title, body, actions = [], wide = false, onClose }) {
    const prevFocus = document.activeElement;
    const dlg = h('div', { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const back = h('div', { class: 'backdrop' }, dlg);
    const close = (result) => { back.remove(); document.removeEventListener('keydown', onKey, true); prevFocus && prevFocus.focus && prevFocus.focus(); onClose && onClose(result); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    dlg.append(h('h2', null, title));
    dlg.append(h('div', { class: 'dialog-body' }, body));
    if (actions.length) {
      dlg.append(h('div', { class: 'dialog-actions' }, actions.map((a) => h('button', {
        class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), type: 'button',
        onclick: async () => { const r = a.onClick ? await a.onClick() : undefined; if (r !== false) close(a.value ?? r); },
      }, a.label))));
    }
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    setTimeout(() => { const f = dlg.querySelector('input:not([type=checkbox]):not([type=file]),select,textarea') || dlg.querySelector('.btn.primary'); f && f.focus(); }, 0);
    return { el: dlg, close };
  }
  function ask({ title, body, ok = 'OK', danger = false }) {
    return new Promise((resolve) => {
      modal({ title, body: h('p', null, body), onClose: (r) => resolve(r === true),
        actions: [{ label: 'Cancel', value: false }, { label: ok, primary: !danger, danger, value: true }] });
    });
  }
  // fields: [{ id, label, type: text|number|select|checkbox|textarea, options: [[value,label]], value, hint }]
  function formDialog({ title, fields, ok = 'OK', validate, intro }) {
    return new Promise((resolve) => {
      const inputs = {};
      const err = h('p', { class: 'error', hidden: true });
      const rows = fields.map((f) => {
        let input;
        if (f.type === 'select') input = h('select', { class: 'input', id: 'fd-' + f.id }, f.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(f.value ?? '') }, l)));
        else if (f.type === 'textarea') input = h('textarea', { class: 'input', id: 'fd-' + f.id, rows: f.rows || 4 }, f.value ?? '');
        else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', id: 'fd-' + f.id, checked: !!f.value });
        else input = h('input', { class: 'input', id: 'fd-' + f.id, type: f.type || 'text', value: f.value ?? '', step: f.step, min: f.min, placeholder: f.placeholder || '' });
        inputs[f.id] = input;
        if (f.onChange) input.addEventListener('change', () => f.onChange(input.value, inputs));
        if (f.type === 'checkbox') return h('label', { class: 'check' }, input, ' ', f.label);
        return h('label', { class: 'field' }, h('span', null, f.label), input, f.hint ? h('small', { class: 'hint' }, f.hint) : null);
      });
      const read = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.type === 'checkbox' ? i.checked : i.value]));
      const m = modal({ title, body: [intro ? h('p', null, intro) : null, ...rows, err], onClose: (r) => resolve(r || null),
        actions: [{ label: 'Cancel', value: null }, { label: ok, primary: true, onClick: () => {
          const v = read(); const e = validate && validate(v);
          if (e) { err.textContent = e; err.hidden = false; return false; }
          return v;
        } }] });
      m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); m.el.querySelector('.btn.primary').click(); } });
    });
  }

  // ---------- Names ----------
  function ident(label) {
    let s = String(label || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) s = 'field';
    if (/^\d/.test(s)) s = 'f_' + s;
    if (s.startsWith('_dc') || s.startsWith('sqlite') || s === 'rowid' || s === '_rid') s = 'x_' + s;
    return s.slice(0, 48);
  }
  function uniq(base, taken) {
    const t = new Set([...taken].map((x) => String(x).toLowerCase()));
    if (!t.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) if (!t.has((base + '_' + i).toLowerCase())) return base + '_' + i;
  }
  const qi = (name) => '"' + String(name).replace(/"/g, '""') + '"';

  // ---------- Formatting ----------
  const settings = () => (DC.project && DC.project.settings) || {};
  function fmtCurrency(n) {
    if (n == null || n === '' || isNaN(n)) return '';
    const s = settings();
    try { return new Intl.NumberFormat(s.locale || undefined, { style: 'currency', currency: s.currency || 'USD' }).format(+n); }
    catch (e) { return (+n).toFixed(2); }
  }
  function fmtNumber(n, decimals) {
    if (n == null || n === '' || isNaN(n)) return '';
    const o = decimals != null && decimals !== '' ? { minimumFractionDigits: +decimals, maximumFractionDigits: +decimals } : { maximumFractionDigits: 6 };
    return new Intl.NumberFormat(settings().locale || undefined, o).format(+n);
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return String(iso);
    const f = settings().dateFormat || 'MM/DD/YYYY';
    if (f === 'YYYY-MM-DD') return `${m[1]}-${m[2]}-${m[3]}`;
    if (f === 'DD/MM/YYYY') return `${m[3]}/${m[2]}/${m[1]}`;
    if (f === 'DD.MM.YYYY') return `${m[3]}.${m[2]}.${m[1]}`;
    if (f === 'long') return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(settings().locale || undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    return `${m[2]}/${m[3]}/${m[1]}`;
  }
  // Display text for a stored value of a field. linkMaps: { tableName: Map(rid -> label) }
  function fmtValue(field, v, linkMaps) {
    if (!field) return v == null ? '' : String(v);
    switch (field.type) {
      case 'currency': return fmtCurrency(v);
      case 'number': case 'formula': return field.type === 'formula' && field.opts.currency ? fmtCurrency(v) : fmtNumber(v, field.opts.decimals);
      case 'date': return fmtDate(v);
      case 'yesno': return v == null || v === '' ? '' : (+v ? 'Yes' : 'No');
      case 'link': { const m = linkMaps && linkMaps[field.opts.link]; return v == null || v === '' ? '' : (m && m.get(+v)) || '#' + v; }
      default: return v == null ? '' : String(v);
    }
  }
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------- Parsing imported text ----------
  // numberFormat: 'dot' (1,234.56) or 'comma' (1.234,56)
  function parseNumber(s, numberFormat = 'dot') {
    if (s == null) return null;
    let t = String(s).trim();
    if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    t = t.replace(/[\s$€£¥₹]|USD|EUR|GBP|CAD|AUD/gi, '');
    if (t.endsWith('-')) { neg = true; t = t.slice(0, -1); }
    if (numberFormat === 'comma') t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    t = t.replace(/%$/, '');
    if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return null;
    const n = parseFloat(t);
    return neg ? -n : n;
  }
  // dateFormat: 'auto' | 'YMD' | 'MDY' | 'DMY'
  function parseDate(s, dateFormat = 'auto') {
    if (s == null) return null;
    const t = String(s).trim();
    if (!t) return null;
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T].*)?$/.exec(t);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += y < 50 ? 2000 : 1900;
      let fmt = dateFormat;
      if (fmt === 'auto' || fmt === 'YMD') fmt = a > 12 ? 'DMY' : 'MDY';
      return fmt === 'DMY' ? iso(y, b, a) : iso(y, a, b);
    }
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
    if (m) return iso(+m[1], +m[2], +m[3]);
    const d = new Date(t);
    if (!isNaN(d) && /[a-z]/i.test(t)) return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return null;
  }
  function iso(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  function parseYesNo(s) {
    const t = String(s ?? '').trim().toLowerCase();
    if (['yes', 'y', 'true', 't', '1', 'x', 'on'].includes(t)) return 1;
    if (['no', 'n', 'false', 'f', '0', 'off', ''].includes(t)) return t === '' ? null : 0;
    return null;
  }

  // ---------- Formulas: [Field Label] with + - * / ( ) and numbers ----------
  // Returns a function(valuesByLabelLower) -> number|null, or throws with a readable message.
  function compileFormula(src) {
    const toks = [];
    const re = /\s*(?:(\d+(?:\.\d+)?)|\[([^\]]+)\]|([-+*/()]))/y;
    let pos = 0;
    const s = String(src || '').trim();
    while (pos < s.length) {
      re.lastIndex = pos;
      const m = re.exec(s);
      if (!m) throw new Error(`I don't understand “${s.slice(pos).trim()}”. Use [Field name], numbers and + - * / ( ).`);
      pos = re.lastIndex;
      if (m[1]) toks.push({ t: 'n', v: +m[1] });
      else if (m[2]) toks.push({ t: 'f', v: m[2].trim().toLowerCase(), label: m[2].trim() });
      else toks.push({ t: 'o', v: m[3] });
      while (pos < s.length && s[pos] === ' ') pos++;
    }
    if (!toks.length) throw new Error('The formula is empty.');
    let i = 0;
    const peek = () => toks[i];
    function expr() { let n = term(); while (peek() && (peek().v === '+' || peek().v === '-')) { const op = toks[i++].v; const r = term(); const l = n; n = op === '+' ? (v) => num(l(v)) + num(r(v)) : (v) => num(l(v)) - num(r(v)); } return n; }
    function term() { let n = unary(); while (peek() && (peek().v === '*' || peek().v === '/')) { const op = toks[i++].v; const r = unary(); const l = n; n = op === '*' ? (v) => num(l(v)) * num(r(v)) : (v) => { const d = num(r(v)); return d === 0 ? null : num(l(v)) / d; }; } return n; }
    function unary() { if (peek() && peek().v === '-') { i++; const u = unary(); return (v) => -num(u(v)); } return atom(); }
    function atom() {
      const t = toks[i++];
      if (!t) throw new Error('The formula ends too early.');
      if (t.t === 'n') return () => t.v;
      if (t.t === 'f') return (v) => v[t.v];
      if (t.v === '(') { const e = expr(); if (!peek() || peek().v !== ')') throw new Error('A bracket “(” is not closed.'); i++; return e; }
      throw new Error(`Unexpected “${t.v}” in the formula.`);
    }
    const num = (x) => { const n = parseFloat(x); return isNaN(n) ? 0 : n; };
    const fn = expr();
    if (i < toks.length) throw new Error(`Unexpected “${toks[i].label || toks[i].v}” in the formula.`);
    const fields = toks.filter((t) => t.t === 'f').map((t) => t.label);
    const out = (vals) => { const r = fn(vals); return r == null || !isFinite(r) ? null : Math.round(r * 1e9) / 1e9; };
    out.fields = fields;
    return out;
  }

  // ---------- CSV ----------
  function csvCell(v, sep) {
    const s = v == null ? '' : String(v);
    return (s.includes(sep) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ---------- Download ----------
  function download(name, data, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  Object.assign(DC, { $, $$, h, esc, inFrame, toast, modal, ask, formDialog, ident, uniq, qi,
    fmtCurrency, fmtNumber, fmtDate, fmtValue, todayIso, parseNumber, parseDate, parseYesNo, compileFormula, csvCell, download, debounce });
})(window.DC);
