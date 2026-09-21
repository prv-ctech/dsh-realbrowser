# RealBrowser Picker Reliability Design

## Goal

Make element picking reliable across real pages, allow repeated selections in one picker session, isolate every RealBrowser Chrome process, and expose useful errors without changing DeepSeek Harness core.

## Proven failure mechanism

`DOM.getNodeForLocation` returns compositor hit-test nodes, not always page elements. Live Chrome returned:

- `CSSPseudoElement` for Google’s sign-in control; metadata evaluation returned no element fields.
- a user-agent `ShadowRoot` for Google’s input; `DOM.getBoxModel` failed.

Both became HTTP 500 responses, while the client replaced the server message with `RealBrowser request failed (500)`.

A separate live-profile test proved the fixed CDP port is unsafe: a temporary profile spawned another Chrome with `--remote-debugging-port=9222`, then connected to and navigated the existing profile’s browser.

DSH’s conversation service is not the limiting factor. `createDrafts()` registers each image/file and `addAttachments()` appends every ID unless a prompt submission is in progress.

## Architecture

### Element normalization

Replace compositor-node inspection with one page-context `Runtime.evaluate` call. Start from `document.elementFromPoint(x, y)`, descend through accessible open shadow roots, and derive metadata plus `getBoundingClientRect()` from the resulting real `Element`. Closed and user-agent shadow content naturally resolves to its host element.

The returned rectangle stays viewport-relative. Screenshot clipping adds the current layout viewport page offset only when calling `Page.captureScreenshot`.

### Chrome ownership

Default to `--remote-debugging-port=0`. Chrome chooses an available port and writes it to `<user-data-dir>/DevToolsActivePort`. RealBrowser waits for that file, records the assigned port, then uses the existing `/json/version` and `/json/list` discovery flow. Explicit non-zero ports remain supported for tests and callers.

Each controller continues to own and terminate only its spawned process and temporary user-data directory.

### Client interaction

Picker mode remains active after a successful selection. Each click appends one metadata file and one WebP image through the existing conversation service. The user exits with the toggle or Escape.

The hover overlay uses a fixed accessible blue (`#3b82f6`) and translucent fill so theme brand colors cannot make it white. Existing native button semantics, `aria-pressed`, keyboard Escape behavior, and live error status remain.

HTTP failures parse the response JSON and show its `error` field. Network and malformed-response failures keep a concise fallback.

## Acceptance criteria

1. Google pseudo-element and user-agent shadow-root coordinates resolve to their owner elements without HTTP 500.
2. One picker activation accepts at least five sequential selections and appends ten draft attachments.
3. Hover highlight is visibly blue, never theme-white.
4. API failures show the host’s actual message.
5. Two temporary DSH profiles use different CDP ports and cannot navigate each other’s browser.
6. Build, focused tests, full test suite, and live multi-site stress checks pass.

## Non-goals

- Picking inside cross-origin iframe documents; selecting the iframe host is sufficient.
- A shared browser pool, tab broker, or persistent browser profile.
- DeepSeek Harness engine changes.
- New dependencies or configuration surface.
