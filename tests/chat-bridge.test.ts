import { describe, expect, it, vi } from 'vitest';
import { attachPickedElement, formatPickedElementDraft } from '../src/client/chat-bridge.js';
import type { PickedElementResult } from '../src/browser/protocol.js';

function pickedFixture(): PickedElementResult {
  return {
    selector: 'main > form#login > button[type="submit"]',
    xpath: '//*[@id="login"]/button[1]',
    tag: 'button',
    text: 'Sign in',
    html: '<button type="submit">Sign in</button>',
    url: 'https://example.com/path',
    bounds: { x: 1, y: 2, width: 3, height: 4 },
    screenshotBase64: Buffer.from('webp-bytes').toString('base64'),
    screenshotMediaType: 'image/webp',
  };
}

describe('picked element chat bridge', () => {
  it('formats compact model-readable metadata', () => {
    expect(formatPickedElementDraft(pickedFixture())).toBe([
      'Selected website element',
      'URL: https://example.com/path',
      'CSS: `main > form#login > button[type="submit"]`',
      'XPath: `//*[@id="login"]/button[1]`',
      'Element: `<button type="submit">Sign in</button>`',
    ].join('\n'));
  });

  it('preserves draft text and adds a WebP image attachment first', async () => {
    const order: string[] = [];
    const setDraft = vi.fn(() => order.push('text'));
    const addAttachments = vi.fn(() => (order.push('attachment'), true));
    const createDrafts = vi.fn().mockReturnValue([{ id: 'image-1', kind: 'image' }]);
    const conversation = {
      createDrafts,
      input: {
        shell: vi.fn().mockReturnValue({
          state: { getSnapshot: () => ({ draft: 'Existing note' }) },
          actions: { setDraft, addAttachments },
        }),
      },
    };
    const ctx = { get: vi.fn((name: string) => name === 'conversation' ? conversation : undefined) };

    await attachPickedElement(ctx, 'session-1', pickedFixture());

    expect(createDrafts).toHaveBeenCalledWith('session-1', [expect.objectContaining({
      name: 'realbrowser-element.webp',
      type: 'image/webp',
    })]);
    expect(addAttachments).toHaveBeenCalledWith(['image-1']);
    expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('Existing note\n\nSelected website element'));
    expect(order).toEqual(['attachment', 'text']);
  });

  it('rejects missing Conversation integration', async () => {
    await expect(attachPickedElement({ get: () => undefined }, 'session-1', pickedFixture()))
      .rejects.toThrow('Conversation service is unavailable');
  });

  it('releases a rejected attachment without altering text', async () => {
    const setDraft = vi.fn();
    const releaseDraftAttachment = vi.fn();
    const conversation = {
      createDrafts: vi.fn().mockReturnValue([{ id: 'image-1', kind: 'image' }]),
      releaseDraftAttachment,
      input: {
        shell: vi.fn().mockReturnValue({
          state: { getSnapshot: () => ({ draft: 'Existing note' }) },
          actions: { setDraft, addAttachments: vi.fn().mockReturnValue(false) },
        }),
      },
    };

    await expect(attachPickedElement(
      { get: (name: string) => name === 'conversation' ? conversation : undefined },
      'session-1',
      pickedFixture(),
    )).rejects.toThrow('could not be added');

    expect(releaseDraftAttachment).toHaveBeenCalledWith('image-1');
    expect(setDraft).not.toHaveBeenCalled();
  });
});
