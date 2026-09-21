import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RealBrowserPanel,
  createClientPlugin,
  normalizeHttpUrl,
} from '../src/client/index.js';

describe('client helpers', () => {
  it.each([
    ['youtube.com', 'https://youtube.com'],
    ['  google.com/search?q=dsh  ', 'https://google.com/search?q=dsh'],
    ['https://example.com/path', 'https://example.com/path'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeHttpUrl(input)).toBe(expected);
  });

});

describe('RealBrowserPanel', () => {
  const originalReact = (globalThis as any).React;

  afterEach(() => {
    (globalThis as any).React = originalReact;
  });

  function render(host = { call: vi.fn().mockResolvedValue({}) }) {
    const created: any[] = [];
    (globalThis as any).React = {
      useState: vi.fn((initial: any) => [initial, vi.fn()]),
      useRef: vi.fn((initial: any) => ({ current: initial })),
      useEffect: vi.fn(),
      createElement: vi.fn((type: any, props: any, ...children: any[]) => {
        const element = { type, props: props ?? {}, children };
        created.push(element);
        return element;
      }),
    };
    const root = RealBrowserPanel({ host, visible: false, scope: { sessionId: 'session-1' } });
    return { root, created, host };
  }

  it('renders native toolbar controls, grouped viewports, and image surface', () => {
    const { created } = render();
    const button = (label: string) => created.find((element) =>
      element.type === 'button' && element.props['aria-label'] === label);

    expect(button('Back')).toBeDefined();
    expect(button('Forward')).toBeDefined();
    expect(button('Reload')).toBeDefined();
    expect(button('Back').props.title).toBe('Back');
    expect(button('Back').props.disabled).toBe(true);
    expect(created.filter((element) => element.type === 'optgroup').map((group) => group.props.label))
      .toEqual(['Screen Sizes', 'Tablets', 'Mobile']);
    expect(created.some((element) => element.type === 'iframe')).toBe(false);
    const image = created.find((element) => element.type === 'img');
    expect(image).toBeDefined();
    expect(image.props.tabIndex).toBe(0);
    expect(created.find((element) => element.type === 'select').props['aria-label']).toBe('Viewport');
  });

  it('sends host navigation commands', () => {
    const { created, host } = render();
    const button = (label: string) => created.find((element) =>
      element.type === 'button' && element.props['aria-label'] === label);

    button('Back').props.onClick();
    button('Forward').props.onClick();
    button('Reload').props.onClick();

    expect(host.call).toHaveBeenNthCalledWith(1, 'realbrowser-command', { command: 'back' });
    expect(host.call).toHaveBeenNthCalledWith(2, 'realbrowser-command', { command: 'forward' });
    expect(host.call).toHaveBeenNthCalledWith(3, 'realbrowser-command', { command: 'reload' });
  });

  it('throttles picker hover requests and selects through host RPC', async () => {
    const created: any[] = [];
    let resolveHover!: (value: unknown) => void;
    const hover = new Promise((resolve) => { resolveHover = resolve; });
    const host = {
      call: vi.fn((method: string) => {
        if (method === 'realbrowser-hover-element') return hover;
        if (method === 'realbrowser-pick-element') return Promise.resolve({
          selector: '#picked', xpath: '//*[@id="picked"]', tag: 'div', text: '', html: '<div id="picked"></div>',
          url: 'https://example.test', bounds: { x: 10, y: 10, width: 20, height: 20 },
          screenshotBase64: Buffer.from('webp').toString('base64'), screenshotMediaType: 'image/webp',
        });
        return Promise.resolve({});
      }),
    };
    let stateIndex = 0;
    let refIndex = 0;
    const surface = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 500, height: 250 }) };
    const preview = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 250 }), scrollLeft: 0, scrollTop: 0 };
    (globalThis as any).React = {
      useState: vi.fn((initial: any) => {
        const index = stateIndex++;
        if (index === 3) return ['blob:frame', vi.fn()];
        if (index === 4) return [true, vi.fn()];
        return [initial, vi.fn()];
      }),
      useRef: vi.fn((initial: any) => {
        const index = refIndex++;
        return { current: index === 0 ? surface : index === 1 ? preview : initial };
      }),
      useEffect: vi.fn(),
      createElement: vi.fn((type: any, props: any, ...children: any[]) => {
        const element = { type, props: props ?? {}, children };
        created.push(element);
        return element;
      }),
    };

    RealBrowserPanel({ host, visible: false, scope: { sessionId: 'session-1' } });
    const image = created.find((element) => element.type === 'img');
    const event = { clientX: 260, clientY: 145, button: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    image.props.onMouseMove(event);
    const pickerButton = created.find((element) => element.type === 'button' && element.props['aria-pressed'] === true);
    pickerButton.props.onClick();
    image.props.onMouseMove(event);
    expect(host.call.mock.calls.filter(([method]) => method === 'realbrowser-hover-element')).toHaveLength(1);
    resolveHover({ bounds: { x: 10, y: 10, width: 20, height: 20 } });
    await Promise.resolve();

    image.props.onClick(event);
    expect(host.call).toHaveBeenCalledWith('realbrowser-pick-element', expect.any(Object));
  });

  it('registers a sidebar component that preserves Better Sidebar props', () => {
    let component: any;
    const slots = {
      inject: vi.fn((_name: string, callback: Function) => callback()),
      register: vi.fn((config: any, value: any) => { if (config.id === 'realbrowser-panel') component = value; }),
    };
    const host = { call: vi.fn().mockResolvedValue({}) };
    createClientPlugin(host).apply({
      get: (name: string) => name === 'slots' ? slots : undefined,
      inject: vi.fn(),
    });

    const { created } = (() => {
      const created: any[] = [];
      (globalThis as any).React = {
        useState: vi.fn((initial: any) => [initial, vi.fn()]),
        useRef: vi.fn((initial: any) => ({ current: initial })),
        useEffect: vi.fn(),
        createElement: vi.fn((type: any, props: any, ...children: any[]) => {
          const element = { type, props: props ?? {}, children };
          created.push(element);
          return element;
        }),
      };
      component({ visible: false, scope: { sessionId: 'session-9' } });
      return { created };
    })();

    expect(created.some((element) => element.type === 'img')).toBe(true);
  });
});
