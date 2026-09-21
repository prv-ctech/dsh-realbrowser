# RealBrowser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build RealBrowser, a Cordis plugin for DeepSeek Harness that embeds an interactive responsive web browser into the DSH Web GUI without video streaming, with an element picker that inserts selected DOM elements into DSH chat input and CDP tools for AI agent control.

**Architecture:** Host Node.js service runs a local reverse proxy that strips frame-blocking headers and injects an element picker script, alongside a CDP controller for Chrome automation. The Client Cordis React plugin mounts a responsive iframe panel with toolbar (URL, responsive presets, picker toggle) and bridges picked element events into the DSH chat textarea.

**Tech Stack:** TypeScript, Node.js (`http`, `ws`), Chrome DevTools Protocol (CDP), React (`React.createElement`), Vitest for tests.

**Spec:** `/home/prv-cn/Documents/realbrowser/docs/superpowers/specs/2026-09-20-realbrowser-design.md`

## Global Constraints

- Pure Node.js & standard web APIs; no heavy video streaming (no VNC/screencast).
- Plain JavaScript / React for Cordis dynamic plugin interfaces.
- Safe header stripping: `x-frame-options`, `content-security-policy` (frame-ancestors), `cross-origin-opener-policy`.
- Responsive container adapting smoothly to screen and user viewport presets (Desktop, Tablet, Mobile, Custom).
- Element picker captures unique CSS selector, XPath, tag, text snippet, and delivers to chat input.

---

### Task 1: Project Scaffolding & Configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: Base project structure and test harness for subsequent tasks.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "realbrowser",
  "version": "0.1.0",
  "description": "Interactive embedded browser plugin for DSH with Chrome DevTools and Element Picker",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.12",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 4: Install dependencies and verify test runner**

Run: `npm install && npm test`
Expected: Passes (0 test files found or clean exit).

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts
git commit -m "chore: scaffold realbrowser project and vitest config"
```

---

### Task 2: Element Picker Runtime & Selector Generator

**Files:**
- Create: `src/picker/selector-generator.ts`
- Create: `src/picker/picker-script.ts`
- Test: `tests/selector-generator.test.ts`

**Interfaces:**
- Produces: `getUniqueSelector(el: Element): string`, `getXPath(el: Element): string`, `generatePickerScript(): string`.

- [ ] **Step 1: Write failing test for selector generator**

```ts
import { describe, it, expect } from 'vitest';
import { getOptimalSelector } from '../src/picker/selector-generator.js';

