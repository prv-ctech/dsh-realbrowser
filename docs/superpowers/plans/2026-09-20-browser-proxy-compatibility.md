# Browser Proxy Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bare-domain navigation work and stop proxied HTML pages from going blank when relative resources lose their target URL.

**Architecture:** Keep the stock DSH Desktop and existing iframe proxy. Normalize user input in the client, then make the proxy act as a same-origin facade: successful HTML navigation stores the final target origin in a proxy cookie, injects a local same-origin base URL, and resolves later path-only requests against that stored origin.

**Tech Stack:** TypeScript, React, Node `http`/`https`, Vitest, CDP/Puppeteer live verification.

**Spec:** `docs/superpowers/specs/2026-09-20-browser-proxy-compatibility-design.md`

## Global Constraints

- Do not modify DSH Desktop files, capabilities, binaries, or shipped presets.
- Do not add screenshot streaming, an external browser window, Chromium/CEF embedding, or new dependencies.
- Preserve explicit `http://` and `https://` input exactly after trimming.
- Prefix every non-empty input without an HTTP(S) scheme with `https://`.
- Accept only HTTP(S) proxy targets.
- Keep existing redirect, picker, CDP, and URL-poll behavior green.
- Treat multi-panel target isolation as out of scope; the current cookie context supports the existing single browser surface.

---

## File Structure

- `src/client/index.ts`: owns pure address normalization and uses it at the existing navigation boundary.
- `tests/client-bridge.test.ts`: proves normalization and client navigation behavior.
- `src/proxy/proxy-server.ts`: owns target resolution, target-context cookie, local base injection, and visible proxy errors.
- `tests/proxy.test.ts`: proves initial HTML navigation, cookie-backed subresources, protocol validation, and error rendering.
- `.rb-verify.mjs`: existing disposable-instance live verification script; update only if its assertions cannot observe the new behavior.

No new runtime source file or dependency is needed.

---

### Task 1: Normalize Address-Bar Input

**Files:**
- Modify: `src/client/index.ts:39-57,114-121`
- Test: `tests/client-bridge.test.ts:1-25,204-310`

**Interfaces:**
- Consumes: existing `onNavigate(url: string)` callback and `host.call('navigate', { url })` bridge.
- Produces: `normalizeHttpUrl(value: string): string`; returns trimmed HTTP(S), prefixes other non-empty input with `https://`, and returns `''` for blank input.

- [ ] **Step 1: Add focused failing normalization tests**

Change the client import to include `normalizeHttpUrl`, then add:

```ts
describe('normalizeHttpUrl', () => {
  it.each([
    ['youtube.com', 'https://youtube.com'],
    ['  google.com/search?q=dsh  ', 'https://google.com/search?q=dsh'],
    ['https://example.com/path', 'https://example.com/path'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['HTTPS://EXAMPLE.COM', 'HTTPS://EXAMPLE.COM'],
    ['', ''],
    ['   ', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeHttpUrl(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```bash
npm test -- --run tests/client-bridge.test.ts
```

Expected: FAIL because `normalizeHttpUrl` is not exported.

- [ ] **Step 3: Add the minimum pure helper**

Add near the top of `src/client/index.ts`:

```ts
export function normalizeHttpUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
```

- [ ] **Step 4: Use the helper at the single navigation boundary**

Replace the current `navigateTo` body with:

```ts
const navigateTo = useCallback((nextUrl: string) => {
  const normalizedUrl = normalizeHttpUrl(nextUrl);
  if (!normalizedUrl) return;
  setInputUrl(normalizedUrl);
  setUrl(normalizedUrl);
  setLoading(true);
  onNavigate(normalizedUrl);
}, [onNavigate]);
```

Keep Enter and Go routed through `navigateTo`; do not duplicate normalization in event handlers.

- [ ] **Step 5: Run the focused client tests**

Run:

```bash
npm test -- --run tests/client-bridge.test.ts
```

Expected: PASS, including all existing URL polling and picker bridge tests.

- [ ] **Step 6: Commit only the client task**

```bash
git add src/client/index.ts tests/client-bridge.test.ts
git commit -m "fix: normalize browser address input"
```

---

### Task 2: Preserve Target Context for Relative Proxy Requests

**Files:**
- Modify: `src/proxy/proxy-server.ts:1-246`
- Test: `tests/proxy.test.ts:44-245`

**Interfaces:**
- Consumes: explicit `?url=<encoded HTTP(S) URL>` navigation requests and ordinary path-only browser requests.
- Produces: cookie `__realbrowser_target_origin=<encoded origin>` with `Path=/; SameSite=Lax`; fallback resolution of `pathname + search` against that origin; same-origin injected `<base>`.

- [ ] **Step 1: Extend the mock upstream with a resource endpoint**

Before the existing `/echo-headers` branch in `tests/proxy.test.ts`, add:

```ts
} else if (url.pathname === '/styles.css') {
  res.writeHead(200, { 'content-type': 'text/css' });
  res.end(`body { color: red; } /* ${url.searchParams.get('v') ?? ''} */`);
```

Change the `/html` fixture body to include a root-relative stylesheet:

```ts
res.end('<!DOCTYPE html><html><head><title>Test</title><link rel="stylesheet" href="/styles.css?v=7"></head><body><h1>Hello</h1></body></html>');
```

- [ ] **Step 2: Replace the remote-base assertion and add failing context tests**

Update the existing HTML proxy test:

```ts
expect(body).toContain(`<base href="http://127.0.0.1:${proxy.port}/html">`);
expect(res.headers.get('set-cookie')).toContain('__realbrowser_target_origin=');
```

Update the existing missing-URL assertion from `Missing target ?url= parameter` to `Missing target URL`; keep the existing malformed-URL assertion on `Invalid target URL`. Add these tests:

```ts
it('resolves a path-only subresource through the target-origin cookie', async () => {
  const targetUrl = `http://127.0.0.1:${upstreamPort}/html`;
  const page = await fetch(`http://127.0.0.1:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);
  const cookie = page.headers.get('set-cookie')?.split(';', 1)[0];

  expect(cookie).toBeTruthy();

  const asset = await fetch(`http://127.0.0.1:${proxy.port}/styles.css?v=7`, {
    headers: { cookie: cookie! },
  });

  expect(asset.status).toBe(200);
  expect(await asset.text()).toContain('/* 7 */');

  const echo = await fetch(`http://127.0.0.1:${proxy.port}/echo-headers`, {
    headers: { cookie: cookie! },
  });
  const upstreamHeaders = await echo.json() as Record<string, string>;
  expect(upstreamHeaders.cookie ?? '').not.toContain('__realbrowser_target_origin');
});

