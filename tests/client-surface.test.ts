import { describe, expect, it } from 'vitest';
import { pointerInputFromEvent } from '../src/client/index.js';

describe('browser surface input', () => {
  it('maps displayed pointer coordinates to CSS viewport coordinates', () => {
    expect(pointerInputFromEvent(
      { clientX: 260, clientY: 145, button: 0 },
      { left: 10, top: 20, width: 500, height: 250 },
      { width: 1920, height: 1080 },
      'mousePressed',
    )).toMatchObject({ kind: 'mouse', x: 960, y: 540, button: 'left' });
  });

  it('does not report a pressed button for pointer movement', () => {
    expect(pointerInputFromEvent(
      { clientX: 50, clientY: 50 },
      { left: 0, top: 0, width: 100, height: 100 },
      { width: 100, height: 100 },
      'mouseMoved',
    )).toEqual({ kind: 'mouse', type: 'mouseMoved', x: 50, y: 50 });
  });

  it('maps native mouse buttons', () => {
    expect(pointerInputFromEvent(
      { clientX: 0, clientY: 0, button: 2 },
      { left: 0, top: 0, width: 100, height: 100 },
      { width: 100, height: 100 },
      'mouseReleased',
    )).toMatchObject({ button: 'right', clickCount: 1 });
  });
});