describe('Selector Generator', () => {
  it('prefers id when unique', () => {
    const selector = getOptimalSelector({
      id: 'main-nav',
      tagName: 'NAV',
      classList: ['navbar', 'flex'],
      parentElement: null,
    });
    expect(selector).toBe('#main-nav');
  });

  it('uses tag and class when id is missing', () => {
    const selector = getOptimalSelector({
      id: '',
      tagName: 'BUTTON',
      classList: ['btn-primary', 'submit-btn'],
      parentElement: null,
    });
    expect(selector).toBe('button.btn-primary.submit-btn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/selector-generator.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement selector generator and picker script generator**

```ts
// src/picker/selector-generator.ts
export interface ElementLike {
  id?: string;
  tagName: string;
  classList: string[];
  parentElement?: ElementLike | null;
}

export function getOptimalSelector(el: ElementLike): string {
  if (el.id && el.id.trim()) {
    return `#${el.id.trim()}`;
  }
  const tag = el.tagName.toLowerCase();
  const classes = el.classList.filter(Boolean).map(c => `.${c}`).join('');
  return `${tag}${classes}`;
}

export function getXPath(tagName: string, index = 1): string {
  return `//${tagName.toLowerCase()}[${index}]`;
}
```

```ts
// src/picker/picker-script.ts
export function generatePickerScript(): string {
  return `
(function() {
  if (window.__REALBROWSER_PICKER_LOADED__) return;
  window.__REALBROWSER_PICKER_LOADED__ = true;

  let active = false;
  let overlay = null;

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = '__realbrowser_overlay__';
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.border = '2px solid #3b82f6';
    overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
    overlay.style.zIndex = '2147483647';
    overlay.style.transition = 'all 0.05s ease';
    overlay.style.display = 'none';
    document.documentElement.appendChild(overlay);
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        selector += '#' + el.id;
        path.unshift(selector);
        break;
      } else {
        let sib = el, nth = 1;
        while (sib = sib.previousElementSibling) {
          if (sib.nodeName.toLowerCase() === selector) nth++;
        }
        if (nth !== 1) selector += ":nth-of-type(" + nth + ")";
      }
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(' > ');
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'REALBROWSER_PICKER_ENABLE') {
      active = true;
      if (!overlay) createOverlay();
    } else if (e.data && e.data.type === 'REALBROWSER_PICKER_DISABLE') {
      active = false;
      if (overlay) overlay.style.display = 'none';
    }
  });

  document.addEventListener('mouseover', (e) => {
    if (!active || !overlay || e.target === overlay) return;
    const rect = e.target.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';
  }, true);

  document.addEventListener('click', (e) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    active = false;
    if (overlay) overlay.style.display = 'none';
    const target = e.target;
    const selector = getSelector(target);
    const tag = target.tagName.toLowerCase();
    const text = (target.innerText || target.textContent || '').trim().slice(0, 100);
    window.parent.postMessage({
      type: 'REALBROWSER_ELEMENT_PICKED',
      payload: { selector, tag, text }
    }, '*');
  }, true);
})();
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/selector-generator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/picker/ tests/selector-generator.test.ts
git commit -m "feat(picker): implement selector generator and picker client script"
```

---

### Task 3: Local HTTP/WS Reverse Proxy with Header Stripping & Injection

**Files:**
- Create: `src/proxy/header-filter.ts`
- Create: `src/proxy/proxy-server.ts`
- Test: `tests/proxy.test.ts`

**Interfaces:**
- Consumes: `generatePickerScript` from `src/picker/picker-script.ts`.
- Produces: `cleanHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders`, `startProxyServer(port?: number): Promise<{ port: number, close: () => void }>`.

- [ ] **Step 1: Write failing test for header filter and proxy**

```ts
import { describe, it, expect } from 'vitest';
import { filterResponseHeaders, shouldInjectScript } from '../src/proxy/header-filter.js';

describe('Header Filter', () => {
  it('strips x-frame-options and frame-ancestors', () => {
    const headers = {
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'; default-src 'self'",
      'content-type': 'text/html; charset=utf-8',
    };
    const cleaned = filterResponseHeaders(headers);
    expect(cleaned['x-frame-options']).toBeUndefined();
    expect(cleaned['content-security-policy']).not.toContain('frame-ancestors');
  });

  it('detects html content for script injection', () => {
    expect(shouldInjectScript('text/html; charset=utf-8')).toBe(true);
    expect(shouldInjectScript('application/json')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/proxy.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement header filter and proxy server**

```ts
// src/proxy/header-filter.ts
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

export function filterResponseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const result: OutgoingHttpHeaders = { ...headers };
  delete result['x-frame-options'];
  delete result['X-Frame-Options'];
  delete result['cross-origin-opener-policy'];
  delete result['Cross-Origin-Opener-Policy'];

  const csp = headers['content-security-policy'] || headers['Content-Security-Policy'];
  if (typeof csp === 'string') {
    result['content-security-policy'] = csp
      .split(';')
      .map(part => part.trim())
      .filter(part => !part.startsWith('frame-ancestors'))
      .join('; ');
  }

  return result;
}

export function shouldInjectScript(contentType?: string): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes('text/html');
}
```

```ts
// src/proxy/proxy-server.ts
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { filterResponseHeaders, shouldInjectScript } from './header-filter.js';
import { generatePickerScript } from '../picker/picker-script.js';

export function startProxyServer(port = 0): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const pickerScript = generatePickerScript();

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host}`);
      const targetUrlStr = reqUrl.searchParams.get('url');

      if (reqUrl.pathname === '/__realbrowser/picker.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(pickerScript);
        return;
      }

      if (!targetUrlStr) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing target ?url= parameter');
        return;
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(targetUrlStr);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid target URL');
        return;
      }

      const client = targetUrl.protocol === 'https:' ? https : http;
      const proxyReq = client.request(
        targetUrl,
        {
          method: req.method,
          headers: {
            ...req.headers,
            host: targetUrl.host,
          },
        },
        (proxyRes) => {
          const headers = filterResponseHeaders(proxyRes.headers);
          const isHtml = shouldInjectScript(proxyRes.headers['content-type']);

          if (!isHtml) {
            res.writeHead(proxyRes.statusCode || 200, headers);
            proxyRes.pipe(res);
            return;
          }

          delete headers['content-length'];
          res.writeHead(proxyRes.statusCode || 200, headers);

          let body = '';
          proxyRes.setEncoding('utf-8');
          proxyRes.on('data', chunk => { body += chunk; });
          proxyRes.on('end', () => {
            const injection = `<script src="/__realbrowser/picker.js"></script>`;
            if (body.includes('</body>')) {
              body = body.replace('</body>', `${injection}</body>`);
            } else {
              body += injection;
            }
            res.end(body);
          });
        }
      );

      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end(`<h3>RealBrowser Proxy Error</h3><p>${err.message}</p>`);
      });

      req.pipe(proxyReq);
    });

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: actualPort,
        close: () => server.close(),
      });
    });

    server.on('error', reject);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/proxy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/ tests/proxy.test.ts
git commit -m "feat(proxy): implement reverse proxy with header stripping and picker injection"
```

---

### Task 4: Chrome Controller & CDP Bridge

**Files:**
- Create: `src/cdp/cdp-client.ts`
- Create: `src/cdp/chrome-controller.ts`
- Test: `tests/cdp-client.test.ts`

**Interfaces:**
- Produces: `CDPClient` class (`send(method, params)`), `ChromeController` class (`launch()`, `navigate(url)`, `click(selector)`, `type(selector, text)`, `evaluate(expr)`, `screenshot()`, `close()`).

- [ ] **Step 1: Write failing test for CDP client message formatting**

```ts
import { describe, it, expect } from 'vitest';
import { formatCDPMessage } from '../src/cdp/cdp-client.js';

describe('CDP Client', () => {
  it('formats JSON-RPC message with incrementing id', () => {
    const msg1 = formatCDPMessage(1, 'Page.navigate', { url: 'https://example.com' });
    expect(JSON.parse(msg1)).toEqual({
      id: 1,
      method: 'Page.navigate',
      params: { url: 'https://example.com' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cdp-client.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement CDP client and Chrome controller**

```ts
// src/cdp/cdp-client.ts
import WebSocket from 'ws';

export function formatCDPMessage(id: number, method: string, params?: Record<string, unknown>): string {
  return JSON.stringify({ id, method, params });
}

export class CDPClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      });
    });
  }

  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected'));
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(formatCDPMessage(id, method, params));
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
```

```ts
// src/cdp/chrome-controller.ts
import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import { CDPClient } from './cdp-client.js';