it('returns a visible HTML error without target context', async () => {
  const res = await fetch(`http://127.0.0.1:${proxy.port}/missing.css`);
  expect(res.status).toBe(400);
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(await res.text()).toContain('Missing target URL');
});

it('rejects non-http target protocols', async () => {
  const target = encodeURIComponent('ftp://example.com/file');
  const res = await fetch(`http://127.0.0.1:${proxy.port}/?url=${target}`);
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('Only HTTP and HTTPS targets are supported');
});
```

- [ ] **Step 3: Run the focused proxy test and confirm failures**

Run:

```bash
npm test -- --run tests/proxy.test.ts
```

Expected failures:

- injected base still points at the target origin;
- no `__realbrowser_target_origin` cookie exists;
- `/styles.css?v=7` returns HTTP 400;
- missing context is plain text;
- `ftp:` does not return the required validation message.

- [ ] **Step 4: Add minimal parsing and escaping helpers**

Add near the top of `src/proxy/proxy-server.ts`:

```ts
const TARGET_ORIGIN_COOKIE = '__realbrowser_target_origin';

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const entry of (header ?? '').split(';')) {
    const [name, ...value] = entry.trim().split('=');
    if (!name || value.length === 0) continue;
    try {
      cookies[name] = decodeURIComponent(value.join('='));
    } catch {
      // Ignore malformed cookie values from untrusted requests.
    }
  }
  return cookies;
}

