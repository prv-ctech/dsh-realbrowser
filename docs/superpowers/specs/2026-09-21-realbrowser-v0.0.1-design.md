# RealBrowser v0.0.1 Design

## Goal

Make RealBrowser use one real Chrome page for both human interaction and agent tools. Version 0.0.1 must provide accurate viewport presets, reliable navigation and login flows, a DSH-native toolbar, and element selection that adds useful metadata plus a cropped image to the current chat draft.

## Scope

This release replaces the proxy iframe as the visible browsing surface with a Chrome DevTools Protocol (CDP) screencast. The existing proxy code may remain temporarily for compatibility tests, but the panel must not depend on it. One Chrome target remains shared by the plugin, matching the current single-browser behavior.

Out of scope:

- Multiple tabs or multiple concurrent Chrome profiles.
- Device user-agent spoofing beyond CDP's standard mobile/desktop metrics.
- Network throttling, geolocation, sensors, or custom device-profile editing.
- Pixel-perfect browser chrome imitation.

## Architecture

The host owns the only authoritative browser state. `ChromeController` will:

- expose CDP event subscriptions;
- start and stop `Page.startScreencast`;
- acknowledge each screencast frame;
- maintain current URL, title, loading state, and history capabilities;
- dispatch mouse, wheel, keyboard, and text input;
- set viewport metrics;
- navigate backward, forward, and reload;
- inspect and capture a selected DOM element.

The host will retain only the newest screencast frame. A same-origin HTTP frame endpoint will return the newest JPEG frame after a requested sequence number, or `204` when no newer frame is ready. This avoids repeatedly transferring large base64 values through Cordis RPC. Control actions remain small private RPC calls.

The client renders the latest frame in an image-backed interaction surface. Pointer and keyboard coordinates are converted from the displayed, scaled preview to the configured CSS viewport before being sent to the host. `Page.startScreencast` may downscale frames to the panel bounds; this changes only preview pixels, never the page viewport.

The panel component receives Better Sidebar's `ctx`, `scope`, and `visible` props. Streaming pauses while hidden. Browser resources remain owned by the host fiber and are disposed when the plugin stops.

## Viewport Profiles

Every fixed profile uses CSS pixels because CSS pixels determine website layout and responsive breakpoints. Desktop profiles use DPR 1. Mobile and tablet profiles use their real logical viewport and an appropriate DPR/mobile flag. The preview may scale down to fit without changing these values.

### Screen Sizes

- Responsive — panel content dimensions, updated through `ResizeObserver`.
- Full HD — 1920 × 1080.
- Full HD Ultrawide — 2560 × 1080.
- 2K QHD — 2560 × 1440.
- 2K QHD Ultrawide — 3440 × 1440.
- 4K UHD — 3840 × 2160.
- 4K Ultrawide — 5120 × 2160.

### Tablets

- iPad 10th generation — 820 × 1180.
- iPad Air 11-inch — 820 × 1180.
- iPad Pro 11-inch — 834 × 1194.
- iPad Pro 13-inch — 1032 × 1376.
- Samsung Galaxy Tab S9 — 800 × 1280.
- Xiaomi Pad 6 — 900 × 1440.

### Mobile

- iPhone 16 Pro — 402 × 874.
- iPhone 16 Pro Max — 440 × 956.
- Microsoft Surface Duo folded — 540 × 720.
- Microsoft Surface Duo unfolded — 1114 × 720, including the dual-screen span.
- Samsung Galaxy Z Fold 6 cover — 402 × 968.
- Samsung Galaxy Z Fold 6 unfolded — 882 × 1104.
- Samsung Galaxy Z Flip 6 — 360 × 880.
- Samsung Galaxy S24 Ultra — 480 × 1023.
- Google Pixel 9 Pro — 412 × 915.
- Xiaomi 14 — 393 × 873.

The selector uses native `optgroup` groups named Screen Sizes, Tablets, and Mobile. Responsive remains the first option. No custom profile editor is included.

