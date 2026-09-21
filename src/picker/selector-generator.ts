export interface ElementLike {
  id?: string;
  tagName: string;
  classList: string[];
  parentElement?: ElementLike | null;
}

export function getOptimalSelector(el: ElementLike): string {
  if (el.id && el.id.trim()) {
    return `#${el.id.trim()}`;
  }
  const tag = el.tagName.toLowerCase();
  const classes = el.classList.filter(Boolean).map(c => `.${c}`).join('');
  return `${tag}${classes}`;
}

export const getUniqueSelector = getOptimalSelector;

export function getXPath(tagName: string, index = 1): string {
  return `//${tagName.toLowerCase()}[${index}]`;
}
