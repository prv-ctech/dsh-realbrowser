import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ChromeController, resolveChromeBinary } from '../src/cdp/chrome-controller.js';

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return (server.address() as { port: number }).port;
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  let value: T;
  do {
    value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for browser state: ${String(value!)}`);
}

describe('real browser flow', () => {
  let controller: ChromeController | undefined;
  let fixture: http.Server | undefined;

  afterEach(async () => {
    controller?.close();
    controller = undefined;
    if (fixture?.listening) await new Promise<void>((resolve) => fixture!.close(() => resolve()));
    fixture = undefined;
  });

  it('preserves a cookie-backed login flow across history and reload', async (context) => {
    let binary: string;
    try {
      binary = resolveChromeBinary();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('RealBrowser could not find a Chrome/Chromium executable.')) {
        context.skip();
        return;
      }
      throw error;
    }

    fixture = http.createServer((request, response) => {
      const path = new URL(request.url || '/', 'http://fixture.test').pathname;
      if (request.method === 'POST' && path === '/login') {
        request.resume();
        response.writeHead(303, { location: '/session', 'set-cookie': 'auth=1; Path=/; SameSite=Lax' });
        response.end();
        return;
      }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (path === '/') response.end('<a id="login-link" href="/login">Log in</a>');
      else if (path === '/login') response.end('<form method="post"><input id="name" name="name"><button id="submit">Sign in</button></form>');
      else if (path === '/session') response.end('<p>session ready</p><a id="next-link" href="/next">Continue</a>');
      else if (path === '/next') response.end(request.headers.cookie?.includes('auth=1') ? '<p>signed in</p>' : '<p>signed out</p>');
      else { response.statusCode = 404; response.end('missing'); }
    });
    const fixturePort = await listen(fixture);
    controller = new ChromeController(undefined, 0, binary);
    await controller.ensureLaunched(true);

    await controller.navigate(`http://127.0.0.1:${fixturePort}/`);
    await waitFor(() => controller!.evaluate('location.pathname'), (path) => path === '/');
    await controller.click('#login-link');
    await waitFor(() => controller!.evaluate('location.pathname'), (path) => path === '/login');
    await controller.type('#name', 'Ada');
    await controller.click('#submit');
    await waitFor(() => controller!.evaluate('location.pathname'), (path) => path === '/session');
    await controller.click('#next-link');
    await waitFor(() => controller!.evaluate('location.pathname'), (path) => path === '/next');

    expect(await controller.evaluate('location.pathname')).toBe('/next');
    await controller.goBack();
    await waitFor(() => controller!.evaluate('location.pathname'), (path) => path === '/session');
    expect(await controller.evaluate('location.pathname')).toBe('/session');
    await controller.goForward();
    await waitFor(() => controller!.evaluate('location.pathname'), (path) => path === '/next');
    expect(await controller.evaluate('location.pathname')).toBe('/next');
    await controller.reload();
    await waitFor(() => controller!.evaluate('document.readyState'), (state) => state === 'complete');
    expect(await controller.evaluate('document.body.textContent')).toContain('signed in');
  }, 20_000);
});
