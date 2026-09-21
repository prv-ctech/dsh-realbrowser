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

  it('adds metadata and WebP attachments without changing the existing draft', async () => {
    const setDraft = vi.fn();
    const addAttachments = vi.fn().mockReturnValue(true);
    const createDrafts = vi.fn().mockReturnValue([
      { id: 'metadata-1', kind: 'file' },
      { id: 'image-1', kind: 'image' },
    ]);
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

    const files = createDrafts.mock.calls[0][1] as File[];
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ name: 'realbrowser-element.txt', type: 'text/plain' });
    expect(await files[0].text()).toBe(formatPickedElementDraft(pickedFixture()));
    expect(files[1]).toMatchObject({ name: 'realbrowser-element.webp', type: 'image/webp' });
    expect(addAttachments).toHaveBeenCalledWith(['metadata-1', 'image-1']);
    expect(setDraft).not.toHaveBeenCalled();
  });

  it('rejects missing Conversation integration', async () => {
    await expect(attachPickedElement({ get: () => undefined }, 'session-1', pickedFixture()))
      .rejects.toThrow('Conversation service is unavailable');
  });

  it('releases a rejected attachment without altering text', async () => {
    const setDraft = vi.fn();
    const releaseDraftAttachment = vi.fn();
    const conversation = {
      createDrafts: vi.fn().mockReturnValue([
        { id: 'metadata-1', kind: 'file' },
        { id: 'image-1', kind: 'image' },
      ]),
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

    expect(releaseDraftAttachment).toHaveBeenNthCalledWith(1, 'metadata-1');
    expect(releaseDraftAttachment).toHaveBeenNthCalledWith(2, 'image-1');
    expect(setDraft).not.toHaveBeenCalled();
  });
});
