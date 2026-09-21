# RealBrowser Picker Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RealBrowser element selection reliable, repeatable, isolated across profiles, blue-highlighted, and diagnostically useful.

**Architecture:** Resolve page elements atomically with `document.elementFromPoint()` instead of raw CDP compositor nodes. Let Chrome allocate its CDP port through `DevToolsActivePort`; keep the existing controller lifecycle. Preserve the existing DSH conversation attachment seam while leaving picker mode active for repeated clicks.

**Tech Stack:** TypeScript, Node.js, Chrome DevTools Protocol, React without JSX, Vitest, DSH/Cordis client and host plugins.

**Spec:** `docs/superpowers/plans/2026-09-21-realbrowser-picker-reliability-design.md`

## Global Constraints

- Do not modify DeepSeek Harness engine source.
- Add no dependency, browser pool, persistent browser profile, or new configuration.
- Keep cross-origin iframe selection at the iframe host boundary.
- Preserve existing browser controls, attachment format, and controller lifecycle.
- Every behavior change follows red-green-refactor.

---

### Task 1: Normalize element hit testing

**Files:**
- Modify: `tests/element-inspection.test.ts`
- Modify: `src/cdp/chrome-controller.ts:131-178,323-414`

**Interfaces:**
- Consumes: `CDPClient.send(method, params)` and `PickedElementResult`.
- Produces: unchanged `inspectElementAt(x, y)` and `pickElementAt(x, y)` signatures.

- [ ] **Step 1: Write failing behavior tests**

Change the CDP fake so `Runtime.evaluate` returns an element-owned payload:

```ts
'Runtime.evaluate': {
  result: { value: {
    selector: '#sign-in',
    xpath: '//*[@id="sign-in"]',
    tag: 'a',
    text: 'Sign in',
    html: '<a id="sign-in">Sign in</a>',
    url: 'https://example.test/',
    bounds: { x: 361, y: 8.5, width: 75, height: 40 },
  } },
},
```

Assert that inspection calls `Runtime.evaluate`, its expression contains both `document.elementFromPoint` and `shadowRoot.elementFromPoint`, and it never calls `DOM.getNodeForLocation`. Keep screenshot assertions against viewport-relative bounds plus page offsets. Add null-result and zero-size bounds cases.

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
npm test -- --run tests/element-inspection.test.ts
```

Expected: failures because inspection still calls `DOM.getNodeForLocation` and ignores the `Runtime.evaluate` hit-test payload.

- [ ] **Step 3: Implement one page-context hit test**

Replace `ELEMENT_METADATA_FUNCTION` with a callable expression equivalent to:

```ts
const ELEMENT_AT_POINT_FUNCTION = String.raw`function(x, y) {
  let element = document.elementFromPoint(x, y);
  while (element && element.shadowRoot) {
    const nested = element.shadowRoot.elementFromPoint(x, y);
    if (!nested || nested === element) break;
    element = nested;
  }
  if (!element) return null;
  // Keep existing selector and XPath generation here.
  const rect = element.getBoundingClientRect();
  return {
    selector,
    xpath,
    tag: element.tagName.toLowerCase(),
    text: (element.textContent || '').trim().slice(0, 500),
    html: (element.outerHTML || '').slice(0, 4000),
    url: location.href,
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}`;
```

Call it with finite numeric coordinates through `Runtime.evaluate({ expression, returnByValue: true })`. Validate the returned metadata and bounds. Remove the obsolete `DOM.getNodeForLocation`, `DOM.getBoxModel`, `DOM.resolveNode`, and `Runtime.releaseObject` path. Keep screenshot clipping unchanged.

- [ ] **Step 4: Run focused test and verify GREEN**

```bash
npm test -- --run tests/element-inspection.test.ts
```

Expected: all element-inspection tests pass.

- [ ] **Step 5: Commit the task**

```bash
git add src/cdp/chrome-controller.ts tests/element-inspection.test.ts
git commit -m "fix: normalize picker hit targets"
```

---

### Task 2: Give each Chrome process its own CDP port

**Files:**
- Modify: `tests/cdp-client.test.ts`
- Modify: `src/cdp/chrome-controller.ts:180-204,468-552`

**Interfaces:**
- Consumes: Chrome’s `<user-data-dir>/DevToolsActivePort` file.
- Produces: `ChromeController.port`, initially `0` by default and updated to Chrome’s assigned port after launch.

- [ ] **Step 1: Write failing isolation tests**

Add:

```ts
it('defaults to a Chrome-assigned debugging port', () => {
  expect(new ChromeController(mockCdp).port).toBe(0);
});

