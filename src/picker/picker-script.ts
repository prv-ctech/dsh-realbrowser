export function generatePickerScript(): string {
  return `
(function() {
  if (window.__REALBROWSER_PICKER_LOADED__) return;
  window.__REALBROWSER_PICKER_LOADED__ = true;

  let active = false;
  let overlay = null;

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = '__realbrowser_overlay__';
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.border = '2px solid #3b82f6';
    overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
    overlay.style.zIndex = '2147483647';
    overlay.style.transition = 'all 0.05s ease';
    overlay.style.display = 'none';
    document.documentElement.appendChild(overlay);
  }

  function escapeIdent(val) {
    return (window.CSS && CSS.escape) ? CSS.escape(val) : val;
  }

  function getSelector(el) {
    if (el.id) return '#' + escapeIdent(el.id);
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        selector += '#' + escapeIdent(el.id);
        path.unshift(selector);
        break;
      } else {
        if (el.classList && el.classList.length > 0) {
          selector += Array.from(el.classList).map(function(c) { return '.' + escapeIdent(c); }).join('');
        }
        let sib = el, nth = 1, hasSameSiblings = false;
        while (sib = sib.previousElementSibling) {
          if (sib.nodeName.toLowerCase() === el.nodeName.toLowerCase()) {
            nth++;
            hasSameSiblings = true;
          }
        }
        let nextSib = el;
        while (nextSib = nextSib.nextElementSibling) {
          if (nextSib.nodeName.toLowerCase() === el.nodeName.toLowerCase()) {
            hasSameSiblings = true;
            break;
          }
        }
        if (hasSameSiblings) selector += ":nth-of-type(" + nth + ")";
      }
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(' > ');
  }

  function getXPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.id) return '//*[@id="' + el.id + '"]';
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      if (el.id) {
        path.unshift('/*[@id="' + el.id + '"]');
        break;
      }
      let tag = el.nodeName.toLowerCase();
      let index = 1;
      let sib = el.previousElementSibling;
      while (sib) {
        if (sib.nodeName.toLowerCase() === tag) {
          index++;
        }
        sib = sib.previousElementSibling;
      }
      path.unshift(tag + '[' + index + ']');
      el = el.parentNode;
    }
    return path.length ? '/' + path.join('/') : '';
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'REALBROWSER_PICKER_ENABLE') {
      active = true;
      if (!overlay) createOverlay();
    } else if (e.data && e.data.type === 'REALBROWSER_PICKER_DISABLE') {
      active = false;
      if (overlay) overlay.style.display = 'none';
    }
  });

  document.addEventListener('mouseover', (e) => {
    if (!active || !overlay || e.target === overlay) return;
    const rect = e.target.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';
  }, true);

  document.addEventListener('click', (e) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    active = false;
    if (overlay) overlay.style.display = 'none';
    const target = e.target;
    const selector = getSelector(target);
    const xpath = getXPath(target);
    const tag = target.tagName.toLowerCase();
    const text = (target.innerText || target.textContent || '').trim().slice(0, 100);
    window.parent.postMessage({
      type: 'REALBROWSER_ELEMENT_PICKED',
      payload: { selector, xpath, tag, text }
    }, '*');
  }, true);
})();
`;
}
