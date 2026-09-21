import type { ViewportMetrics } from './protocol.js';

export interface ViewportOption extends ViewportMetrics {
  id: string;
  label: string;
}

export interface ViewportGroup {
  label: 'Screen Sizes' | 'Tablets' | 'Mobile';
  options: readonly ViewportOption[];
}

export const VIEWPORT_GROUPS: readonly ViewportGroup[] = [
  {
    label: 'Screen Sizes',
    options: [
      { id: 'responsive', label: 'Responsive', width: 0, height: 0, deviceScaleFactor: 1, mobile: false },
      { id: 'desktop-1080p', label: 'Full HD — 1920 × 1080', width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
      { id: 'desktop-1080p-wide', label: 'Full HD Ultrawide — 2560 × 1080', width: 2560, height: 1080, deviceScaleFactor: 1, mobile: false },
      { id: 'desktop-2k', label: '2K QHD — 2560 × 1440', width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false },
      { id: 'desktop-2k-wide', label: '2K QHD Ultrawide — 3440 × 1440', width: 3440, height: 1440, deviceScaleFactor: 1, mobile: false },
      { id: 'desktop-4k', label: '4K UHD — 3840 × 2160', width: 3840, height: 2160, deviceScaleFactor: 1, mobile: false },
      { id: 'desktop-4k-wide', label: '4K Ultrawide — 5120 × 2160', width: 5120, height: 2160, deviceScaleFactor: 1, mobile: false },
    ],
  },
  {
    label: 'Tablets',
    options: [
      { id: 'ipad-10', label: 'iPad 10th gen — 820 × 1180', width: 820, height: 1180, deviceScaleFactor: 2, mobile: true },
      { id: 'ipad-air-11', label: 'iPad Air 11 — 820 × 1180', width: 820, height: 1180, deviceScaleFactor: 2, mobile: true },
      { id: 'ipad-pro-11', label: 'iPad Pro 11 — 834 × 1194', width: 834, height: 1194, deviceScaleFactor: 2, mobile: true },
      { id: 'ipad-pro-13', label: 'iPad Pro 13 — 1032 × 1376', width: 1032, height: 1376, deviceScaleFactor: 2, mobile: true },
      { id: 'galaxy-tab-s9', label: 'Galaxy Tab S9 — 800 × 1280', width: 800, height: 1280, deviceScaleFactor: 2, mobile: true },
      { id: 'xiaomi-pad-6', label: 'Xiaomi Pad 6 — 900 × 1440', width: 900, height: 1440, deviceScaleFactor: 2, mobile: true },
    ],
  },
  {
    label: 'Mobile',
    options: [
      { id: 'iphone-16-pro', label: 'iPhone 16 Pro — 402 × 874', width: 402, height: 874, deviceScaleFactor: 3, mobile: true },
      { id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max — 440 × 956', width: 440, height: 956, deviceScaleFactor: 3, mobile: true },
      { id: 'surface-duo-folded', label: 'Surface Duo Folded — 540 × 720', width: 540, height: 720, deviceScaleFactor: 2.5, mobile: true },
      { id: 'surface-duo-unfolded', label: 'Surface Duo Unfolded — 1114 × 720', width: 1114, height: 720, deviceScaleFactor: 2.5, mobile: true },
      { id: 'galaxy-z-fold-6-cover', label: 'Galaxy Z Fold 6 Cover — 402 × 968', width: 402, height: 968, deviceScaleFactor: 3, mobile: true },
      { id: 'galaxy-z-fold-6-open', label: 'Galaxy Z Fold 6 Open — 882 × 1104', width: 882, height: 1104, deviceScaleFactor: 2.5, mobile: true },
      { id: 'galaxy-z-flip-6', label: 'Galaxy Z Flip 6 — 360 × 880', width: 360, height: 880, deviceScaleFactor: 3, mobile: true },
      { id: 'galaxy-s24-ultra', label: 'Galaxy S24 Ultra — 480 × 1023', width: 480, height: 1023, deviceScaleFactor: 3, mobile: true },
      { id: 'pixel-9-pro', label: 'Pixel 9 Pro — 412 × 915', width: 412, height: 915, deviceScaleFactor: 3, mobile: true },
      { id: 'xiaomi-14', label: 'Xiaomi 14 — 393 × 873', width: 393, height: 873, deviceScaleFactor: 3, mobile: true },
    ],
  },
];

export function resolveViewportMetrics(
  id: string,
  responsiveSize: Pick<ViewportMetrics, 'width' | 'height'>,
): ViewportMetrics {
  if (id === 'responsive') {
    if (!Number.isFinite(responsiveSize.width) || !Number.isFinite(responsiveSize.height)) {
      throw new Error('Responsive viewport dimensions must be finite');
    }
    return {
      width: Math.max(1, Math.round(responsiveSize.width)),
      height: Math.max(1, Math.round(responsiveSize.height)),
      deviceScaleFactor: 1,
      mobile: false,
    };
  }

  const option = VIEWPORT_GROUPS.flatMap((group) => group.options).find((entry) => entry.id === id);
  if (!option) throw new Error(`Unknown viewport: ${id}`);
  return {
    width: option.width,
    height: option.height,
    deviceScaleFactor: option.deviceScaleFactor,
    mobile: option.mobile,
  };
}

export function mapPreviewPoint(
  point: { x: number; y: number },
  preview: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.min(viewport.width, Math.max(0, point.x * viewport.width / preview.width)),
    y: Math.min(viewport.height, Math.max(0, point.y * viewport.height / preview.height)),
  };
}
