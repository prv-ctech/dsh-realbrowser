import { describe, expect, it, vi } from 'vitest';
import { ChromeController } from '../src/cdp/chrome-controller.js';

function recordingCdp() {
  const listeners = new Map<string, Function>();
  const send = vi.fn(async (method: string) => {
    if (method === 'Page.getNavigationHistory') {
      return {
        currentIndex: 1,
        entries: [
          { id: 10, url: 'https://before.test', title: 'Before' },
          { id: 11, url: 'https://current.test', title: 'Current' },
          { id: 12, url: 'https://after.test', title: 'After' },
        ],
      };
    }
    return {};
  });
  return {
    cdp: {
      send,
      on: (name: string, fn: Function) => (listeners.set(name, fn), () => listeners.delete(name)),
      close() {},
    } as any,
    send,
    emit: (name: string, params: unknown = {}) => listeners.get(name)?.(params),
  };
}

describe('Chrome browser control', () => {
  it('initializes page domains and browser snapshot', async () => {
    const { cdp, send } = recordingCdp();
    const controller = new ChromeController(cdp);

    await controller.initialize();

    expect(send).toHaveBeenCalledWith('Page.enable');
    expect(send).toHaveBeenCalledWith('DOM.enable');
    expect(send).toHaveBeenCalledWith('Runtime.enable');
    expect(controller.getSnapshot()).toEqual({
      url: 'https://current.test',
      title: 'Current',
      loading: false,
      canGoBack: true,
      canGoForward: true,
    });
  });

  it('sets exact device metrics and rejects invalid dimensions', async () => {
    const { cdp, send } = recordingCdp();
    const controller = new ChromeController(cdp);
    await controller.setViewport({ width: 3840, height: 2160, deviceScaleFactor: 1, mobile: false });
    expect(send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({
      width: 3840,
      height: 2160,
      screenWidth: 3840,
      screenHeight: 2160,
      deviceScaleFactor: 1,
      mobile: false,
    }));
    await expect(controller.setViewport({ width: 1.5, height: 800, deviceScaleFactor: 1, mobile: false }))
      .rejects.toThrow('Viewport dimensions must be positive integers');
  });

  it('navigates real history and reloads', async () => {
    const { cdp, send } = recordingCdp();
    const controller = new ChromeController(cdp);
    await controller.goBack();
    await controller.goForward();
    await controller.reload();
    expect(send).toHaveBeenCalledWith('Page.navigateToHistoryEntry', { entryId: 10 });
    expect(send).toHaveBeenCalledWith('Page.navigateToHistoryEntry', { entryId: 12 });
    expect(send).toHaveBeenCalledWith('Page.reload', { ignoreCache: false });
  });

  it('dispatches mouse, wheel, key, and text input', async () => {
    const { cdp, send } = recordingCdp();
    const controller = new ChromeController(cdp);
    await controller.dispatchInput({ kind: 'mouse', type: 'mousePressed', x: 12, y: 24, button: 'left', clickCount: 1 });
    await controller.dispatchInput({ kind: 'wheel', x: 12, y: 24, deltaX: 0, deltaY: 90 });
    await controller.dispatchInput({ kind: 'key', type: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 0 });
    await controller.dispatchInput({ kind: 'text', text: 'hello' });
    expect(send).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({ type: 'mousePressed', x: 12, y: 24 }));
    expect(send).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseWheel', deltaY: 90 }));
    expect(send).toHaveBeenCalledWith('Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyDown', key: 'Enter' }));
    expect(send).toHaveBeenCalledWith('Input.insertText', { text: 'hello' });
  });

  it('tracks main-frame URL and loading state with disposable listeners', async () => {
    const { cdp, emit } = recordingCdp();
    const controller = new ChromeController(cdp);
    const seen: unknown[] = [];
    const off = controller.onSnapshot((snapshot) => seen.push(snapshot));

    emit('Page.frameStartedLoading');
    expect(controller.getSnapshot().loading).toBe(true);
    emit('Page.frameNavigated', { frame: { url: 'https://redirect.test/path' } });
    expect(controller.getSnapshot().url).toBe('https://redirect.test/path');
    emit('Page.frameNavigated', { frame: { parentId: 'main', url: 'https://child.test' } });
    expect(controller.getSnapshot().url).toBe('https://redirect.test/path');
    emit('Page.loadEventFired');
    expect(controller.getSnapshot().loading).toBe(false);

    const count = seen.length;
    off();
    emit('Page.frameStartedLoading');
    expect(seen).toHaveLength(count);
  });
});
