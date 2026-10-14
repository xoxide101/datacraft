/* Every slider gets a small box beside it to type the exact value. The box follows the slider and the slider follows the
   box (typing fires the same input and change events as dragging), so every panel works without changes. */
(function () {
  'use strict';
  const st = document.createElement('style');
  st.textContent = '.rt-wrap{display:flex;align-items:center;gap:6px;min-width:0}.rt-wrap>input[type=range]{flex:1;min-width:40px}'
    + '.rt-num{width:58px;flex:none;height:24px;padding:0 4px;font:inherit;font-size:12px;border:1px solid var(--line,#c8c8c8);border-radius:5px;background:var(--panel,#fff);color:var(--fg,inherit);text-align:right}'
    + '.rt-num:focus{outline:2px solid var(--accent,#2f6fdd);outline-offset:0}';
  document.head.append(st);
  const decimals = (r) => { const s = String(r.step || '1'); return s === 'any' ? 2 : (s.split('.')[1] || '').length; };
  function attach(r) {
    if (r.dataset.rt || r.closest('[data-rt-skip]')) return;
    r.dataset.rt = '1';
    const n = document.createElement('input');
    n.type = 'number'; n.className = 'rt-num'; n.min = r.min; n.max = r.max; n.step = r.step || '1';
    n.setAttribute('aria-label', (r.getAttribute('aria-label') || r.title || 'Value') + ' (type a number)'); n.title = 'Type a value';
    n.value = r.value; n.disabled = r.disabled;
    const wrap = document.createElement('span'); wrap.className = 'rt-wrap';
    if (r.style.width) { wrap.style.width = r.style.width; r.style.width = ''; }
    r.replaceWith(wrap); wrap.append(r, n);
    r.addEventListener('input', () => { if (document.activeElement !== n) n.value = r.value; });
    r.addEventListener('change', () => { if (document.activeElement !== n) n.value = r.value; });
    const commit = () => {
      let v = parseFloat(n.value); if (!isFinite(v)) { n.value = r.value; return; }
      const lo = r.min === '' ? -Infinity : +r.min, hi = r.max === '' ? Infinity : +r.max;
      v = Math.min(hi, Math.max(lo, v));
      // a typed value may sit between slider steps: keep it exact when the box allows it
      r.value = v; n.value = +v.toFixed(Math.max(decimals(r), 2));
      r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
    };
    n.addEventListener('change', commit);
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); n.select(); } e.stopPropagation(); });
  }
  const scan = (root) => { (root.querySelectorAll ? root.querySelectorAll('input[type=range]') : []).forEach(attach); };
  // keep boxes up to date when a slider's value or state is changed by code
  const refresh = () => document.querySelectorAll('input[type=range][data-rt]').forEach((r) => {
    const n = r.nextElementSibling; if (!n || !n.classList.contains('rt-num')) return;
    if (document.activeElement !== n && n.value !== r.value) n.value = r.value;
    n.disabled = r.disabled; n.min = r.min; n.max = r.max;
  });
  let t = null;
  new MutationObserver((list) => {
    list.forEach((m) => m.addedNodes.forEach((x) => { if (x.nodeType === 1) { if (x.matches && x.matches('input[type=range]')) attach(x); else scan(x); } }));
    clearTimeout(t); t = setTimeout(refresh, 60);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'disabled', 'min', 'max'] });
  document.addEventListener('pointerup', () => setTimeout(refresh, 0), true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan(document)); else scan(document);
})();
