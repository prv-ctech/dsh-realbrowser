import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatPickedElementMessage,
  injectIntoChatTextarea,
  createClientPlugin,
} from '../src/client/index.js';

describe('Client Bridge', () => {
  it('formats picked element markdown context', () => {
    const formatted = formatPickedElementMessage({
      selector: '#submit-btn',
      tag: 'button',
      text: 'Submit Order',
    });
    expect(formatted).toBe('Element selected: `#submit-btn` (<button>: "Submit Order")');
  });

  it('formats picked element markdown context with xpath', () => {
    const formatted = formatPickedElementMessage({
      selector: '#submit-btn',
      tag: 'button',
      text: 'Submit Order',
      xpath: '//*[@id="submit-btn"]',
    });
    expect(formatted).toBe('Element selected: `#submit-btn` [XPath: `//*[@id="submit-btn"]`] (<button>: "Submit Order")');
  });

  describe('injectIntoChatTextarea', () => {
    let originalDocument: any;

    beforeEach(() => {
      originalDocument = (globalThis as any).document;
    });

    afterEach(() => {
      (globalThis as any).document = originalDocument;
    });

    it('returns false when textarea is not found', () => {
      (globalThis as any).document = {
        querySelector: vi.fn().mockReturnValue(null),
      };
      expect(injectIntoChatTextarea('some text')).toBe(false);
    });

    it('injects text into textarea and dispatches input event', () => {
      const dispatchedEvents: any[] = [];
      let focused = false;
      const fakeTextarea = {
        value: 'Existing text',
        dispatchEvent: (e: any) => dispatchedEvents.push(e),
        focus: () => { focused = true; },
      };

      (globalThis as any).document = {
        querySelector: vi.fn().mockReturnValue(fakeTextarea),
      };
      (globalThis as any).Event = class {
        type: string;
        bubbles: boolean;
        constructor(type: string, init?: any) {
          this.type = type;
          this.bubbles = !!init?.bubbles;
        }
      };

      const res = injectIntoChatTextarea('Appended text');
      expect(res).toBe(true);
      expect(fakeTextarea.value).toBe('Existing text\nAppended text');
      expect(focused).toBe(true);
      expect(dispatchedEvents.length).toBe(1);
      expect(dispatchedEvents[0].type).toBe('input');
      expect(dispatchedEvents[0].bubbles).toBe(true);
    });

    it('injects text into empty textarea without leading newline', () => {
      const fakeTextarea = {
        value: '',
        dispatchEvent: vi.fn(),
        focus: vi.fn(),
      };

      (globalThis as any).document = {
        querySelector: vi.fn().mockReturnValue(fakeTextarea),
      };
      (globalThis as any).Event = class {
        constructor() {}
      };

      const res = injectIntoChatTextarea('Initial text');
      expect(res).toBe(true);
      expect(fakeTextarea.value).toBe('Initial text');
    });
  });

  describe('createClientPlugin', () => {
    it('registers sidebar.view slot when slots service exists', () => {
      const host = { call: vi.fn() };
      const plugin = createClientPlugin(host);
      expect(plugin).toBeDefined();
      expect(typeof plugin.apply).toBe('function');

      const mockSlots = {
        inject: vi.fn((slotName, cb) => cb()),
        register: vi.fn(),
      };
      const ctx = {
        get: vi.fn((service) => (service === 'slots' ? mockSlots : undefined)),
      };

      plugin.apply(ctx);
      expect(ctx.get).toHaveBeenCalledWith('slots');
      expect(mockSlots.inject).toHaveBeenCalledWith('sidebar.view', expect.any(Function));
      expect(mockSlots.register).toHaveBeenCalledWith(
        { name: 'sidebar.view', id: 'realbrowser-panel' },
        expect.any(Function)
      );
    });

    it('does nothing if slots service is missing', () => {
      const host = { call: vi.fn() };
      const plugin = createClientPlugin(host);
      const ctx = { get: vi.fn().mockReturnValue(undefined) };

      expect(() => plugin.apply(ctx)).not.toThrow();
    });

    it('handles message events with iframe source validation and clipboard fallback', () => {
      let registeredComponent: any;
      const mockSlots = {
        inject: vi.fn((_name, cb) => cb()),
        register: vi.fn((_config, comp) => { registeredComponent = comp; }),
      };
      const host = { call: vi.fn().mockResolvedValue({ port: 9223 }) };
      const plugin = createClientPlugin(host);
      plugin.apply({ get: vi.fn().mockReturnValue(mockSlots) });

      let effectCallback: any;
      const mockIframeWindow = {};
      const mockIframeRef = { current: { contentWindow: mockIframeWindow } };

      const originalReact = (globalThis as any).React;
      const originalWindow = (globalThis as any).window;
      const originalDocument = (globalThis as any).document;

      const listeners: Record<string, Function> = {};
      (globalThis as any).window = {
        addEventListener: vi.fn((evt, cb) => { listeners[evt] = cb; }),
        removeEventListener: vi.fn((evt, _cb) => { delete listeners[evt]; }),
      };

      const writeTextMock = vi.fn();
      const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        configurable: true,
        writable: true,
      });

      (globalThis as any).React = {
        useState: vi.fn((init) => [init, vi.fn()]),
        useRef: vi.fn(() => mockIframeRef),
        useEffect: vi.fn((cb) => { effectCallback = cb; }),
        createElement: vi.fn(),
      };

      try {
        registeredComponent();
        expect(effectCallback).toBeDefined();
        const cleanup = effectCallback();
        expect(listeners['message']).toBeDefined();

        // 1. Message from wrong source should be ignored
        listeners['message']({
          source: {},
          data: {
            type: 'REALBROWSER_ELEMENT_PICKED',
            payload: { selector: '#test', tag: 'div', text: 'Hi' },
          },
        });
        expect(writeTextMock).not.toHaveBeenCalled();

        // 2. Message from valid source with textarea absent -> clipboard fallback
        (globalThis as any).document = {
          querySelector: vi.fn().mockReturnValue(null),
        };
        listeners['message']({
          source: mockIframeWindow,
          data: {
            type: 'REALBROWSER_ELEMENT_PICKED',
            payload: { selector: '#test', tag: 'div', text: 'Hi', xpath: '/html/body/div' },
          },
        });
        expect(writeTextMock).toHaveBeenCalledWith('Element selected: `#test` [XPath: `/html/body/div`] (<div>: "Hi")');

        // 3. Cleanup removes event listener
        cleanup();
        expect((globalThis as any).window.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
      } finally {
        (globalThis as any).React = originalReact;
        (globalThis as any).window = originalWindow;
        if (originalNavigatorDesc) {
          Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
        } else {
          delete (globalThis as any).navigator;
        }
        (globalThis as any).document = originalDocument;
      }
    });
  });
});
