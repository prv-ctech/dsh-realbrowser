import { describe, expect, it, vi } from 'vitest';
import { ChromeController } from '../src/cdp/chrome-controller.js';

function elementCdpFake(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    'DOM.getNodeForLocation': { nodeId: 7 },
    'DOM.getBoxModel': { model: { border: [100, 60, 280, 60, 280, 104, 100, 104] } },
    'DOM.resolveNode': { object: { objectId: 'object-7' } },
    'Runtime.callFunctionOn': { result: { value: {
      selector: 'main > form#login > button[type="submit"]',
      xpath: '//*[@id="login"]/button[1]',
      tag: 'button',
      text: 'Sign in',
      html: '<button type="submit">Sign in</button>',
      url: 'https://example.test/login',
    } } },
    'Page.getLayoutMetrics': {
      cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 800, clientHeight: 600 },
    },
    'Page.captureScreenshot': { data: Buffer.from('webp').toString('base64') },
    'Runtime.releaseObject': {},
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
  it('returns metadata, bounds, and a clipped WebP screenshot', async () => {
    const { cdp, send } = elementCdpFake();
    const controller = new ChromeController(cdp);
    const result = await controller.pickElementAt(120, 80);

    expect(result).toMatchObject({
      selector: 'main > form#login > button[type="submit"]',
      xpath: '//*[@id="login"]/button[1]',
      tag: 'button',
      screenshotMediaType: 'image/webp',
      bounds: { x: 100, y: 60, width: 180, height: 44 },
    });
    expect(result.screenshotBase64).toBe(Buffer.from('webp').toString('base64'));
    expect(send).toHaveBeenCalledWith('DOM.getNodeForLocation', {
      x: 120, y: 80, includeUserAgentShadowDOM: true,
    });
    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', expect.objectContaining({
      format: 'webp',
      clip: { x: 100, y: 60, width: 180, height: 44, scale: 1 },
    }));
    expect(send).toHaveBeenCalledWith('Runtime.releaseObject', { objectId: 'object-7' });
  });

  it('clips oversized element screenshots to the visible viewport', async () => {
    const { cdp, send } = elementCdpFake({
      'DOM.getBoxModel': { model: { border: [0, 0, 800, 0, 800, 100000, 0, 100000] } },
    });

    await new ChromeController(cdp).pickElementAt(500, 500);

    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', expect.objectContaining({
      clip: { x: 0, y: 0, width: 800, height: 600, scale: 1 },
    }));
  });

  it('translates viewport coordinates and screenshot clips after scrolling', async () => {
    const { cdp, send } = elementCdpFake({
      'Page.getLayoutMetrics': {
        cssLayoutViewport: { pageX: 0, pageY: 50000, clientWidth: 800, clientHeight: 600 },
      },
      'DOM.getBoxModel': { model: { border: [40, 100, 200, 100, 200, 160, 40, 160] } },
    });

    await new ChromeController(cdp).pickElementAt(80, 130);

    expect(send).toHaveBeenCalledWith('DOM.getNodeForLocation', {
      x: 80,
      y: 50130,
      includeUserAgentShadowDOM: true,
    });
    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', expect.objectContaining({
      clip: { x: 40, y: 50100, width: 160, height: 60, scale: 1 },
    }));
  });

  it('inspects hover metadata without capturing an image', async () => {
    const { cdp, send } = elementCdpFake();
    const result = await new ChromeController(cdp).inspectElementAt(120, 80);
    expect(result.bounds).toEqual({ x: 100, y: 60, width: 180, height: 44 });
    expect(send).not.toHaveBeenCalledWith('Page.captureScreenshot', expect.anything());
  });

  it('sends a syntactically valid page metadata function', async () => {
    const { cdp, send } = elementCdpFake();
    await new ChromeController(cdp).inspectElementAt(120, 80);
    const call = send.mock.calls.find(([method]) => method === 'Runtime.callFunctionOn');
    expect(call?.[1].functionDeclaration).not.toContain('__name');
    expect(() => new Function(`return (${call?.[1].functionDeclaration})`)).not.toThrow();
  });

  it('uses backend node IDs returned by real Chrome', async () => {
    const { cdp, send } = elementCdpFake({ 'DOM.getNodeForLocation': { backendNodeId: 9 } });
    const result = await new ChromeController(cdp).inspectElementAt(120, 80);
    expect(result.selector).toContain('button');
    expect(send).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 9 });
    expect(send).toHaveBeenCalledWith('DOM.resolveNode', { backendNodeId: 9 });
  });

  it('rejects non-finite coordinates before calling CDP', async () => {
    const { cdp, send } = elementCdpFake();
    await expect(new ChromeController(cdp).inspectElementAt(Number.NaN, 1)).rejects.toThrow('finite');
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects when no DOM node is found', async () => {
    const { cdp } = elementCdpFake({ 'DOM.getNodeForLocation': {} });
    await expect(new ChromeController(cdp).inspectElementAt(1, 1)).rejects.toThrow('No element');
  });

  it('rejects missing and zero-size box models', async () => {
    const missing = elementCdpFake({ 'DOM.getBoxModel': { model: {} } });
    await expect(new ChromeController(missing.cdp).inspectElementAt(1, 1)).rejects.toThrow('bounds');

    const zero = elementCdpFake({
      'DOM.getBoxModel': { model: { border: [4, 4, 4, 4, 4, 4, 4, 4] } },
    });
    await expect(new ChromeController(zero.cdp).inspectElementAt(1, 1)).rejects.toThrow('positive size');
  });
});
