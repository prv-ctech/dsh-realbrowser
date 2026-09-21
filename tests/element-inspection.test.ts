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

  it('inspects hover metadata without capturing an image', async () => {
    const { cdp, send } = elementCdpFake();
    const result = await new ChromeController(cdp).inspectElementAt(120, 80);
    expect(result.bounds).toEqual({ x: 100, y: 60, width: 180, height: 44 });
    expect(send).not.toHaveBeenCalledWith('Page.captureScreenshot', expect.anything());
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
