import { describe, it, expect, afterEach } from 'vitest';
import { getOptimalSelector, getUniqueSelector, getXPath, ElementLike } from '../src/picker/selector-generator.js';
import { generatePickerScript } from '../src/picker/picker-script.js';

describe('Selector Generator', () => {
  it('prefers id when unique', () => {
    const selector = getOptimalSelector({
      id: 'main-nav',
      tagName: 'NAV',
      classList: ['navbar', 'flex'],
      parentElement: null,
    });
    expect(selector).toBe('#main-nav');
  });

  it('uses tag and class when id is missing', () => {
    const selector = getOptimalSelector({
      id: '',
      tagName: 'BUTTON',
      classList: ['btn-primary', 'submit-btn'],
      parentElement: null,
    });
    expect(selector).toBe('button.btn-primary.submit-btn');
  });

  it('handles tag only when id and classes are missing', () => {
    const selector = getOptimalSelector({
      id: '',
      tagName: 'DIV',
      classList: [],
      parentElement: null,
    });
    expect(selector).toBe('div');
  });

  it('getUniqueSelector aliases getOptimalSelector', () => {
    const selector = getUniqueSelector({
      id: 'login-btn',
      tagName: 'BUTTON',
      classList: [],
    });
    expect(selector).toBe('#login-btn');
  });

  it('generates xpath with default and specified index', () => {
    expect(getXPath('BUTTON')).toBe('//button[1]');
    expect(getXPath('DIV', 3)).toBe('//div[3]');
  });

  it('generates unique selectors for identical siblings using index', () => {
    const parent: ElementLike = {
      id: 'items-list',
      tagName: 'UL',
      classList: ['list'],
      parentElement: null,
    };
    const sibling1: ElementLike = {
      tagName: 'LI',
      classList: ['item'],
      parentElement: parent,
      index: 1,
    };
    const sibling2: ElementLike = {
      tagName: 'LI',
      classList: ['item'],
      parentElement: parent,
      index: 2,
    };

    const sel1 = getOptimalSelector(sibling1);
    const sel2 = getOptimalSelector(sibling2);

    expect(sel1).toBe('#items-list > li.item:nth-of-type(1)');
    expect(sel2).toBe('#items-list > li.item:nth-of-type(2)');
    expect(sel1).not.toBe(sel2);
  });

  it('generates unique selectors for identical siblings using parentElement children', () => {
    const parent: ElementLike = {
      tagName: 'DIV',
      classList: ['container'],
      parentElement: null,
    };
    const sibling1: ElementLike = {
      tagName: 'BUTTON',
      classList: ['action-btn'],
      parentElement: parent,
    };
    const sibling2: ElementLike = {
      tagName: 'BUTTON',
      classList: ['action-btn'],
      parentElement: parent,
    };
    parent.children = [sibling1, sibling2];

    const sel1 = getOptimalSelector(sibling1);
    const sel2 = getOptimalSelector(sibling2);

    expect(sel1).toBe('div.container > button.action-btn:nth-of-type(1)');
    expect(sel2).toBe('div.container > button.action-btn:nth-of-type(2)');
    expect(sel1).not.toBe(sel2);
  });

  it('walks up parentElement hierarchy until finding an element with id', () => {
    const grandparent: ElementLike = {
      id: 'modal-root',
      tagName: 'DIV',
      classList: ['modal'],
    };
    const parent: ElementLike = {
      tagName: 'SECTION',
      classList: ['modal-body'],
      parentElement: grandparent,
    };
    const child: ElementLike = {
      tagName: 'P',
      classList: ['text-desc'],
      parentElement: parent,
    };

    const selector = getOptimalSelector(child);
    expect(selector).toBe('#modal-root > section.modal-body > p.text-desc');
  });

  it('generates xpath for ElementLike objects with and without id', () => {
    const elWithId: ElementLike = {
      id: 'submit-button',
      tagName: 'BUTTON',
      classList: [],
    };
    expect(getXPath(elWithId)).toBe('//*[@id="submit-button"]');

    const parent: ElementLike = {
      id: 'form-wrapper',
      tagName: 'FORM',
      classList: [],
    };
    const elInForm: ElementLike = {
      tagName: 'INPUT',
      classList: [],
      parentElement: parent,
      index: 2,
    };
    expect(getXPath(elInForm)).toBe('//*[@id="form-wrapper"]/input[2]');
  });

  it('generates valid xpath syntax without double or triple slashes', () => {
    const grandparent: ElementLike = {
      tagName: 'HTML',
      classList: [],
    };
    const parent: ElementLike = {
      tagName: 'BODY',
      classList: [],
      parentElement: grandparent,
    };
    const child: ElementLike = {
      tagName: 'DIV',
      classList: [],
      parentElement: parent,
      index: 1,
    };

    const xpathNoId = getXPath(child);
    expect(xpathNoId).toBe('/html[1]/body[1]/div[1]');
    expect(xpathNoId).not.toMatch(/^\/{2,}/);
    expect(xpathNoId).not.toMatch(/\/{2,}/);

    const idGrandparent: ElementLike = {
      id: 'main-container',
      tagName: 'DIV',
      classList: [],
    };
    const idParent: ElementLike = {
      tagName: 'SECTION',
      classList: [],
      parentElement: idGrandparent,
    };
    const idChild: ElementLike = {
      tagName: 'P',
      classList: [],
      parentElement: idParent,
      index: 1,
    };

    const xpathWithId = getXPath(idChild);
    expect(xpathWithId).toBe('//*[@id="main-container"]/section[1]/p[1]');
    expect(xpathWithId).not.toContain('///');
    expect(xpathWithId).not.toMatch(/\/{3,}/);
  });

  describe('CSS Identifier Escaping', () => {
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      (globalThis as any).window = originalWindow;
    });

    it('escapes special characters in id and class when CSS.escape is available', () => {
      (globalThis as any).window = {
        CSS: {
          escape: (str: string) => str.replace(/([:.\$])/g, '\\$1'),
        },
      };

      const el: ElementLike = {
        id: 'user:name.first',
        tagName: 'INPUT',
        classList: ['col:12', 'w$full'],
      };

      expect(getOptimalSelector(el)).toBe('#user\\:name\\.first');

      const elNoId: ElementLike = {
        tagName: 'INPUT',
        classList: ['col:12'],
        parentElement: null,
      };
      expect(getOptimalSelector(elNoId)).toBe('input.col\\:12');
    });
  });
});

