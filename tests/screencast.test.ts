import { describe, expect, it, vi } from 'vitest';
import { ChromeController } from '../src/cdp/chrome-controller.js';

function recordingCdp() {
  const listeners = new Map<string, Function>();
  const send = vi.fn(async () => ({}));
  return {
    cdp: {
      send,
      on: (name: string, fn: Function) => (listeners.set(name, fn), () => listeners.delete(name)),
      close() {},
    } as any,
    send,
    emit: (name: string, params: unknown) => listeners.get(name)?.(params),
    listeners,
  };
}

describe('Chrome screencast', () => {
  it('keeps only the latest acknowledged screencast frame', async () => {
    const { cdp, send, emit } = recordingCdp();
    const controller = new ChromeController(cdp);
    await controller.startScreencast(1200, 800);

    emit('Page.screencastFrame', { data: Buffer.from('one').toString('base64'), sessionId: 7 });
    emit('Page.screencastFrame', { data: Buffer.from('two').toString('base64'), sessionId: 8 });
    await Promise.resolve();

    expect(send).toHaveBeenCalledWith('Page.startScreencast', {
      format: 'jpeg', quality: 90, maxWidth: 1200, maxHeight: 800, everyNthFrame: 1,
    });
    expect(send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 7 });
    expect(send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 8 });
    expect(controller.latestFrameAfter(0)?.data.toString()).toBe('two');
    const sequence = controller.latestFrameAfter(0)!.sequence;
    expect(controller.latestFrameAfter(sequence)).toBeNull();
  });

  it('stops once, clears the frame, and removes the listener', async () => {
    const { cdp, send, emit, listeners } = recordingCdp();
    const controller = new ChromeController(cdp);
    await controller.startScreencast(10.4, 20.6);
    emit('Page.screencastFrame', { data: Buffer.from('frame').toString('base64'), sessionId: 1 });

    await controller.stopScreencast();
    await controller.stopScreencast();

    expect(send).toHaveBeenCalledWith('Page.startScreencast', expect.objectContaining({ maxWidth: 10, maxHeight: 21 }));
    expect(send.mock.calls.filter(([method]) => method === 'Page.stopScreencast')).toHaveLength(1);
    expect(controller.latestFrameAfter(0)).toBeNull();
    expect(listeners.has('Page.screencastFrame')).toBe(false);
  });
});
