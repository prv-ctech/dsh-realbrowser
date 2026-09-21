import { describe, it, expect } from 'vitest';
import { getOptimalSelector, getUniqueSelector, getXPath } from '../src/picker/selector-generator.js';
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
});