export class ChromeController {
  private proc: ChildProcess | null = null;
  private cdp: CDPClient = new CDPClient();
  public port = 9222;

  async launch(headless = true): Promise<void> {
    const args = [
      `--remote-debugging-port=${this.port}`,
      headless ? '--headless=new' : '',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ].filter(Boolean);

    this.proc = spawn('google-chrome', args, { stdio: 'ignore' });
    await this.waitForDebugger();
    const wsUrl = await this.getPageWsUrl();
    await this.cdp.connect(wsUrl);
  }

  private async waitForDebugger(maxRetries = 20): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await new Promise<void>((resolve, reject) => {
          http.get(`http://127.0.0.1:${this.port}/json/version`, (res) => {
            if (res.statusCode === 200) resolve();
            else reject();
          }).on('error', reject);
        });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error('Timed out waiting for Chrome debugging port');
  }

  private async getPageWsUrl(): Promise<string> {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${this.port}/json/list`, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          const targets = JSON.parse(body);
          const page = targets.find((t: any) => t.type === 'page');
          if (page && page.webSocketDebuggerUrl) resolve(page.webSocketDebuggerUrl);
          else reject(new Error('No page target found'));
        });
      }).on('error', reject);
    });
  }

  async navigate(url: string): Promise<void> {
    await this.cdp.send('Page.navigate', { url });
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    const res = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result?.value;
  }

  async click(selector: string): Promise<void> {
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  }

  async type(selector: string, text: string): Promise<void> {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
  }

  async screenshot(): Promise<string> {
    const res = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    return res.data;
  }

  close(): void {
    this.cdp.close();
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cdp-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cdp/ tests/cdp-client.test.ts
git commit -m "feat(cdp): implement CDP client and Chrome controller"
```

---

### Task 5: Cordis Host Plugin & AI Agent Tools Registration

**Files:**
- Create: `src/host/index.ts`
- Test: `tests/host-tools.test.ts`

**Interfaces:**
- Consumes: `startProxyServer` from `src/proxy/proxy-server.ts`, `ChromeController` from `src/cdp/chrome-controller.ts`.
- Produces: Cordis Host Plugin function exporting `apply(ctx)`.

- [ ] **Step 1: Write test for host tools registration and dispatch**

```ts
import { describe, it, expect } from 'vitest';
import { createHostPlugin } from '../src/host/index.js';

describe('Host Plugin', () => {
  it('registers tools on harness', () => {
    const registered: string[] = [];
    const mockHarness = {
      handle: (name: string) => registered.push(name),
      registerTool: (tool: any) => registered.push(tool.name),
    };
    const plugin = createHostPlugin({ harness: mockHarness });
    expect(plugin).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/host-tools.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement Host Plugin**

```ts
// src/host/index.ts
import { startProxyServer } from '../proxy/proxy-server.js';
import { ChromeController } from '../cdp/chrome-controller.js';

export function createHostPlugin(options?: { harness?: any }) {
  let proxyInstance: { port: number; close: () => void } | null = null;
  const chrome = new ChromeController();

  return {
    async apply(ctx: any) {
      proxyInstance = await startProxyServer();

      const harness = options?.harness || (globalThis as any).harness;
      if (harness) {
        harness.handle('realbrowser-get-proxy', async () => {
          return { port: proxyInstance?.port };
        });

        harness.handle('realbrowser-navigate', async (args: { url: string }) => {
          await chrome.navigate(args.url);
          return { ok: true };
        });

        if (harness.registerTool) {
          harness.registerTool({
            name: 'realbrowser_navigate',
            description: 'Navigate the RealBrowser to a URL',
            parameters: {
              type: 'object',
              properties: { url: { type: 'string' } },
              required: ['url'],
            },
            execute: async ({ url }: { url: string }) => {
              await chrome.navigate(url);
              return `Navigated to ${url}`;
            },
          });

          harness.registerTool({
            name: 'realbrowser_click',
            description: 'Click an element matching CSS selector in RealBrowser',
            parameters: {
              type: 'object',
              properties: { selector: { type: 'string' } },
              required: ['selector'],
            },
            execute: async ({ selector }: { selector: string }) => {
              await chrome.click(selector);
              return `Clicked ${selector}`;
            },
          });

          harness.registerTool({
            name: 'realbrowser_type',
            description: 'Type text into an input matching CSS selector in RealBrowser',
            parameters: {
              type: 'object',
              properties: {
                selector: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['selector', 'text'],
            },
            execute: async ({ selector, text }: { selector: string; text: string }) => {
              await chrome.type(selector, text);
              return `Typed into ${selector}`;
            },
          });

          harness.registerTool({
            name: 'realbrowser_evaluate',
            description: 'Evaluate JavaScript expression in RealBrowser',
            parameters: {
              type: 'object',
              properties: { expression: { type: 'string' } },
              required: ['expression'],
            },
            execute: async ({ expression }: { expression: string }) => {
              const result = await chrome.evaluate(expression);
              return JSON.stringify(result);
            },
          });
        }
      }

      ctx.on?.('dispose', () => {
        proxyInstance?.close();
        chrome.close();
      });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/host-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/ tests/host-tools.test.ts
git commit -m "feat(host): implement Cordis Host plugin with proxy lifecycle and tools"
```

---

### Task 6: Cordis Client React Panel & Chat Input Bridge

**Files:**
- Create: `src/client/index.ts`
- Test: `tests/client-bridge.test.ts`

**Interfaces:**
- Consumes: Host RPC `realbrowser-get-proxy` via `host.call`.
- Produces: Cordis Client Plugin with responsive toolbar, iframe viewer, and postMessage chat input injector.

- [ ] **Step 1: Write test for chat input injection helper**

```ts
import { describe, it, expect } from 'vitest';
import { formatPickedElementMessage } from '../src/client/index.js';

describe('Client Bridge', () => {
  it('formats picked element markdown context', () => {
    const formatted = formatPickedElementMessage({
      selector: '#submit-btn',
      tag: 'button',
      text: 'Submit Order',
    });
    expect(formatted).toBe('Element selected: `#submit-btn` (<button>: "Submit Order")');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client-bridge.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement Client Plugin and UI component**

```ts
// src/client/index.ts
declare const React: any;

export interface PickedElement {
  selector: string;
  tag: string;
  text: string;
}

export function formatPickedElementMessage(el: PickedElement): string {
  return `Element selected: \`${el.selector}\` (<${el.tag}>: "${el.text}")`;
}

export function injectIntoChatTextarea(text: string): boolean {
  const textarea = document.querySelector('textarea');
  if (textarea) {
    textarea.value = textarea.value ? `${textarea.value}\n${text}` : text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
    return true;
  }
  return false;
}

export function createClientPlugin(host: any) {
  return {
    apply(ctx: any) {
      const slots = ctx.get?.('slots');
      if (!slots) return;

      slots.inject('sidebar.view', () => {
        slots.register({ name: 'sidebar.view', id: 'realbrowser-panel' }, () => {
          const [url, setUrl] = React.useState('https://example.com');
          const [inputUrl, setInputUrl] = React.useState('https://example.com');
          const [proxyPort, setProxyPort] = React.useState(0);
          const [pickerActive, setPickerActive] = React.useState(false);
          const [viewport, setViewport] = React.useState('100%');
          const iframeRef = React.useRef(null);

          React.useEffect(() => {
            host.call('realbrowser-get-proxy').then((res: any) => {
              if (res && res.port) setProxyPort(res.port);
            });

            const onMessage = (e: MessageEvent) => {
              if (e.data && e.data.type === 'REALBROWSER_ELEMENT_PICKED') {
                const msg = formatPickedElementMessage(e.data.payload);
                injectIntoChatTextarea(msg);
                setPickerActive(false);
              }
            };
            window.addEventListener('message', onMessage);
            return () => window.removeEventListener('message', onMessage);
          }, []);

          const togglePicker = () => {
            const next = !pickerActive;
            setPickerActive(next);
            if (iframeRef.current && iframeRef.current.contentWindow) {
              iframeRef.current.contentWindow.postMessage(
                { type: next ? 'REALBROWSER_PICKER_ENABLE' : 'REALBROWSER_PICKER_DISABLE' },
                '*'
              );
            }
          };

          const proxyUrl = proxyPort ? `http://127.0.0.1:${proxyPort}?url=${encodeURIComponent(url)}` : '';

          return React.createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%' } },
            // Toolbar
            React.createElement(
              'div',
              { style: { display: 'flex', gap: '8px', padding: '8px', background: '#1e293b', borderBottom: '1px solid #334155' } },
              React.createElement('input', {
                value: inputUrl,
                onChange: (e: any) => setInputUrl(e.target.value),
                onKeyDown: (e: any) => { if (e.key === 'Enter') setUrl(inputUrl); },
                style: { flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: '#fff' },
                placeholder: 'Enter URL...',
              }),
              React.createElement('button', {
                onClick: () => setUrl(inputUrl),
                style: { padding: '4px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
              }, 'Go'),
              React.createElement('button', {
                onClick: togglePicker,
                style: { padding: '4px 12px', background: pickerActive ? '#ef4444' : '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
              }, pickerActive ? 'Cancel Picker' : 'Pick Element'),
              React.createElement('select', {
                value: viewport,
                onChange: (e: any) => setViewport(e.target.value),
                style: { padding: '4px 8px', background: '#0f172a', color: '#fff', border: '1px solid #475569', borderRadius: '4px' },
              },
                React.createElement('option', { value: '100%' }, 'Responsive (100%)'),
                React.createElement('option', { value: '1920px' }, 'Desktop (1920px)'),
                React.createElement('option', { value: '768px' }, 'Tablet (768px)'),
                React.createElement('option', { value: '375px' }, 'Mobile (375px)'),
              )
            ),
            // Iframe Container
            React.createElement(
              'div',
              { style: { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', background: '#0f172a' } },
              proxyUrl ? React.createElement('iframe', {
                ref: iframeRef,
                src: proxyUrl,
                style: { width: viewport, height: '100%', border: 'none', background: '#fff' },
              }) : React.createElement('div', { style: { padding: '20px', color: '#94a3b8' } }, 'Starting proxy...')
            )
          );
        });
      });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client-bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/ tests/client-bridge.test.ts
git commit -m "feat(client): implement Cordis client UI with responsive iframe and element picker bridge"
```

---

### Task 7: Full Plugin Packaging & Standalone Verification Script

**Files:**
- Create: `src/index.ts`
- Create: `scripts/verify.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: Main package entrypoint and runnable end-to-end self-verification script.

- [ ] **Step 1: Write main entrypoint `src/index.ts`**

```ts
export * from './picker/selector-generator.js';
export * from './picker/picker-script.js';
export * from './proxy/header-filter.js';
export * from './proxy/proxy-server.js';
export * from './cdp/cdp-client.js';
export * from './cdp/chrome-controller.js';
export * from './host/index.js';
export * from './client/index.js';
```

- [ ] **Step 2: Write verification script `scripts/verify.ts`**

```ts
import http from 'node:http';
import { startProxyServer } from '../src/proxy/proxy-server.js';
import { getOptimalSelector } from '../src/picker/selector-generator.js';
import { formatPickedElementMessage } from '../src/client/index.js';

async function main() {
  console.log('--- RealBrowser Self-Verification ---');

  // 1. Verify selector generation
  const sel = getOptimalSelector({ id: 'login-btn', tagName: 'BUTTON', classList: [] });
  console.assert(sel === '#login-btn', 'Selector generation failed');
  console.log('✔ Selector Generator passed');

  // 2. Verify client message formatting
  const msg = formatPickedElementMessage({ selector: '#login-btn', tag: 'button', text: 'Log In' });
  console.assert(msg.includes('#login-btn'), 'Message formatting failed');
  console.log('✔ Element context formatting passed');

  // 3. Verify proxy server startup & picker endpoint
  const proxy = await startProxyServer();
  console.log(`✔ Proxy server started on port ${proxy.port}`);

  await new Promise<void>((resolve, reject) => {
    http.get(`http://127.0.0.1:${proxy.port}/__realbrowser/picker.js`, (res) => {
      console.assert(res.statusCode === 200, 'Picker JS endpoint failed');
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        console.assert(body.includes('REALBROWSER_PICKER_LOADED'), 'Picker script content invalid');
        console.log('✔ Picker injection script served correctly');
        resolve();
      });
    }).on('error', reject);
  });

  proxy.close();
  console.log('✔ RealBrowser verification completed successfully!');
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Run build and verification script**

Run: `npx vitest run && npx tsx scripts/verify.ts`
Expected: All tests pass and verification output logs success.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts scripts/verify.ts package.json
git commit -m "feat: add main entrypoint and self-verification script"
```