describe('Picker Script Generator', () => {
  it('generates client picker script with overlay and message handlers', () => {
    const script = generatePickerScript();
    expect(script).toContain('__REALBROWSER_PICKER_LOADED__');
    expect(script).toContain('__realbrowser_overlay__');
    expect(script).toContain('REALBROWSER_PICKER_ENABLE');
    expect(script).toContain('REALBROWSER_PICKER_DISABLE');
    expect(script).toContain('REALBROWSER_ELEMENT_PICKED');
  });

  it('includes xpath in REALBROWSER_ELEMENT_PICKED payload', () => {
    const script = generatePickerScript();
    expect(script).toContain('payload: { selector, xpath, tag, text }');
  });

  it('includes CSS.escape wrapper for identifiers', () => {
    const script = generatePickerScript();
    expect(script).toContain('CSS.escape');
  });

  it('includes in-script DOM getXPath helper that produces valid XPath syntax', () => {
    const script = generatePickerScript();
    expect(script).toContain('function getXPath(el)');
    expect(script).not.toContain("path.unshift('/*[@id=\"'");

    const extractXPathFn = new Function(`
      const Node = { ELEMENT_NODE: 1 };
      ${script.match(/function getXPath\(el\) \{[\s\S]*?\n  \}/)?.[0]};
      return getXPath;
    `)();

    const root = { nodeType: 1, id: 'app', nodeName: 'DIV', parentNode: null, previousElementSibling: null };
    const child = { nodeType: 1, id: '', nodeName: 'SPAN', parentNode: root, previousElementSibling: null };
    const xpathWithId = extractXPathFn(child);
    expect(xpathWithId).toBe('//*[@id="app"]/span[1]');
    expect(xpathWithId).not.toContain('///');
    expect(xpathWithId).not.toMatch(/\/{3,}/);

    const html = { nodeType: 1, id: '', nodeName: 'HTML', parentNode: null, previousElementSibling: null };
    const body = { nodeType: 1, id: '', nodeName: 'BODY', parentNode: html, previousElementSibling: null };
    const div = { nodeType: 1, id: '', nodeName: 'DIV', parentNode: body, previousElementSibling: null };
    const xpathNoId = extractXPathFn(div);
    expect(xpathNoId).toBe('/html[1]/body[1]/div[1]');
    expect(xpathNoId).not.toMatch(/^\/{2,}/);
    expect(xpathNoId).not.toMatch(/\/{2,}/);
  });
});