it('reads Chrome assigned port before debugger polling', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200); res.end('{}'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realbrowser-port-test-'));
  fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), `${port}\n/devtools/browser/test\n`);
  const controller = new ChromeController(mockCdp);
  (controller as any).userDataDir = dir;
  await (controller as any).waitForDebugger(2);
  expect(controller.port).toBe(port);
  controller.close();
  server.close();
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- --run tests/cdp-client.test.ts
```

Expected: default port remains `9222`, and `waitForDebugger` does not read `DevToolsActivePort`.

- [ ] **Step 3: Implement Chrome-assigned port discovery**

Set the constructor default to `0` and keep explicit non-zero ports unchanged. Launch with `--remote-debugging-port=0`. Before HTTP polling, wait for and parse the first line of `DevToolsActivePort`:

```ts
private readAssignedPort(): number | undefined {
  if (this.port !== 0 || !this.userDataDir) return this.port || undefined;
  try {
    const value = Number.parseInt(
      fs.readFileSync(path.join(this.userDataDir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/, 1)[0],
      10,
    );
    if (Number.isInteger(value) && value > 0 && value <= 65535) return value;
  } catch {}
  return undefined;
}
```

In each debugger retry, assign the discovered port before requesting `/json/version`. Do not connect to any pre-existing fixed port.

- [ ] **Step 4: Run focused test and verify GREEN**

```bash
npm test -- --run tests/cdp-client.test.ts
```

Expected: all controller tests pass.

- [ ] **Step 5: Commit the task**

```bash
git add src/cdp/chrome-controller.ts tests/cdp-client.test.ts
git commit -m "fix: isolate Chrome debugging ports"
```

---

### Task 3: Keep picker active and expose useful feedback

**Files:**
- Modify: `tests/client-bridge.test.ts`
- Modify: `src/client/index.ts:20-28,292-325,415-484`

**Interfaces:**
- Consumes: unchanged `attachPickedElement(ctx, sessionId, result)`.
- Produces: exported `callApi(method, payload?)`, persistent picker state, blue overlay.

- [ ] **Step 1: Write failing client tests**

Add an API test:

```ts
it('surfaces JSON API errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ error: 'Element moved before capture' }),
    { status: 500, headers: { 'content-type': 'application/json' } },
  )));
  await expect(callApi('pick-element', { x: 1, y: 2 }))
    .rejects.toThrow('Element moved before capture');
});
```

Extend the picker render test with a captured picker setter and valid conversation stub. Await two sequential clicks and assert `addAttachments` receives two batches while the picker setter is never called with `false`. Assert overlay styles equal `2px solid #3b82f6` and `rgba(59, 130, 246, 0.18)`.

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- --run tests/client-bridge.test.ts tests/chat-bridge.test.ts
```

Expected: API error is generic, successful pick disables picker, and overlay uses the theme brand token.

- [ ] **Step 3: Implement minimal client changes**

Export `callApi`. On failure, parse JSON once and throw `body.error` when it is a non-empty string; otherwise retain `RealBrowser request failed (<status>)`. Remove `setPickerActive(false)` from successful selection. Keep generation invalidation and overlay clearing so the next hover starts clean. Set overlay colors to:

```ts
border: '2px solid #3b82f6',
background: 'rgba(59, 130, 246, 0.18)',
```

Do not alter attachment creation or fallback clipboard behavior.

- [ ] **Step 4: Run focused test and verify GREEN**

```bash
npm test -- --run tests/client-bridge.test.ts tests/chat-bridge.test.ts
```

Expected: all client and attachment tests pass.

- [ ] **Step 5: Commit the task**

```bash
git add src/client/index.ts tests/client-bridge.test.ts
git commit -m "fix: support repeated element picks"
```

---

### Task 4: Verify isolated live behavior and stress real pages

**Files:**
- Modify only if a regression is found: files from Tasks 1-3.
- Temporary runtime data: `/tmp/realbrowser-stress-*` (remove after verification).

**Interfaces:**
- Consumes: built package, temporary DSH profiles, HTTP picker routes.
- Produces: verification evidence only; no permanent stress framework.

- [ ] **Step 1: Run static and full automated gates**

```bash
npm run build
npm test -- --run
git diff --check
```

Expected: zero failures and clean diff validation.

- [ ] **Step 2: Start two temporary profiles**

Create two temporary DSH homes whose profile depends on `link:/home/prv-cn/Documents/realbrowser`, then launch them on separate DSH web ports. Call each `/realbrowser/api/navigate` once.

Assert process arguments show two non-conflicting Chrome-assigned debugger ports and that navigation in profile A does not change profile B’s URL.

- [ ] **Step 3: Stress real page element selection**

For Google, YouTube, Facebook, and DuckDuckGo, collect visible element centers in page context and issue at least 25 `pick-element` requests per site. Include the previously failing Google coordinates `(367, 28)` and `(305, 470)` at the verified `446×951` viewport.

Expected: no pseudo-element, shadow-root, box-model, or metadata 500 response. Every success has non-empty tag, bounds, and WebP data.

- [ ] **Step 4: Exercise repeated chat attachment flow**

In one temporary profile session, keep picker mode active and select five elements before sending. Verify the composer contains five metadata files plus five WebP images and no generic 500 message.

- [ ] **Step 5: Clean temporary resources**

Stop both temporary DSH processes, confirm their Chrome children exit, and remove `/tmp/realbrowser-stress-*`.

- [ ] **Step 6: Review final scope**

```bash
git status --short
git diff HEAD~3 --stat
git log -3 --oneline
```

Expected: only plugin source, focused tests, and these design/plan documents changed; DSH engine remains untouched.
