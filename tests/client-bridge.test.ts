import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatPickedElementMessage,
  injectIntoChatTextarea,
  createClientPlugin,
  normalizeHttpUrl,
} from '../src/client/index.js';

describe('normalizeHttpUrl', () => {
  it.each([
    ['youtube.com', 'https://youtube.com'],
    ['  google.com/search?q=dsh  ', 'https://google.com/search?q=dsh'],
    ['https://example.com/path', 'https://example.com/path'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['HTTPS://EXAMPLE.COM', 'HTTPS://EXAMPLE.COM'],
    ['', ''],
    ['   ', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeHttpUrl(input)).toBe(expected);
  });
});

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
    let originalWindow: any;

    beforeEach(() => {
      originalDocument = (globalThis as any).document;
      originalWindow = (globalThis as any).window;
    });

    afterEach(() => {
      (globalThis as any).document = originalDocument;
      (globalThis as any).window = originalWindow;
    });

    it('returns false when textarea is not found', () => {
      (globalThis as any).document = {
        querySelector: vi.fn().mockReturnValue(null),
      };
      expect(injectIntoChatTextarea('some text')).toBe(false);
    });

    it('injects text into textarea and dispatches input and change events', () => {
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
      expect(dispatchedEvents.length).toBe(2);
      expect(dispatchedEvents[0].type).toBe('input');
      expect(dispatchedEvents[0].bubbles).toBe(true);
      expect(dispatchedEvents[1].type).toBe('change');
      expect(dispatchedEvents[1].bubbles).toBe(true);
    });

    it('uses HTMLTextAreaElement.prototype setter when present', () => {
      let setterCalledWith = '';
      const fakeProto = {
        set value(val: string) {
          setterCalledWith = val;
        },
        get value() {
          return setterCalledWith;
        },
      };
      (globalThis as any).window = {
        HTMLTextAreaElement: {
          prototype: fakeProto,
        },
      };
      const fakeTextarea = Object.create(fakeProto);
      fakeTextarea.dispatchEvent = vi.fn();
      fakeTextarea.focus = vi.fn();

      (globalThis as any).document = {
        querySelector: vi.fn().mockReturnValue(fakeTextarea),
      };

      injectIntoChatTextarea('controlled text');
      expect(setterCalledWith).toBe('controlled text');
      expect(fakeTextarea.dispatchEvent).toHaveBeenCalledTimes(2);
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

    it('renders toolbar navigation buttons (Back, Forward, Reload) and wires click handlers', () => {
      let registeredComponent: any;
      const mockSlots = {
        inject: vi.fn((_name, cb) => cb()),
        register: vi.fn((_config, comp) => { registeredComponent = comp; }),
      };
      const host = { call: vi.fn().mockResolvedValue({ port: 9223 }) };
      const plugin = createClientPlugin(host);
      plugin.apply({ get: vi.fn().mockReturnValue(mockSlots) });

      const backMock = vi.fn();
      const forwardMock = vi.fn();
      const reloadMock = vi.fn();

      const mockIframeWindow = {
        history: { back: backMock, forward: forwardMock },
        location: { reload: reloadMock },
      };
      const mockIframeRef = { current: { contentWindow: mockIframeWindow } };

      const originalReact = (globalThis as any).React;
      const createdElements: any[] = [];
      (globalThis as any).React = {
        useState: vi.fn((init) => [init, vi.fn()]),
        useRef: vi.fn()
          .mockReturnValueOnce(mockIframeRef)
          .mockImplementation((initial: any) => ({ current: initial })),
        useEffect: vi.fn(),
        createElement: vi.fn((type, props, ...children) => {
          const el = { type, props, children };
          createdElements.push(el);
          return el;
        }),
      };

      try {
        const root = registeredComponent();
        expect(root).toBeDefined();

        // Find toolbar buttons by children text
        const backBtn = createdElements.find((el) => el.type === 'button' && el.children?.[0] === 'Back');
        const forwardBtn = createdElements.find((el) => el.type === 'button' && el.children?.[0] === 'Forward');
        const reloadBtn = createdElements.find((el) => el.type === 'button' && el.children?.[0] === 'Reload');

        expect(backBtn).toBeDefined();
        expect(forwardBtn).toBeDefined();
        expect(reloadBtn).toBeDefined();

        backBtn.props.onClick();
        expect(backMock).toHaveBeenCalled();

        forwardBtn.props.onClick();
        expect(forwardMock).toHaveBeenCalled();

        reloadBtn.props.onClick();
        expect(reloadMock).toHaveBeenCalled();
      } finally {
        (globalThis as any).React = originalReact;
      }
    });

    it('syncs URL via host.call and handles navigation', async () => {
      let registeredComponent: any;
      const mockSlots = {
        inject: vi.fn((_name, cb) => cb()),
        register: vi.fn((_config, comp) => { registeredComponent = comp; }),
      };
      const hostCalls: any[] = [];
      const host = {
        call: vi.fn((method, args) => {
          hostCalls.push({ method, args });
          if (method === 'realbrowser-get-proxy') return Promise.resolve({ port: 9223 });
          if (method === 'realbrowser-get-current-url') return Promise.resolve({ url: 'https://new-url.com' });
          if (method === 'realbrowser-navigate') return Promise.resolve({ ok: true });
          return Promise.resolve();
        }),
      };
      const plugin = createClientPlugin(host);
      plugin.apply({ get: vi.fn().mockReturnValue(mockSlots) });

      let effectCallback: any;
      const setUrlMock = vi.fn();
      const setInputUrlMock = vi.fn();
      const mockIframeRef = { current: null };
      let stateCall = 0;

      const originalReact = (globalThis as any).React;
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      const createdElements: any[] = [];
      (globalThis as any).React = {
        useState: vi.fn((init) => {
          const index = stateCall++;
          if (index === 0) return [init, setUrlMock];
          if (index === 1) return ['youtube.com', setInputUrlMock];
          return [init, vi.fn()];
        }),
        useRef: vi.fn()
          .mockReturnValueOnce(mockIframeRef)
          .mockImplementation((initial: any) => ({ current: initial })),
        useEffect: vi.fn((cb) => { effectCallback = cb; }),
        createElement: vi.fn((type, props, ...children) => {
          const el = { type, props, children };
          createdElements.push(el);
          return el;
        }),
      };

      try {
        registeredComponent();
        expect(effectCallback).toBeDefined();

        // Run effect
        const cleanup = effectCallback();
        expect(host.call).toHaveBeenCalledWith('realbrowser-get-current-url');

        // Both address-bar submission paths normalize a bare hostname.
        const addressInput = createdElements.find((el) => el.type === 'input');
        const goBtn = createdElements.find((el) => el.type === 'button' && el.children?.[0] === 'Go');
        expect(addressInput).toBeDefined();
        expect(goBtn).toBeDefined();
        host.call.mockClear();

        goBtn.props.onClick();
        addressInput.props.onKeyDown({ key: 'Enter' });

        expect(host.call).toHaveBeenCalledTimes(2);
        expect(host.call).toHaveBeenNthCalledWith(1, 'realbrowser-navigate', { url: 'https://youtube.com' });
        expect(host.call).toHaveBeenNthCalledWith(2, 'realbrowser-navigate', { url: 'https://youtube.com' });

        cleanup();
      } finally {
        (globalThis as any).React = originalReact;
        (globalThis as any).window = originalWindow;
      }
    });

    // Reported bug: typing a new URL snapped back to whatever URL the host last
    // reported. The poll compared the host URL against the CURRENT local URL, so
    // a stale/unchanged host value overwrote the user's navigation on every tick.
    it('does not let a delayed initial poll revert user navigation', async () => {
      let registeredComponent: any;
      const mockSlots = {
        inject: vi.fn((_name: string, cb: any) => cb()),
        register: vi.fn((_config: any, comp: any) => { registeredComponent = comp; }),
      };
      let resolveInitialUrl!: (value: { url: string }) => void;
      const initialUrl = new Promise<{ url: string }>((resolve) => { resolveInitialUrl = resolve; });
      let reportedUrl = 'https://example.com';
      let urlRequest = 0;
      const host = {
        call: vi.fn((method: string) => {
          if (method === 'realbrowser-get-current-url') {
            return urlRequest++ === 0 ? initialUrl : Promise.resolve({ url: reportedUrl });
          }
          return Promise.resolve({ ok: true });
        }),
      };
      const plugin = createClientPlugin(host);
      plugin.apply({ get: vi.fn().mockReturnValue(mockSlots) });

      let urlState = 'https://example.com';
      const setUrl = vi.fn((updater: any) => {
        urlState = typeof updater === 'function' ? updater(urlState) : updater;
      });
      const setInputUrl = vi.fn();

      let effectCallback: any;
      let poll: any = null;
      const mockIframeRef = { current: null };
      const createdElements: any[] = [];

      const originalReact = (globalThis as any).React;
      const originalWindow = (globalThis as any).window;
      const originalSetInterval = (globalThis as any).setInterval;
      const originalClearInterval = (globalThis as any).clearInterval;

      (globalThis as any).setInterval = vi.fn((cb: any) => { poll = cb; return 1; });
      (globalThis as any).clearInterval = vi.fn();
      (globalThis as any).window = { addEventListener: vi.fn(), removeEventListener: vi.fn() };

      let stateCall = 0;
      (globalThis as any).React = {
        useState: vi.fn((init: any) => {
          const index = stateCall++;
          if (index === 0) return ['https://example.com', setUrl];
          if (index === 1) return ['youtube.com', setInputUrl];
          return [init, vi.fn()];
        }),
        useRef: vi.fn()
          .mockReturnValueOnce(mockIframeRef)
          .mockImplementation((initial: any) => ({ current: initial })),
        useEffect: vi.fn((cb: any) => { effectCallback = cb; }),
        createElement: vi.fn((type: any, props: any, ...children: any[]) => {
          const element = { type, props, children };
          createdElements.push(element);
          return element;
        }),
      };

      const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

      try {
        registeredComponent();
        const cleanup = effectCallback();
        const goButton = createdElements.find((element) => element.type === 'button' && element.children?.[0] === 'Go');

        goButton.props.onClick();
        expect(urlState).toBe('https://youtube.com');

        resolveInitialUrl({ url: 'https://example.com' });
        await flush();
        expect(urlState).toBe('https://youtube.com');
        expect(setInputUrl).not.toHaveBeenCalledWith('https://example.com');

        // The host may report a redirect destination rather than the typed URL.
        reportedUrl = 'https://www.youtube.com/';
        poll();
        await flush();
        expect(urlState).toBe('https://www.youtube.com/');

        // Re-navigating must still clear pending state after the RPC completes.
        goButton.props.onClick();
        await flush();
        poll();
        await flush();

        reportedUrl = 'https://agent-driven.example';
        poll();
        await flush();
        expect(urlState).toBe('https://agent-driven.example');

        cleanup();
      } finally {
        (globalThis as any).React = originalReact;
        (globalThis as any).window = originalWindow;
        (globalThis as any).setInterval = originalSetInterval;
        (globalThis as any).clearInterval = originalClearInterval;
      }
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
        useRef: vi.fn()
          .mockReturnValueOnce(mockIframeRef)
          .mockImplementation((initial: any) => ({ current: initial })),
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
