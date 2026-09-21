# RealBrowser: Interactive Embedded Browser Plugin with Chrome DevTools & Element Picker

## 1. Overview

RealBrowser is a Cordis plugin for DeepSeek Harness (DSH) that embeds an interactive, responsive web browser directly into the DSH Web GUI without video streaming. It allows:
- **Humans** to browse any website smoothly, resize and adapt the viewport to any screen dimension, and use an interactive "Element Picker" to select DOM elements and pass their selectors/details directly into the DSH chat input.
- **AI Agents** to control the browser programmatically using Chrome DevTools Protocol (CDP) and tools (`realbrowser_navigate`, `realbrowser_click`, `realbrowser_type`, `realbrowser_evaluate`, `realbrowser_screenshot`).

## 2. Architecture

```
+-------------------------------------------------------------------------+
|                              DSH Web GUI                                |
|                                                                         |
|  +---------------------------+  +------------------------------------+  |
|  |       Chat Interface      |  |         RealBrowser Panel          |  |
|  |                           |  |  +-------------------------------+ |  |
|  |  [Input: Selected #elem]  |  |  | Toolbar (URL, Nav, Pick, Size)| |  |
|  |            ^              |  |  +-------------------------------+ |  |
|  |            | postMessage  |  |  | Responsive Iframe Container   | |  |
|  |            +--------------+--+--|   (Proxied web page + picker) | |  |
|  +---------------------------+  +--+---------------------------------+  |
+------------------------------------|------------------------------------+
                                     | HTTP / WS
                                     v
+-------------------------------------------------------------------------+
|                         RealBrowser Host Backend                        |
|                                                                         |
|  +-------------------------+            +----------------------------+  |
|  |   Local Reverse Proxy   |            |   CDP / Chrome Controller  |  |
|  | - Strips X-Frame-Opt    |            | - chrome-devtools-mcp /    |  |
|  | - Strips CSP frame-anc  |            |   CDP WebSocket client     |  |
|  | - Injects picker script |            | - Agent Tools provider     |  |
|  +-------------------------+            +----------------------------+  |
|               ^                                       ^                 |
+---------------|---------------------------------------|-----------------+
                v                                       v
         External Websites                       Chrome Browser
```

### 2.1 Host Backend
1. **Chrome Instance Manager**:
   - Launches headless or headed Chromium/Chrome with `--remote-debugging-port`.
   - Connects to Chrome DevTools Protocol via WebSocket.
   - Manages tab lifecycle, active page targets, and agent tool execution.
2. **Local HTTP/WS Reverse Proxy**:
   - Runs locally on a dynamic loopback port (`127.0.0.1:<port>`).
   - Forwards HTTP and WebSocket requests to target web domains.
   - Strips response headers preventing iframe embedding: `X-Frame-Options`, `Content-Security-Policy: frame-ancestors`, `Cross-Origin-Opener-Policy`.
   - Injects `realbrowser-picker.js` into HTML responses before serving them into the iframe.
3. **Agent Tools (Cordis / MCP)**:
   - `realbrowser_navigate(url)`: Navigates current page to URL.
   - `realbrowser_click(selector)`: Dispatches click on element matching selector.
   - `realbrowser_type(selector, text)`: Inputs text into target element.
   - `realbrowser_evaluate(expression)`: Runs JavaScript expression in page context.
   - `realbrowser_screenshot()`: Captures page screenshot as image.
   - `realbrowser_get_dom(selector?)`: Returns accessibility or DOM tree summary.

### 2.2 Client Panel (Cordis Slot)
1. **Navigation Toolbar**:
   - Address bar: displays current URL, accepts URL inputs.
   - History buttons: Back, Forward, Reload.
   - Viewport Presets:
     - Full / Responsive (100% available space).
     - Desktop (1920x1080 scaled).
     - Tablet (768x1024).
     - Mobile (375x812).
   - "Pick Element" toggle button: toggles element inspection mode.
2. **Responsive Container**:
   - Houses the `<iframe>` pointing to `http://127.0.0.1:<proxy_port>/proxy?url=<target_url>`.
   - Flexibly resizes to match selected preset or panel bounds.
3. **PostMessage Bridge**:
   - Communicates bidirectionally with the injected picker script inside the iframe.
   - Listens for `REALBROWSER_ELEMENT_PICKED` events.
   - When received:
     - Formats element summary (selector, XPath, tag, text, classes).
     - Inserts formatted context into the DSH chat input textarea (`document.querySelector('textarea')`).
     - Copies selector to clipboard as fallback.

### 2.3 Injected Element Picker (`realbrowser-picker.js`)
- Runs directly inside the proxied page DOM.
- When enabled via `postMessage`:
  - Attaches mouseover/mouseout listeners.
  - Highlights hovered element with an outline and tooltip badge showing `tag#id.classes` and dimensions.
  - Intercepts `click` with `preventDefault()` and `stopPropagation()`.
  - Computes the most specific and readable CSS selector (e.g. using `id`, unique classes, or path-based hierarchical selector) and XPath.
  - Posts payload `{ type: 'REALBROWSER_ELEMENT_PICKED', selector, xpath, tag, text, attributes }` to `window.parent`.
  - Automatically disables hover highlighting until activated again.

## 3. Data Flow

### 3.1 Human Browsing Flow
1. User enters URL in address bar or clicks links within iframe.
2. Request passes through local proxy, headers stripped, picker injected, and rendered in iframe.
3. User resizes panel or toggles viewport preset; iframe adjusts layout dynamically using native CSS media queries.

### 3.2 AI Agent Automation Flow
1. AI model calls `realbrowser_navigate(url)` or `realbrowser_click(selector)`.
2. Host CDP controller executes command in Chrome.
3. Proxy and iframe reflect the updated page state.

### 3.3 Element Picker Flow
1. User clicks "Pick Element" in RealBrowser toolbar.
2. Toolbar sends `{ type: 'REALBROWSER_PICKER_ENABLE' }` to iframe.
3. User hovers over target element (highlighted) and clicks it.
4. Injected script computes selector and posts `{ type: 'REALBROWSER_ELEMENT_PICKED' }`.
5. Toolbar catches message and populates DSH chat input with:
   `Element selected: \`<selector>\` (<tag>: "<snippet>")`

## 4. Error Handling

1. **Browser / CDP Crash**: Auto-reconnect with exponential backoff; restart Chrome process if connection is refused.
2. **Proxy Failure / Unreachable Site**: Proxy renders an inline error card with HTTP status and retry button directly in iframe.
3. **Chat Input Not Accessible**: If the DSH chat textarea cannot be located in the DOM, the picker copies the selector to clipboard and displays a floating toast notification.

## 5. Testing & Verification

1. **Proxy Test**: Verify stripping of `X-Frame-Options` and `CSP frame-ancestors` headers, and verify injection of `<script src="/__realbrowser/picker.js">`.
2. **Selector Generator Unit Test**: Verify selector computation generates valid, unique selectors for arbitrary DOM trees.
3. **CDP Tool Integration Test**: Launch Chrome instance, connect CDP, execute `navigate` and `evaluate`, confirm expected DOM results.
4. **Verification Script**: Standalone script verifying proxy, CDP bridge, and picker script generation.
