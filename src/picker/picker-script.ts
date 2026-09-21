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

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        selector += '#' + el.id;
        path.unshift(selector);
        break;
      } else {
        let sib = el, nth = 1;
        while (sib = sib.previousElementSibling) {
          if (sib.nodeName.toLowerCase() === selector) nth++;
        }
        if (nth !== 1) selector += ":nth-of-type(" + nth + ")";
      }
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(' > ');
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
    const tag = target.tagName.toLowerCase();
    const text = (target.innerText || target.textContent || '').trim().slice(0, 100);
    window.parent.postMessage({
      type: 'REALBROWSER_ELEMENT_PICKED',
      payload: { selector, tag, text }
    }, '*');
  }, true);
})();
`;
}
