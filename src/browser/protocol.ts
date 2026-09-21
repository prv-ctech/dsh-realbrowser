export interface BrowserSnapshot {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
}

export interface ViewportMetrics {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
}

export type BrowserInput =
  | { kind: 'mouse'; type: 'mouseMoved' | 'mousePressed' | 'mouseReleased'; x: number; y: number; button?: 'left' | 'middle' | 'right'; clickCount?: number }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: 'key'; type: 'keyDown' | 'keyUp'; key: string; code: string; modifiers: number }
  | { kind: 'text'; text: string };

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PickedElementResult {
  selector: string;
  xpath: string;
  tag: string;
  text: string;
  html: string;
  url: string;
  bounds: ElementBounds;
  screenshotBase64: string;
  screenshotMediaType: 'image/webp';
}
