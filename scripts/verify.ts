import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { ChromeController, resolveChromeBinary } from '../src/cdp/chrome-controller.js';
import { resolveViewportMetrics } from '../src/browser/viewports.js';

async function listen(server: http.Server | net.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return (server.address() as net.AddressInfo).port;
}

async function unusedPort(): Promise<number> {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
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

async function main() {
  console.log('--- RealBrowser Self-Verification ---');
  assert.deepEqual(resolveViewportMetrics('desktop-1080p', { width: 1, height: 1 }), {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
  });
  console.log('✔ Viewport catalog');

  const server = http.createServer((request, response) => {
    const path = new URL(request.url || '/', 'http://fixture.test').pathname;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (path === '/') {
      response.end('<a id="next" href="/next">Next</a>');
    } else if (path === '/next') {
      response.end('<button id="capture" style="position:absolute;left:40px;top:40px;width:200px;height:60px">Capture me</button>');
    } else {
      response.statusCode = 404;
      response.end('missing');
    }
  });
  let controller: ChromeController | undefined;
  try {
    const fixturePort = await listen(server);
    controller = new ChromeController(undefined, await unusedPort(), resolveChromeBinary());
    await controller.ensureLaunched(true);
    console.log('✔ Chrome launch');

    await controller.setViewport(resolveViewportMetrics('desktop-1080p', { width: 1, height: 1 }));
    await controller.navigate(`http://127.0.0.1:${fixturePort}/`);
    await waitFor(() => controller!.evaluate('document.readyState'), (state) => state === 'complete');
    assert.deepEqual(await controller.evaluate('[window.innerWidth, window.innerHeight]'), [1920, 1080]);
    console.log('✔ Navigation and viewport metrics');

    await controller.click('#next');
    await waitFor(() => controller!.evaluate('location.pathname'), (path) => path === '/next');
    await controller.goBack();
    await waitFor(() => controller!.evaluate('location.pathname'), (path) => path === '/');
    await controller.goForward();
    await waitFor(() => controller!.evaluate('location.pathname'), (path) => path === '/next');
    await controller.reload();
    await waitFor(() => controller!.evaluate('document.readyState'), (state) => state === 'complete');
    console.log('✔ Back, forward, and reload');

    const picked = await controller.pickElementAt(140, 70);
    assert.equal(picked.selector, '#capture');
    assert.equal(picked.screenshotMediaType, 'image/webp');
    assert.ok(Buffer.from(picked.screenshotBase64, 'base64').byteLength > 0);
    console.log('✔ WebP element capture');
  } finally {
    controller?.close();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log('✔ RealBrowser verification completed');
}

main().catch((error) => {
  console.error('Verification failed:', error);
  process.exitCode = 1;
});
