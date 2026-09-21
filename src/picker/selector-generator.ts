export interface ElementLike {
  id?: string;
  tagName: string;
  classList: string[];
  parentElement?: ElementLike | null;
  children?: ElementLike[];
  index?: number;
}

function escapeIdent(val: string): string {
  if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(val);
  }
  return val;
}

function getElementIndex(el: ElementLike): number | undefined {
  if (typeof el.index === 'number') {
    return el.index;
  }
  if (el.parentElement && Array.isArray(el.parentElement.children)) {
    const siblings = el.parentElement.children.filter(
      child => child.tagName.toLowerCase() === el.tagName.toLowerCase()
    );
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el);
      return idx >= 0 ? idx + 1 : undefined;
    }
  }
  return undefined;
}

export function getOptimalSelector(el: ElementLike): string {
  if (el.id && el.id.trim()) {
    return `#${escapeIdent(el.id.trim())}`;
  }

  const parts: string[] = [];
  let current: ElementLike | null | undefined = el;

  while (current) {
    if (current.id && current.id.trim()) {
      parts.unshift(`#${escapeIdent(current.id.trim())}`);
      break;
    }

    const tag = current.tagName.toLowerCase();
    const classes = current.classList.filter(Boolean).map(c => `.${escapeIdent(c)}`).join('');
    let part = `${tag}${classes}`;

    const index = getElementIndex(current);
    if (index !== undefined && index > 0) {
      part += `:nth-of-type(${index})`;
    }

    parts.unshift(part);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

export const getUniqueSelector = getOptimalSelector;

export function getXPath(target: string | ElementLike, index = 1): string {
  if (typeof target === 'string') {
    return `//${target.toLowerCase()}[${index}]`;
  }
  if (target.id && target.id.trim()) {
    return `//*[@id="${target.id.trim()}"]`;
  }
  const parts: string[] = [];
  let current: ElementLike | null | undefined = target;
  let hasId = false;
  while (current) {
    if (current.id && current.id.trim()) {
      parts.unshift(`*[@id="${current.id.trim()}"]`);
      hasId = true;
      break;
    }
    const tag = current.tagName.toLowerCase();
    const idx = getElementIndex(current) ?? 1;
    parts.unshift(`${tag}[${idx}]`);
    current = current.parentElement;
  }
  return parts.length ? `${hasId ? '//' : '/'}${parts.join('/')}` : '';
}
