import { describe, expect, it, vi } from 'vitest';
import { ChromeController } from '../src/cdp/chrome-controller.js';

function elementCdpFake(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    'Runtime.evaluate': {
      result: { value: {
        selector: '#sign-in',
        xpath: '//*[@id="sign-in"]',
        tag: 'a',
        text: 'Sign in',
        html: '<a id="sign-in">Sign in</a>',
        url: 'https://example.test/',
        bounds: { x: 361, y: 8.5, width: 75, height: 40 },
      } },
    },
    'Page.getLayoutMetrics': {
      cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 800, clientHeight: 600 },
    },
    'Page.captureScreenshot': { data: Buffer.from('webp').toString('base64') },
  };
  const listeners = new Map<string, Function>();
  const send = vi.fn(async (method: string) => overrides[method] ?? defaults[method] ?? {});
  return {
    cdp: {
      send,
      on: (name: string, fn: Function) => (listeners.set(name, fn), () => listeners.delete(name)),
      close() {},
    } as any,
    send,
  };
}

describe('element inspection', () => {
  it('returns metadata, viewport bounds, and a clipped WebP screenshot', async () => {
    const { cdp, send } = elementCdpFake();
    const controller = new ChromeController(cdp);
    const result = await controller.pickElementAt(120, 80);

    expect(result).toMatchObject({
      selector: '#sign-in',
      xpath: '//*[@id="sign-in"]',
      tag: 'a',
      screenshotMediaType: 'image/webp',
      bounds: { x: 361, y: 8.5, width: 75, height: 40 },
    });
    expect(result.screenshotBase64).toBe(Buffer.from('webp').toString('base64'));
    const evaluate = send.mock.calls.find(([method]) => method === 'Runtime.evaluate');
    expect(evaluate?.[1]).toMatchObject({ returnByValue: true });
    expect(evaluate?.[1].expression).toContain('document.elementFromPoint');
    expect(evaluate?.[1].expression).toContain('shadowRoot.elementFromPoint');
    expect(send).not.toHaveBeenCalledWith('DOM.getNodeForLocation', expect.anything());
    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', expect.objectContaining({
      format: 'webp',
      clip: { x: 361, y: 8.5, width: 75, height: 40, scale: 1 },
    }));
  });

  it('clips oversized element screenshots to the visible viewport', async () => {
    const { cdp, send } = elementCdpFake({
      'Runtime.evaluate': { result: { value: {
        selector: 'body', xpath: 'body', tag: 'body', text: '', html: '<body></body>',
        url: 'https://example.test/', bounds: { x: 0, y: 0, width: 800, height: 100000 },
      } } },
    });

    await new ChromeController(cdp).pickElementAt(500, 500);

    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', expect.objectContaining({
      clip: { x: 0, y: 0, width: 800, height: 600, scale: 1 },
    }));
  });

  it('adds page offsets only when capturing a viewport-relative element', async () => {
    const { cdp, send } = elementCdpFake({
      'Page.getLayoutMetrics': {
        cssLayoutViewport: { pageX: 0, pageY: 50000, clientWidth: 800, clientHeight: 600 },
      },
      'Runtime.evaluate': { result: { value: {
        selector: '#target', xpath: '//*[@id="target"]', tag: 'button', text: 'Target',
        html: '<button id="target">Target</button>', url: 'https://example.test/',
        bounds: { x: 40, y: 100, width: 160, height: 60 },
      } } },
    });

    await new ChromeController(cdp).pickElementAt(80, 130);

    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', expect.objectContaining({
      clip: { x: 40, y: 50100, width: 160, height: 60, scale: 1 },
    }));
  });

  it('inspects hover metadata without capturing an image', async () => {
    const { cdp, send } = elementCdpFake();
    const result = await new ChromeController(cdp).inspectElementAt(120, 80);
    expect(result.bounds).toEqual({ x: 361, y: 8.5, width: 75, height: 40 });
    expect(send).not.toHaveBeenCalledWith('Page.captureScreenshot', expect.anything());
  });

  it('sends a syntactically valid page hit-test expression', async () => {
    const { cdp, send } = elementCdpFake();
    await new ChromeController(cdp).inspectElementAt(120, 80);
    const call = send.mock.calls.find(([method]) => method === 'Runtime.evaluate');
    expect(call?.[1].expression).not.toContain('__name');
    expect(() => new Function(`return (${call?.[1].expression})`)).not.toThrow();
  });

  it('rejects non-finite coordinates before calling CDP', async () => {
    const { cdp, send } = elementCdpFake();
    await expect(new ChromeController(cdp).inspectElementAt(Number.NaN, 1)).rejects.toThrow('finite');
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects when the page hit test returns null', async () => {
    const { cdp } = elementCdpFake({ 'Runtime.evaluate': { result: { value: null } } });
    await expect(new ChromeController(cdp).inspectElementAt(1, 1)).rejects.toThrow('No element');
  });

  it('rejects missing and zero-size bounds', async () => {
    const missing = elementCdpFake({
      'Runtime.evaluate': { result: { value: {
        selector: 'body', xpath: 'body', tag: 'body', text: '', html: '', url: '',
      } } },
    });
    await expect(new ChromeController(missing.cdp).inspectElementAt(1, 1)).rejects.toThrow('bounds');

    const zero = elementCdpFake({
      'Runtime.evaluate': { result: { value: {
        selector: 'body', xpath: 'body', tag: 'body', text: '', html: '', url: '',
        bounds: { x: 4, y: 4, width: 0, height: 0 },
      } } },
    });
    await expect(new ChromeController(zero.cdp).inspectElementAt(1, 1)).rejects.toThrow('positive size');
  });
});
