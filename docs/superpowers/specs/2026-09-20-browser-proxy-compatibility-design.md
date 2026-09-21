# RealBrowser Vanilla Embedded Proxy Compatibility Design

## Status

Approved direction: keep the stock DSH Desktop application, keep the browser embedded in the existing DSH panel, avoid screen streaming and external browser windows, and improve the current proxy on a best-effort basis.

## Problem

The panel receives the target HTML successfully, but pages can still appear blank. The reproduced failure is:

1. `https://arrweeb.prvmr.com/login` returns HTTP 200 through the proxy.
2. Its CSP contains `base-uri 'self'`.
3. The proxy injects `<base href="https://arrweeb.prvmr.com/login">` into a document whose actual origin is `http://127.0.0.1:<proxy-port>`.
4. The browser rejects that base as non-self.
5. Root-relative assets such as `/styles.css` and `/main.js` resolve to the proxy without a `?url=` target.
6. The proxy returns HTTP 400 (`Missing target ?url= parameter`), leaving an unstyled or blank page.

The same origin mismatch also causes partial failures on large applications such as YouTube. A rewriting proxy cannot guarantee compatibility with every website because of cookies, service workers, CORS, browser origin checks, and application-specific URL construction.

## Goals

- Add `https://` when a user enters a bare domain such as `youtube.com`.
- Preserve explicit `http://` and `https://` URLs.
- Keep target documents and their relative subresources on the local proxy origin.
- Fix the reproduced CSP/base/subresource failure without modifying DSH Desktop.
- Show useful proxy errors instead of an unexplained white surface.
- Preserve the existing CDP tools and panel controls.

## Non-goals

- Guaranteed compatibility with every website.
- Rebuilding or patching DSH Desktop.
- Embedding Chromium or CEF in the native shell.
- Streaming Chrome screenshots into the panel.
- Replacing the existing browser plugin architecture.

## Design

### URL normalization

Add one exported client helper that trims input and returns:

- unchanged `http://...` or `https://...` input;
- `https://` plus the input when no HTTP scheme exists;
- an empty result for blank input.

Both Enter and Go use the normalized value. The normalized value updates the address field before navigation, so the user sees the actual URL being loaded.

### Proxy origin facade

The proxy will keep relative resource requests on its own origin instead of pointing the document base at the target origin.

For each successful HTML navigation:

1. Follow redirects as today and retain the final target URL.
2. Set a short proxy cookie containing only the final target origin.
3. Inject a same-origin base URL using the proxy origin plus the final target pathname.
4. Keep the existing picker script on the proxy origin.

For a later request that has no `?url=` parameter:

1. Read the target-origin cookie.
2. Resolve the request pathname and query against that origin.
3. Proxy the resulting HTTP(S) URL normally.
4. Return a visible HTTP 400 page when no target context exists.

This makes `/styles.css`, `/main.js`, nested CSS assets, same-origin `fetch('/api')`, and relative navigations remain same-origin from the browser's perspective. Existing CSP `'self'` directives continue to allow them because the browser still sees the proxy origin. The injected base also satisfies `base-uri 'self'`.

### Error handling

- Reject non-HTTP(S) targets before opening an upstream request.
- HTML-escape text inserted into proxy error pages.
- Return a styled error document with the failing target and concise reason.
- The client must not replace the current page when normalized input is blank.

### Scope and lifecycle

The proxy keeps one target-origin context per browser cookie. This matches the current single embedded browser surface. Multiple simultaneous browser panels sharing the same proxy origin remain a documented ceiling; add per-panel session identifiers only if real multi-panel use appears.

## Files

- `src/client/index.ts`: URL normalization and navigation behavior.
- `src/proxy/proxy-server.ts`: target context cookie, same-origin base, fallback subresource resolution, visible errors.
- `tests/client-bridge.test.ts`: bare-domain, explicit-scheme, whitespace, and blank-input behavior.
- `tests/proxy.test.ts`: CSP-compatible base, cookie-backed subresource requests, invalid context, and protocol rejection.

## Testing

Follow TDD for each behavior:

1. Add focused failing tests and confirm expected failures.
2. Implement the minimum client normalization.
3. Implement the minimum proxy origin facade.
4. Run focused client and proxy tests.
5. Run the complete suite and build.
6. Verify live in a disposable second DSH instance with:
   - `youtube.com` entered without a scheme;
   - `google.com` entered without a scheme;
   - `https://arrweeb.prvmr.com/login` loading its CSS and JavaScript without proxy 400 responses;
   - the address field retaining the normalized URL.

## Acceptance criteria

- Entering `youtube.com` navigates to and displays `https://youtube.com` in the address field.
- Explicit HTTP(S) input remains unchanged.
- Blank input does not navigate.
- The reproduced login page no longer fails because `/styles.css`, `/main.js`, and `/theme-init.js` lack `?url=`.
- Proxy error responses contain a visible reason.
- Existing redirect, picker, CDP, and URL-poll tests remain green.
- No DSH Desktop files, capabilities, or binaries are modified.
