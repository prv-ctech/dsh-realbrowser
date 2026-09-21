# RealBrowser v0.0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the proxy iframe with one interactive CDP Chrome page, add accurate grouped viewport presets, reliable browser controls, DSH-native styling, and selected-element chat attachments.

**Architecture:** `ChromeController` becomes the source of truth for page state, input, viewport emulation, screencast frames, history, and element inspection. The host exposes small private RPC controls plus one raw frame endpoint; the Better Sidebar client displays scaled frames and uses the session-scoped Conversation service for draft text and WebP attachments.

**Tech Stack:** TypeScript, React via `React.createElement`, Cordis/DSH Host and Client services, Chrome DevTools Protocol, Node HTTP, Vitest, esbuild.

**Spec:** `docs/superpowers/specs/2026-09-21-realbrowser-v0.0.1-design.md`

## Global Constraints

- One Chrome target remains shared by the plugin.
- The visible panel must not use the proxy iframe.
- Fixed dimensions are CSS viewport pixels; preview scaling must not change page metrics.
- Keep Responsive first under Screen Sizes.
- Use Screen Sizes, Tablets, and Mobile `optgroup` labels.
- No new runtime or UI dependency.
- Use DSH theme tokens and accessible native controls.
- Preserve existing agent tools and the local `tauri` profile link.
- Selected-element screenshot format is WebP.
- The pick result must remain a draft; never auto-submit chat.
- Version is `0.0.1`; release is committed and tagged locally without push.

---

### Task 1: Shared Browser Protocol and Viewport Catalog

**Files:**
- Create: `src/browser/protocol.ts`
- Create: `src/browser/viewports.ts`
- Create: `tests/viewports.test.ts`
- Modify: `src/index.ts:1-7`

**Interfaces:**
- Produces: `BrowserSnapshot`, `ViewportMetrics`, `BrowserInput`, `ElementBounds`, `PickedElementResult` in `src/browser/protocol.ts`.
- Produces: `VIEWPORT_GROUPS`, `resolveViewportMetrics(id, responsiveSize)`, and `mapPreviewPoint(point, preview, viewport)` in `src/browser/viewports.ts`.
- Later tasks must import these definitions instead of duplicating wire shapes.

- [ ] **Step 1: Write failing catalog and geometry tests**

