import type { PickedElementResult } from '../browser/protocol.js';

export function formatPickedElementDraft(result: PickedElementResult): string {
  return [
    'Selected website element',
    `URL: ${result.url}`,
    `CSS: \`${result.selector}\``,
    `XPath: \`${result.xpath}\``,
    `Element: \`${result.html.slice(0, 4000)}\``,
  ].join('\n');
}

function metadataFile(result: PickedElementResult): File {
  return new File([formatPickedElementDraft(result)], 'realbrowser-element.txt', { type: 'text/plain' });
}

function webpFile(result: PickedElementResult): File {
  if (result.screenshotMediaType !== 'image/webp' || !result.screenshotBase64) {
    throw new Error('Selected element has no WebP screenshot');
  }
  const binary = atob(result.screenshotBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], 'realbrowser-element.webp', { type: 'image/webp' });
}

export async function attachPickedElement(
  ctx: any,
  sessionId: string,
  result: PickedElementResult,
): Promise<void> {
  const conversation = ctx?.get?.('conversation');
  if (!conversation) throw new Error('Conversation service is unavailable');
  if (!sessionId) throw new Error('Conversation session is unavailable');

  const drafts = conversation.createDrafts(sessionId, [metadataFile(result), webpFile(result)]);
  const ids = drafts?.map((draft: any) => draft?.id).filter((id: unknown) => typeof id === 'string');
  if (ids?.length !== 2) throw new Error('Conversation did not create the selected element attachments');

  let attached = false;
  let shell: any;
  try {
    shell = conversation.input?.shell?.(sessionId);
    if (!shell?.actions?.addAttachments) throw new Error('Conversation draft is unavailable');
    attached = shell.actions.addAttachments(ids) === true;
    if (!attached) throw new Error('Selected element attachments could not be added');
  } catch (error) {
    if (attached) {
      for (const id of ids) shell?.actions?.removeAttachment?.(id);
    }
    for (const id of ids) conversation.releaseDraftAttachment?.(id);
    throw error;
  }
}