Reference values are based on logical viewport references, including [Apple's layout dimensions](https://developer.apple.com/design/human-interface-guidelines/layout), [iPhone 16 Pro Max viewport data](https://1440px.com/screen-sizes/iphone-16-pro-max/), [Galaxy Tab S9 viewport data](https://1440px.com/screen-sizes/samsung-galaxy-tab-s9/), and [Galaxy Z Flip 6 viewport data](https://1440px.com/screen-sizes/samsung-galaxy-z-flip-6/).

## Navigation and Interaction

The address bar normalizes bare hostnames to HTTPS as it does now. Enter and Go both call the same navigation action.

Back and Forward use `Page.getNavigationHistory` and `Page.navigateToHistoryEntry`. Reload uses `Page.reload`. The host updates navigation state from CDP page events, including redirects and link/form navigation, so the address bar follows the actual page URL. Failed navigation returns a concise inline error without replacing the last valid frame.

The interaction surface supports:

- pointer move, press, release, and click;
- vertical and horizontal wheel scrolling;
- keyboard navigation and shortcuts;
- printable text insertion;
- focus indication and accessible toolbar controls.

This makes forms and login flows operate in the same Chrome page shown in the panel. No iframe history or proxy cookie emulation participates.

## Toolbar UI

The toolbar uses compact semantic buttons, input, and grouped select controls. It consumes DSH theme tokens such as `--dsw-alias-bg-layer-1`, `--dsw-alias-border-l1`, `--dsw-alias-brand-primary`, and label/state tokens. There is no new UI dependency because DSH does not expose a stable shared component service for these controls.

Back, Forward, and Reload use small SVG icons with tooltips and `aria-label` values. Disabled states reflect CDP history state. The address field takes remaining width. Pick Element is a token-styled toggle. Controls wrap only when the sidebar is too narrow; the browsing surface keeps the selected viewport and scrolls/scales independently.

## Element Picker and Chat Handoff

Picker mode uses CDP rather than injected page JavaScript:

1. Pointer movement calls `DOM.getNodeForLocation` and `DOM.getBoxModel`.
2. The client draws a highlight over the matching box in preview coordinates.
3. Selection resolves the element and returns CSS selector, XPath, tag, trimmed text, bounded outer HTML, URL, and bounds.
4. `Page.captureScreenshot` captures the element clip as WebP.
5. The client creates a browser `File` from the WebP bytes.
6. The session-scoped DSH Conversation service creates an image draft for `scope.sessionId`.
7. The current composer draft receives the metadata text, preserving existing text, then receives the image attachment ID.

The message format stays compact and model-readable:

```text
Selected website element
URL: https://example.com/path
CSS: `main > form#login > button[type="submit"]`
XPath: `//*[@id="login"]/button[1]`
Element: `<button type="submit">Sign in</button>`
```

The screenshot is attached to the draft, not automatically sent. If chat draft integration is unavailable, RealBrowser keeps the selection, copies the metadata to the clipboard, and shows an explicit error; it never reports success without the attachment.

## Error Handling and Lifecycle

- Host actions return structured errors that the toolbar can show inline.
- Late frames and action results carry sequence numbers so stale results are ignored.
- Starting a new navigation cancels stale loading state but does not destroy Chrome.
- Screencast polling pauses when the panel is hidden and resumes from the newest frame.
- CDP disconnect rejects pending calls, clears transient state, and permits the existing launch path to recreate Chrome.
- Element screenshots are size-bounded by the selected element clip; no full-page image is attached accidentally.
- Every event listener, frame waiter, route, and Chrome process has a fiber-owned disposer.

## Testing

Focused automated tests will cover:

- grouped viewport catalog and exact metrics;
- responsive resize behavior without changing fixed presets;
- preview-to-viewport coordinate mapping;
- CDP event subscription and cleanup;
- screencast frame acknowledgement and latest-frame replacement;
- Back, Forward, Reload, redirects, and URL state;
- pointer, wheel, key, and text dispatch;
- picker selector/XPath/HTML metadata and clipped WebP capture;
- preserving composer text while adding the image draft;
- disabled/error states and lifecycle cleanup.

A deterministic local fixture will exercise link navigation, form POST/redirect, back, forward, reload, and a login-like cookie flow. Final verification runs the full test suite and build, then performs live Google and YouTube smoke checks in the `tauri` profile.

## Release

- Change `package.json` version from `0.1.0` to `0.0.1` as requested.
- Add ignore rules for `node_modules/` and generated `dist/`.
- Keep the local profile link; rebuild `dist/` for local use.
- Commit verified implementation and create annotated tag `v0.0.1`.
- Do not push because this repository has no configured remote and local-only release was selected.