function isHttpTarget(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

function sendProxyError(res: http.ServerResponse, status: number, title: string, detail: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title><style>body{font:14px system-ui;margin:2rem;line-height:1.5}code{overflow-wrap:anywhere}</style><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>`);
}
```

Do not add a cookie package or HTML templating dependency.

- [ ] **Step 5: Resolve explicit and cookie-backed targets at request entry**

Replace the current unconditional `searchParams.get('url')` requirement with:

```ts
const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
const explicitTarget = requestUrl.searchParams.get('url');
const storedOrigin = parseCookies(req.headers.cookie)[TARGET_ORIGIN_COOKIE];

let targetUrl: URL;
if (explicitTarget) {
  try {
    targetUrl = new URL(explicitTarget);
  } catch {
    sendProxyError(res, 400, 'Invalid target URL', 'Enter a valid absolute website address.');
    return;
  }
} else {
  if (!storedOrigin) {
    sendProxyError(res, 400, 'Missing target URL', 'Enter a website address before requesting browser resources.');
    return;
  }
  try {
    targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, storedOrigin);
  } catch {
    sendProxyError(res, 400, 'Missing target URL', 'The saved website origin is invalid. Navigate again.');
    return;
  }
}

if (!isHttpTarget(targetUrl)) {
  sendProxyError(res, 400, 'Unsupported target URL', 'Only HTTP and HTTPS targets are supported.');
  return;
}
```

Keep `/__realbrowser/picker.js` handling before this block so the picker route never needs target context.

- [ ] **Step 6: Keep the proxy-only cookie out of upstream requests**

After creating `proxyHeaders`, remove only the internal context cookie and retain target-site cookies:

```ts
const forwardedCookies = (req.headers.cookie ?? '')
  .split(';')
  .map((entry) => entry.trim())
  .filter((entry) => entry && !entry.startsWith(`${TARGET_ORIGIN_COOKIE}=`))
  .join('; ');

if (forwardedCookies) proxyHeaders.cookie = forwardedCookies;
else delete proxyHeaders.cookie;
```

This satisfies the no-leak assertion while preserving upstream login cookies already handled by the proxy.

- [ ] **Step 7: Inject a local base and append the target-origin cookie**

When the final upstream response is HTML, derive the proxy origin from the request, then assign path and query explicitly so a `//host/path` pathname cannot become a foreign scheme-relative base:

```ts
const proxyOrigin = new URL('/', requestUrl).origin;
const localBase = new URL('/', proxyOrigin);
localBase.pathname = finalUrl.pathname;
localBase.search = finalUrl.search;
const localBaseUrl = localBase.href;
const targetCookie = `${TARGET_ORIGIN_COOKIE}=${encodeURIComponent(finalUrl.origin)}; Path=/; SameSite=Lax`;
const upstreamCookies = headers['set-cookie'];
headers['set-cookie'] = [
  ...(Array.isArray(upstreamCookies) ? upstreamCookies : upstreamCookies ? [upstreamCookies] : []),
  targetCookie,
];
```

Set `headers['set-cookie']` before `res.writeHead(...)`. Pass `localBaseUrl` into the existing HTML injection path so it emits:

```ts
const baseTag = `<base href="${escapeHtml(localBaseUrl)}">`;
```

Keep the picker script URL absolute on the proxy origin. Keep upstream CSP except for the existing `frame-ancestors` removal; the new base is same-origin and satisfies `base-uri 'self'`.

- [ ] **Step 8: Preserve redirect validation and render transport failures safely**

Keep the existing redirect limit and HTTP(S)-only redirect validation in `requestUpstream`. Replace the current raw `err.message` HTML interpolation in `fail` with:

```ts
if (!res.headersSent) {
  sendProxyError(res, 502, 'RealBrowser Proxy Error', err.message);
} else {
  res.destroy();
}
```

This uses the shared escaping path without changing redirect semantics.

- [ ] **Step 9: Run focused proxy tests**

Run:

```bash
npm test -- --run tests/proxy.test.ts
```

Expected: PASS. Confirm the previous redirect, request-header, picker injection, case-insensitive HTML, and missing-body-tag tests also pass.

- [ ] **Step 10: Commit only the proxy task**

```bash
git add src/proxy/proxy-server.ts tests/proxy.test.ts
git commit -m "fix: preserve proxy target for page resources"
```

---

### Task 3: Full Regression and Disposable Live Verification

**Files:**
- Modify only if needed: `.rb-verify.mjs`
- Verify: all production and test files

**Interfaces:**
- Consumes: built plugin package and disposable second DSH instance.
- Produces: evidence that tests/build pass and the live panel no longer emits resource HTTP 400 failures for the reproduced site.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm test -- --run
```

Expected: all test files PASS.

- [ ] **Step 2: Build the plugin**

Run:

```bash
npm run build
```

Expected: exit code 0 and regenerated `dist/index.js` plus `dist/client.cjs`.

- [ ] **Step 3: Check the patch for accidental scope growth**

Run:

```bash
git diff --check HEAD~2..HEAD
git diff --stat HEAD~2..HEAD
```

Expected: no whitespace errors; runtime changes remain limited to the two source files and matching tests.

- [ ] **Step 4: Start a disposable DSH instance, never replace the user-owned app**

Use the existing verification script and the profile copy already used by this repository. Start it as a managed background job, on a different port from `http://127.0.0.1:3080`, then record the exact disposable URL.

Run from the disposable profile:

```bash
node .rb-verify.mjs
```

Expected: script prints the disposable DSH URL, opens the browser panel, and reports navigation diagnostics. If the script currently hard-codes an old assertion, change only that assertion and rerun.

- [ ] **Step 5: Verify bare-domain normalization in the live panel**

In the disposable panel:

1. Enter `youtube.com` and press Enter.
2. Confirm the address field becomes `https://youtube.com`.
3. Enter `google.com` and click Go.
4. Confirm the address field becomes `https://google.com`.

Expected: neither navigation reverts to `https://example.com`.

- [ ] **Step 6: Verify the reproduced login resource flow**

Navigate to:

```text
https://arrweeb.prvmr.com/login
```

Capture browser console/network diagnostics. Expected:

- HTML navigation returns HTTP 200.
- The document contains a base under `http://127.0.0.1:<proxy-port>/login`.
- `/styles.css`, `/main.js`, and `/theme-init.js` no longer return proxy HTTP 400 for a missing `?url=`.
- The page renders content instead of a blank white surface.

- [ ] **Step 7: Stop only disposable verification processes**

Stop the managed disposable DSH job and its test Chrome process. Do not stop or restart `http://127.0.0.1:3080` or any user-owned desktop process.

- [ ] **Step 8: Commit live-check script changes only when necessary**

If `.rb-verify.mjs` changed:

```bash
git add .rb-verify.mjs
git commit -m "test: verify browser proxy compatibility"
```

If no script change was needed, make no empty commit.

- [ ] **Step 9: Request final code review**

Use the `requesting-code-review` skill. Review against both the spec and this plan. Fix only correctness regressions within approved scope, then rerun the affected test and full suite.