```ts
// tests/viewports.test.ts
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

  it('maps scaled preview coordinates to CSS viewport coordinates', () => {
    expect(mapPreviewPoint(
      { x: 250, y: 125 },
      { width: 500, height: 250 },
      { width: 1920, height: 1080 },
    )).toEqual({ x: 960, y: 540 });
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `npx vitest run tests/viewports.test.ts`

Expected: FAIL because `src/browser/viewports.ts` does not exist.

- [ ] **Step 3: Add exact shared protocol types**

```ts
// src/browser/protocol.ts
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
```

- [ ] **Step 4: Add the catalog and coordinate conversion**

Implement `src/browser/viewports.ts` with the exact profiles from the spec. Use this shape:

```ts
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
```

`resolveViewportMetrics` must reject unknown IDs and clamp responsive width/height to positive rounded integers. `mapPreviewPoint` must clamp points to the viewport bounds.

- [ ] **Step 5: Export, test, and commit**

Add exports to `src/index.ts`, then run:

```bash
npx vitest run tests/viewports.test.ts
npm run build
git add src/browser src/index.ts tests/viewports.test.ts
git commit -m "feat: add browser viewport profiles"
```

Expected: all commands PASS.

---

### Task 2: CDP Event Subscriptions

**Files:**
- Modify: `src/cdp/cdp-client.ts:7-65`
- Modify: `tests/cdp-client.test.ts:30-117`

**Interfaces:**
- Consumes: existing `CDPClient.send()` transport.
- Produces: `CDPClient.on(method: string, listener: (params: any) => void): () => void`.
- Event callbacks must not intercept response messages and one throwing callback must not stop other callbacks.

- [ ] **Step 1: Add failing event tests**

Add tests which send a server event after connection:

```ts
it('delivers CDP events and disposes subscriptions', async () => {
  const client = new CDPClient();
  await client.connect(wsUrl);
  const seen: unknown[] = [];
  const off = client.on('Page.frameNavigated', (params) => seen.push(params));
  const socket = [...wss.clients][0];

  socket.send(JSON.stringify({ method: 'Page.frameNavigated', params: { frame: { url: 'https://one.test' } } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(seen).toEqual([{ frame: { url: 'https://one.test' } }]);

  off();
  socket.send(JSON.stringify({ method: 'Page.frameNavigated', params: { frame: { url: 'https://two.test' } } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(seen).toHaveLength(1);
  client.close();
});
```

Add a second test with two listeners where the first throws and the second still records the event.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run tests/cdp-client.test.ts`

Expected: FAIL with `client.on is not a function`.

- [ ] **Step 3: Implement minimal listener dispatch**

Add a `Map<string, Set<(params: any) => void>>`. In the WebSocket message handler, preserve current response handling, then dispatch messages with a string `method`. Return an idempotent disposer from `on`. Catch listener exceptions so the socket handler survives.

```ts
on(method: string, listener: (params: any) => void): () => void {
  let listeners = this.listeners.get(method);
  if (!listeners) this.listeners.set(method, listeners = new Set());
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) this.listeners.delete(method);
  };
}
```

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run tests/cdp-client.test.ts
npm run build
git add src/cdp/cdp-client.ts tests/cdp-client.test.ts
git commit -m "feat: expose CDP events"
```

Expected: PASS.

---

### Task 3: Chrome Navigation, Viewport, and Input Control

**Files:**
- Modify: `src/cdp/chrome-controller.ts:130-304`
- Create: `tests/chrome-browser-control.test.ts`

**Interfaces:**
- Consumes: `BrowserInput`, `BrowserSnapshot`, and `ViewportMetrics`; `CDPClient.on()` from Task 2.
- Produces:
  - `initialize(): Promise<void>`
  - `getSnapshot(): BrowserSnapshot`
  - `onSnapshot(listener): () => void`
  - `setViewport(metrics: ViewportMetrics): Promise<void>`
  - `goBack(): Promise<void>`
  - `goForward(): Promise<void>`
  - `reload(): Promise<void>`
  - `dispatchInput(input: BrowserInput): Promise<void>`

- [ ] **Step 1: Write failing controller tests with one recording CDP fake**

```ts
// tests/chrome-browser-control.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ChromeController } from '../src/cdp/chrome-controller.js';

function recordingCdp() {
  const listeners = new Map<string, Function>();
  const send = vi.fn(async (method: string) => {
    if (method === 'Page.getNavigationHistory') {
      return { currentIndex: 1, entries: [{ id: 10 }, { id: 11 }, { id: 12 }] };
    }
    return {};
  });
  return {
    cdp: { send, on: (name: string, fn: Function) => (listeners.set(name, fn), () => listeners.delete(name)), close() {} } as any,
    send,
    emit: (name: string, params: unknown) => listeners.get(name)?.(params),
  };
}

describe('Chrome browser control', () => {
  it('sets exact device metrics', async () => {
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
});
```

Add a snapshot test that emits `Page.frameNavigated`, `Page.loadEventFired`, and `Page.frameStartedLoading`, then verifies URL/loading state and listener disposal.

- [ ] **Step 2: Run the focused tests and confirm missing methods**

Run: `npx vitest run tests/chrome-browser-control.test.ts`

Expected: FAIL because the controller methods do not exist.

- [ ] **Step 3: Implement browser state and controls**

Register CDP event listeners once in the constructor. `initialize()` sends `Page.enable`, `DOM.enable`, and `Runtime.enable`, then refreshes URL/history. Call `initialize()` after `cdp.connect()` in `launch()`.

Use `Page.getNavigationHistory` for Back/Forward and to update `canGoBack`/`canGoForward`. Ignore child-frame navigations by requiring `params.frame.parentId` to be absent. Preserve `navigate`, `evaluate`, tool click/type, and screenshot methods.

Map inputs exactly:

```ts
if (input.kind === 'wheel') {
  await this.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: input.x, y: input.y,
    deltaX: input.deltaX, deltaY: input.deltaY,
  });
} else if (input.kind === 'text') {
  await this.cdp.send('Input.insertText', { text: input.text });
}
```

Validate width/height as finite positive integers before sending metrics.

- [ ] **Step 4: Run controller and legacy tests**

```bash
npx vitest run tests/chrome-browser-control.test.ts tests/cdp-client.test.ts tests/host-tools.test.ts
npm run build
```

Expected: PASS with no changes to existing tool behavior.

- [ ] **Step 5: Commit**

```bash
git add src/cdp/chrome-controller.ts tests/chrome-browser-control.test.ts
git commit -m "feat: control browser through CDP"
```

---

### Task 4: Screencast Frames and Host Browser API

**Files:**
- Modify: `src/cdp/chrome-controller.ts`
- Modify: `src/host/index.ts:23-260`
- Create: `tests/screencast.test.ts`
- Modify: `tests/host-tools.test.ts`

**Interfaces:**
- Produces on `ChromeController`:
  - `startScreencast(maxWidth: number, maxHeight: number): Promise<void>`
  - `stopScreencast(): Promise<void>`
  - `latestFrameAfter(sequence: number): { sequence: number; data: Buffer; mediaType: 'image/jpeg' } | null`
- Produces private RPC handlers:
  - `realbrowser-get-state`
  - `realbrowser-navigate`
  - `realbrowser-command`
  - `realbrowser-set-viewport`
  - `realbrowser-input`
  - `realbrowser-start-stream`
  - `realbrowser-stop-stream`
- Produces HTTP `GET /realbrowser/frame?after=<sequence>`.

- [ ] **Step 1: Write failing screencast tests**

```ts
// tests/screencast.test.ts
it('keeps only the latest acknowledged screencast frame', async () => {
  const { cdp, send, emit } = recordingCdp();
  const controller = new ChromeController(cdp);
  await controller.startScreencast(1200, 800);

  emit('Page.screencastFrame', { data: Buffer.from('one').toString('base64'), sessionId: 7 });
  emit('Page.screencastFrame', { data: Buffer.from('two').toString('base64'), sessionId: 8 });
  await Promise.resolve();

  expect(send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 7 });
  expect(send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 8 });
  expect(controller.latestFrameAfter(0)?.data.toString()).toBe('two');
  const sequence = controller.latestFrameAfter(0)!.sequence;
  expect(controller.latestFrameAfter(sequence)).toBeNull();
});
```

Extend `host-tools.test.ts` to capture the web route registration, call `GET /realbrowser/frame?after=0`, and verify `content-type`, `x-realbrowser-sequence`, `cache-control: no-store`, and binary bytes. Add RPC assertions for command, metrics, input, and stream lifecycle.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npx vitest run tests/screencast.test.ts tests/host-tools.test.ts`

Expected: FAIL on missing screencast and host API methods.

- [ ] **Step 3: Implement latest-frame storage and acknowledgement**

`startScreencast` must register one event listener, set an active flag, and send:

```ts
await this.cdp.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 80,
  maxWidth: Math.max(1, Math.round(maxWidth)),
  maxHeight: Math.max(1, Math.round(maxHeight)),
  everyNthFrame: 1,
});
```

Each event increments a monotonic sequence, replaces the prior `Buffer`, and immediately acknowledges `sessionId`. `stopScreencast` sends `Page.stopScreencast`, removes the listener, and clears frame data. `close()` must stop local screencast state even if CDP is already disconnected.

- [ ] **Step 4: Replace host URL bookkeeping with controller state and add routes**

Keep the existing `/realbrowser/api` route only where compatibility tests need it. Add a dedicated exact/prefix frame route. The frame route must:

- accept only GET;
- parse `after` as a safe non-negative integer;
- return `204` when there is no newer frame;
- return raw JPEG bytes otherwise;
- never expose base64 JSON.

Private handlers call `ensureChrome()` before browser actions. `realbrowser-command` accepts only `back`, `forward`, or `reload`. `realbrowser-set-viewport` accepts either a known profile ID or responsive dimensions resolved through `resolveViewportMetrics`. Reject malformed input before calling CDP.

- [ ] **Step 5: Test and commit**

```bash
npx vitest run tests/screencast.test.ts tests/host-tools.test.ts tests/cdp-client.test.ts
npm run build
git add src/cdp/chrome-controller.ts src/host/index.ts tests/screencast.test.ts tests/host-tools.test.ts
git commit -m "feat: stream Chrome frames to browser panel"
```

Expected: PASS.

---

### Task 5: Interactive Client Surface and Native Toolbar

**Files:**
- Modify: `src/client/index.ts:60-214`
- Modify: `tests/client-bridge.test.ts:176-419`
- Create: `tests/client-surface.test.ts`

**Interfaces:**
- Consumes: host RPC and frame endpoint from Task 4; viewport catalog and coordinate mapping from Task 1.
- Produces: `RealBrowserPanel(props: { host?: any; ctx?: any; scope?: { sessionId: string }; visible?: boolean })`.
- The visible browsing surface is an `<img>` interaction target, never an `<iframe>`.

- [ ] **Step 1: Write failing render and interaction tests**

In `client-bridge.test.ts`, replace iframe-history expectations with host commands:

```ts
expect(backBtn.props['aria-label']).toBe('Back');
backBtn.props.onClick();
expect(host.call).toHaveBeenCalledWith('realbrowser-command', { command: 'back' });
```

Add grouped select assertions:

```ts
const groups = createdElements.filter((element) => element.type === 'optgroup');
expect(groups.map((group) => group.props.label)).toEqual(['Screen Sizes', 'Tablets', 'Mobile']);
expect(createdElements.some((element) => element.type === 'iframe')).toBe(false);
expect(createdElements.some((element) => element.type === 'img')).toBe(true);
```

In `tests/client-surface.test.ts`, test exported event helpers:

```ts
expect(pointerInputFromEvent(
  { clientX: 260, clientY: 145, button: 0 },
  { left: 10, top: 20, width: 500, height: 250 },
  { width: 1920, height: 1080 },
  'mousePressed',
)).toMatchObject({ kind: 'mouse', x: 960, y: 540, button: 'left' });
```

- [ ] **Step 2: Run tests and confirm old iframe behavior fails**

Run: `npx vitest run tests/client-bridge.test.ts tests/client-surface.test.ts`

Expected: FAIL because the panel still creates an iframe and calls iframe history.

- [ ] **Step 3: Implement frame polling with cleanup**

When `visible !== false`, call `realbrowser-start-stream` with current panel preview bounds. Fetch `/realbrowser/frame?after=${sequence}` in a loop. For `200`, create an object URL from the JPEG blob, replace/revoke the previous URL, and update the sequence from `x-realbrowser-sequence`. For `204`, wait 33 ms. Abort the fetch loop and call `realbrowser-stop-stream` when hidden or unmounted.

Never run more than one poll loop. Ignore stale results after cleanup.

- [ ] **Step 4: Implement toolbar, viewport selection, and input forwarding**

- Replace text Back/Forward/Reload controls with inline SVG icons, `title`, and `aria-label`.
- Disable history buttons from `BrowserSnapshot`.
- Keep bare-hostname normalization.
- Render options by mapping `VIEWPORT_GROUPS` to `optgroup` and `option`.
- Use `ResizeObserver` only while Responsive is selected.
- Send exact preset IDs; send rounded content dimensions for Responsive.
- Make the frame image focusable with `tabIndex: 0`.
- Forward mouse move/down/up, wheel, key down/up, and printable text through `realbrowser-input`.
- Call `preventDefault()` only for events actually forwarded.

Use DSH tokens without fallback hard-coded theme colors:

```ts
const toolbarStyle = {
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  borderBottom: '1px solid var(--dsw-alias-border-l1)',
};
```

Use `--dsw-alias-brand-primary`, `--dsw-alias-label-secondary`, and state tokens for active/error states. Keep visible focus outlines.

- [ ] **Step 5: Pass scope props through Better Sidebar registration**

Change registration to preserve the host bridge and Better Sidebar props:

```ts
component: (props: any) => RealBrowserPanel({ ...props, host }),
```

Do not use DOM queries to discover the active session; use `props.scope.sessionId`.

- [ ] **Step 6: Run tests, build, and commit**

```bash
npx vitest run tests/client-bridge.test.ts tests/client-surface.test.ts tests/viewports.test.ts
npm run build
git add src/client/index.ts tests/client-bridge.test.ts tests/client-surface.test.ts
git commit -m "feat: render interactive browser surface"
```

Expected: PASS.

---

### Task 6: CDP Element Inspection and WebP Capture

**Files:**
- Modify: `src/cdp/chrome-controller.ts`
- Modify: `src/host/index.ts`
- Create: `tests/element-inspection.test.ts`
- Modify: `tests/host-tools.test.ts`

**Interfaces:**
- Produces on `ChromeController`:
  - `inspectElementAt(x: number, y: number): Promise<Omit<PickedElementResult, 'screenshotBase64' | 'screenshotMediaType'>>`
  - `pickElementAt(x: number, y: number): Promise<PickedElementResult>`
- Produces RPC handlers:
  - `realbrowser-hover-element`
  - `realbrowser-pick-element`

- [ ] **Step 1: Write failing inspection tests**

Use a recording CDP fake that returns `nodeId`, a box model quad, a resolved object ID, metadata, and screenshot bytes:

```ts
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
  expect(send).toHaveBeenCalledWith('Page.captureScreenshot', expect.objectContaining({
    format: 'webp',
    clip: { x: 100, y: 60, width: 180, height: 44, scale: 1 },
  }));
});
```

Add rejection tests for no node, missing box model, zero-size bounds, and non-finite coordinates.

- [ ] **Step 2: Run the test and confirm missing methods**

Run: `npx vitest run tests/element-inspection.test.ts`

Expected: FAIL because inspection methods do not exist.

- [ ] **Step 3: Implement safe metadata resolution**

Use:

1. `DOM.getNodeForLocation` with `includeUserAgentShadowDOM: true`.
2. `DOM.getBoxModel` and the content/border quad to calculate finite bounds.
3. `DOM.resolveNode` to obtain `objectId`.
4. `Runtime.callFunctionOn` with `returnByValue: true`.

The page function must return only owned strings and generate:

- escaped CSS path, preferring IDs;
- XPath, preferring IDs;
- lowercase tag;
- text trimmed to 500 characters;
- `outerHTML` trimmed to 4,000 characters;
- `location.href`.

Do not serialize the live remote object. Release it with `Runtime.releaseObject` in `finally`.

- [ ] **Step 4: Capture WebP only on final selection**

`inspectElementAt` returns metadata/bounds only. `pickElementAt` calls it, then:

```ts
const shot = await this.cdp.send<{ data: string }>('Page.captureScreenshot', {
  format: 'webp',
  quality: 82,
  fromSurface: true,
  captureBeyondViewport: true,
  clip: { ...selection.bounds, scale: 1 },
});
```

Hover must never capture an image. Add host handlers with coordinate validation.

- [ ] **Step 5: Test and commit**

```bash
npx vitest run tests/element-inspection.test.ts tests/host-tools.test.ts
npm run build
git add src/cdp/chrome-controller.ts src/host/index.ts tests/element-inspection.test.ts tests/host-tools.test.ts
git commit -m "feat: inspect and capture page elements"
```

Expected: PASS.

---

### Task 7: Picker Overlay and Conversation Draft Handoff

**Files:**
- Create: `src/client/chat-bridge.ts`
- Modify: `src/client/index.ts`
- Create: `tests/chat-bridge.test.ts`
- Modify: `tests/client-bridge.test.ts`

**Interfaces:**
- Consumes: `PickedElementResult`, Better Sidebar `ctx` and `scope.sessionId`, DSH `conversation` service.
- Produces:
  - `formatPickedElementDraft(result: PickedElementResult): string`
  - `attachPickedElement(ctx: any, sessionId: string, result: PickedElementResult): Promise<void>`
- On unavailable integration, the caller copies text to clipboard and shows an inline error.

- [ ] **Step 1: Write failing chat bridge tests**

```ts
// tests/chat-bridge.test.ts
it('preserves draft text and adds a WebP image attachment', async () => {
  const setDraft = vi.fn();
  const addAttachments = vi.fn().mockReturnValue(true);
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
});
```

Add tests for missing Conversation service and rejected attachment insertion. Verify failed insertion calls `releaseDraftAttachment('image-1')` and does not alter text.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npx vitest run tests/chat-bridge.test.ts`

Expected: FAIL because `src/client/chat-bridge.ts` does not exist.

- [ ] **Step 3: Implement draft text and WebP File conversion**

Decode base64 with `atob` into a `Uint8Array`, then create:

```ts
const file = new File([bytes], 'realbrowser-element.webp', { type: 'image/webp' });
```

Resolve `ctx.get('conversation')`. Call `createDrafts(sessionId, [file])`, then `conversation.input.shell(sessionId)`. Add the attachment before changing text. Preserve existing draft with exactly one blank line separator. If add fails, release the created draft and throw.

The formatted text must include URL, CSS, XPath, and bounded outer HTML exactly as specified in the design.

- [ ] **Step 4: Connect picker hover, overlay, and click**

While picker is active:

- throttle hover RPC to at most one outstanding request;
- draw the returned bounds over the scaled image with `pointerEvents: 'none'`;
- on click, prevent ordinary page input and call `realbrowser-pick-element`;
- call `attachPickedElement(ctx, scope.sessionId, result)`;
- stop picker mode and clear overlay only after success;
- on failure, copy formatted metadata when available and show an inline error.

Picker mode must remain visually distinct using `--dsw-alias-brand-primary` and include `aria-pressed`.

- [ ] **Step 5: Remove obsolete textarea and iframe picker path**

Delete `injectIntoChatTextarea` and the `REALBROWSER_ELEMENT_PICKED` window-message listener from `src/client/index.ts`. Keep proxy picker code only while proxy tests still cover compatibility; it is no longer loaded by the visible panel.

Update old tests to assert Conversation draft behavior rather than `<textarea>` mutation or iframe `postMessage`.

- [ ] **Step 6: Test, build, and commit**

```bash
npx vitest run tests/chat-bridge.test.ts tests/client-bridge.test.ts tests/client-surface.test.ts tests/element-inspection.test.ts
npm run build
git add src/client/chat-bridge.ts src/client/index.ts tests/chat-bridge.test.ts tests/client-bridge.test.ts
git commit -m "feat: attach selected elements to chat"
```

Expected: PASS.

---

### Task 8: Deterministic Browser Flow, Full Verification, and v0.0.1 Release

**Files:**
- Create: `.gitignore`
- Create: `tests/browser-flow.test.ts`
- Modify: `scripts/verify.ts`
- Modify: `package.json:1-27`
- Modify: `package-lock.json`
- Modify: documentation only if commands or behavior changed during implementation.

**Interfaces:**
- Consumes: all browser APIs and client behavior from Tasks 1–7.
- Produces: reproducible multi-page flow test, package version `0.0.1`, clean repository, commit, and annotated `v0.0.1` tag.

- [ ] **Step 1: Add a deterministic login-like fixture test**

`tests/browser-flow.test.ts` must start a local HTTP server with:

- `/` containing a link to `/login`;
- `/login` containing a POST form;
- `/session` reached by `303`, setting a cookie and linking to `/next`;
- `/next` displaying the cookie-backed state.

Launch real Chrome through `ChromeController`, navigate the complete flow using CDP input or existing selector tools, then assert:

```ts
expect(await controller.evaluate('location.pathname')).toBe('/next');
await controller.goBack();
expect(await controller.evaluate('location.pathname')).toBe('/session');
await controller.goForward();
expect(await controller.evaluate('location.pathname')).toBe('/next');
await controller.reload();
expect(await controller.evaluate('document.body.textContent')).toContain('signed in');
```

Skip only when `resolveChromeBinary()` throws the documented missing-browser error; this machine is expected to run it.

- [ ] **Step 2: Replace proxy-only self-verification**

Update `scripts/verify.ts` to verify:

- viewport catalog resolution;
- Chrome launch;
- navigation to a local fixture;
- viewport metrics through `window.innerWidth/innerHeight`;
- back/forward/reload;
- WebP element capture with non-empty bytes.

Always close the HTTP server and Chrome in `finally`.

- [ ] **Step 3: Add release hygiene and set the requested version**

Create:

```gitignore
node_modules/
dist/
```

Run:

```bash
npm version 0.0.1 --no-git-tag-version
```

Verify both `package.json` and `package-lock.json` report `0.0.1`. Do not commit generated `dist/`; build it locally for the linked profile.

- [ ] **Step 4: Run complete automated verification**

```bash
npm test -- --run
npm run build
npm run verify
git diff --check
git status --short
```

Expected:

- all tests PASS;
- build and self-verification PASS;
- `git diff --check` prints nothing;
- only intended source, test, release, and plan files are tracked changes;
- `dist/` and `node_modules/` do not appear in status.

- [ ] **Step 5: Verify the installed `tauri` profile and live UI**

Confirm `/home/prv-cn/.dsh/profiles/tauri/package.json` still contains:

```json
"realbrowser": "link:/home/prv-cn/Documents/realbrowser"
```

Fully restart the Tauri app. In RealBrowser:

1. Confirm toolbar colors, borders, focus, and disabled states match the current DSH theme.
2. Select 1080p, 2K, 4K, one tablet, one phone, and both Surface Duo presets; use page JavaScript or DevTools-backed state to confirm exact CSS viewport dimensions.
3. Navigate Google and YouTube; verify frame rendering and address updates.
4. Exercise a deterministic multi-page/login-like site; verify Back, Forward, and Reload after redirects.
5. Pick one element; verify metadata appears in the current chat draft and one cropped WebP appears in the attachment rail.
6. Cancel picker and hide/show the panel; verify no stale overlay or duplicate frame loop.

Capture concise evidence for failures only. Fix root causes with a focused regression test before rerunning this gate.

- [ ] **Step 6: Commit release changes**

```bash
git add .gitignore package.json package-lock.json scripts/verify.ts src tests docs
git commit -m "feat: release RealBrowser 0.0.1"
```

Do not add `dist/` or `node_modules/`.

- [ ] **Step 7: Run final verification on the committed tree**

```bash
npm test -- --run
npm run build
npm run verify
git diff --check
git status --short
```

Expected: all commands PASS and status is clean because generated paths are ignored.

- [ ] **Step 8: Create the annotated local tag**

```bash
git tag -a v0.0.1 -m "RealBrowser v0.0.1"
git show --stat --oneline v0.0.1
git remote -v
```

Expected: tag points at the verified release commit. `git remote -v` remains empty, so do not run `git push`.
