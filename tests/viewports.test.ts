import { describe, expect, it } from 'vitest';
import {
  VIEWPORT_GROUPS,
  mapPreviewPoint,
  resolveViewportMetrics,
} from '../src/browser/viewports.js';

describe('viewport profiles', () => {
  it('groups responsive, desktop, tablet, and mobile profiles', () => {
    expect(VIEWPORT_GROUPS.map((group) => group.label)).toEqual([
      'Screen Sizes',
      'Tablets',
      'Mobile',
    ]);
    expect(VIEWPORT_GROUPS[0].options[0].id).toBe('responsive');
    expect(resolveViewportMetrics('desktop-4k', { width: 800, height: 600 })).toMatchObject({
      width: 3840,
      height: 2160,
      deviceScaleFactor: 1,
      mobile: false,
    });
    expect(resolveViewportMetrics('surface-duo-unfolded', { width: 800, height: 600 })).toMatchObject({
      width: 1114,
      height: 720,
      mobile: true,
    });
  });

  it('uses live panel dimensions only for responsive mode', () => {
    expect(resolveViewportMetrics('responsive', { width: 901.8, height: 612.2 })).toEqual({
      width: 902,
      height: 612,
      deviceScaleFactor: 1,
      mobile: false,
    });
  });

  it('rejects non-finite responsive dimensions', () => {
    expect(() => resolveViewportMetrics('responsive', { width: Number.NaN, height: 600 })).toThrow(
      'Responsive viewport dimensions must be finite',
    );
  });

  it('maps scaled preview coordinates to CSS viewport coordinates', () => {
    expect(mapPreviewPoint(
      { x: 250, y: 125 },
      { width: 500, height: 250 },
      { width: 1920, height: 1080 },
    )).toEqual({ x: 960, y: 540 });
  });
});
