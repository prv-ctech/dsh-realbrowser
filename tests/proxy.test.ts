import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { filterResponseHeaders, cleanHeaders, shouldInjectScript } from '../src/proxy/header-filter.js';
import { startProxyServer } from '../src/proxy/proxy-server.js';
import { generatePickerScript } from '../src/picker/picker-script.js';

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
    expect(cleaned['content-security-policy']).toContain("default-src 'self'");
  });

  it('strips cross-origin-opener-policy', () => {
    const headers = {
      'cross-origin-opener-policy': 'same-origin',
      'content-type': 'text/html',
    };
    const cleaned = filterResponseHeaders(headers);
    expect(cleaned['cross-origin-opener-policy']).toBeUndefined();
  });

  it('cleanHeaders is an alias for filterResponseHeaders', () => {
    expect(cleanHeaders).toBe(filterResponseHeaders);
  });

  it('detects html content for script injection', () => {
    expect(shouldInjectScript('text/html; charset=utf-8')).toBe(true);
    expect(shouldInjectScript('text/html')).toBe(true);
    expect(shouldInjectScript('TEXT/HTML')).toBe(true);
    expect(shouldInjectScript('application/json')).toBe(false);
    expect(shouldInjectScript('image/png')).toBe(false);
    expect(shouldInjectScript(undefined)).toBe(false);
  });
});

describe('Proxy Server', () => {
  let proxy: { port: number; close: () => void };
  let upstreamServer: http.Server;
  let upstreamPort: number;

  beforeAll(async () => {
    // Start mock upstream server
    upstreamServer = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      if (url.pathname === '/html') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'x-frame-options': 'DENY',
          'content-security-policy': "frame-ancestors 'none'; script-src 'self'",
          'cross-origin-opener-policy': 'same-origin',
        });
        res.end('<!DOCTYPE html><html><head><title>Test</title><link rel="stylesheet" href="/styles.css?v=7"></head><body><h1>Hello</h1></body></html>');
      } else if (url.pathname === '/html-cookie') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': 'site_a=secret; Path=/',
        });
        res.end('<!DOCTYPE html><html><head><title>Cookie</title></head><body>Cookie</body></html>');
      } else if (url.pathname === '/html-case-insensitive') {
        res.writeHead(200, {
          'content-type': 'text/html',
        });
        res.end('<HTML><HEAD><TITLE>Case</TITLE></HEAD><BODY><P>Content</P></BODY></HTML>');
      } else if (url.pathname === '/html-no-body-tag') {
        res.writeHead(200, {
          'content-type': 'text/html',
        });
        res.end('<div>No body closing tag</div>');
      } else if (url.pathname === '/styles.css') {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end(`body { color: red; } /* ${url.searchParams.get('v') ?? ''} */`);
      } else if (url.pathname === '/asset-with-url-param') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(url.searchParams.get('url') ?? '');
      } else if (url.pathname === '/redirect-cross-origin') {
        res.writeHead(302, { location: `http://localhost:${upstreamPort}/echo-headers` });
        res.end();
      } else if (url.pathname === '/redirect-set-cookie') {
        res.writeHead(302, { location: '/echo-headers', 'set-cookie': 'step=one; Path=/' });
        res.end();
      } else if (url.pathname === '/redirect-303') {
        res.writeHead(303, { location: '/echo-request' });
        res.end();
      } else if (url.pathname === '/redirect-307') {
        res.writeHead(307, { location: '/echo-request' });
        res.end();
      } else if (url.pathname === '/echo-request') {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, {
            'content-type': 'application/json',
            'x-request-method': req.method,
          });
          res.end(JSON.stringify({ method: req.method, body }));
        });
      } else if (url.pathname === '/echo-headers') {
        res.writeHead(200, {
          'content-type': 'application/json',
        });
        res.end(JSON.stringify(req.headers));
      } else if (url.pathname === '/redirect-relative') {
        res.writeHead(302, { location: '/html' });
        res.end();
      } else if (url.pathname === '/redirect-absolute') {
        res.writeHead(301, { location: `http://127.0.0.1:${upstreamPort}/html` });
        res.end();
      } else if (url.pathname === '/redirect-loop') {
        res.writeHead(302, { location: '/redirect-loop' });
        res.end();
      } else if (url.pathname === '/redirect-to-non-http') {
        res.writeHead(302, { location: 'ftp://example.com/file' });
        res.end();
      } else if (url.pathname === '/json') {
        res.writeHead(200, {
          'content-type': 'application/json',
        });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve) => {
      upstreamServer.listen(0, '127.0.0.1', () => {
        upstreamPort = (upstreamServer.address() as AddressInfo).port;
        resolve();
      });
    });

    proxy = await startProxyServer(0);
  });

  afterAll(() => {
    proxy.close();
    upstreamServer.close();
  });

  it('binds the proxy to a dedicated loopback host', async () => {
    const res = await fetch(`http://127.0.0.2:${proxy.port}/__realbrowser/picker.js`);
    expect(res.status).toBe(200);
  });

  it('serves /__realbrowser/picker.js', async () => {
    const res = await fetch(`http://127.0.0.2:${proxy.port}/__realbrowser/picker.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    const text = await res.text();
    expect(text).toBe(generatePickerScript());
  });

  it('returns 400 when url param is missing', async () => {
    const res = await fetch(`http://127.0.0.2:${proxy.port}/`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing target URL');
  });

  it('returns 400 when url param is invalid', async () => {
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=not-a-valid-url`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Invalid target URL');
  });

  it('proxies HTML content, strips headers, and injects picker script before </body>', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/html`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
    expect(res.headers.get('content-security-policy')).not.toContain('frame-ancestors');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");

    expect(res.headers.get('set-cookie')).toContain('__realbrowser_target_origin=');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    const body = await res.text();
    expect(body).toContain(`<base href="http://127.0.0.2:${proxy.port}/html">`);
    // Absolute, because the injected <base> must not retarget the picker src.
    expect(body).toContain(`<script src="http://127.0.0.2:${proxy.port}/__realbrowser/picker.js"></script></body>`);
    expect(body).toContain('<h1>Hello</h1>');
  });

  it('resolves a path-only subresource through the target-origin cookie', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/html`;
    const page = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);
    const cookie = page.headers.get('set-cookie')?.split(';', 1)[0];

    expect(cookie).toBeTruthy();

    const asset = await fetch(`http://127.0.0.2:${proxy.port}/styles.css?v=7`, {
      headers: { cookie: cookie! },
    });

    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('/* 7 */');

    const echo = await fetch(`http://127.0.0.2:${proxy.port}/echo-headers`, {
      headers: { cookie: cookie! },
    });
    const upstreamHeaders = await echo.json() as Record<string, string>;
    expect(upstreamHeaders.cookie ?? '').not.toContain('__realbrowser_target_origin');
  });

  it('returns a visible HTML error without target context', async () => {
    const res = await fetch(`http://127.0.0.2:${proxy.port}/missing.css`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Missing target URL');
  });

  it('rejects non-http target protocols', async () => {
    const target = encodeURIComponent('ftp://example.com/file');
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${target}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Only HTTP and HTTPS targets are supported');
  });

  it('injects <base> and picker script with case-insensitive tags', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/html-case-insensitive`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`<HEAD><base href="http://127.0.0.2:${proxy.port}/html-case-insensitive">`);
    expect(body).toContain(`<script src="http://127.0.0.2:${proxy.port}/__realbrowser/picker.js"></script></body>`);
  });

  it('proxies HTML content and appends picker script if no </body> tag', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/html-no-body-tag`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`<base href="http://127.0.0.2:${proxy.port}/html-no-body-tag">`);
    expect(body).toContain(`<div>No body closing tag</div><script src="http://127.0.0.2:${proxy.port}/__realbrowser/picker.js"></script>`);
  });

  it('proxies non-HTML content without injecting script', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/json`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json();
    expect(json).toEqual({ status: 'ok' });
  });

  it('returns 502 when upstream server is unreachable', async () => {
    // Port 1 is reserved and not listening
    const targetUrl = `http://127.0.0.1:1/unreachable`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain('RealBrowser Proxy Error');
  });

  it('follows an upstream relative redirect and injects against the final URL', async () => {
    // Reported bug: youtube.com / google.com answer 301 to their www host. The
    // proxy used to forward that redirect verbatim, so the browser left the
    // proxy and loaded the real origin — which then refuses to be framed.
    const targetUrl = `http://127.0.0.1:${upstreamPort}/redirect-relative`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<h1>Hello</h1>');
    // The <base> must describe the document's FINAL URL, not the redirecting one.
    expect(body).toContain(`<base href="http://127.0.0.2:${proxy.port}/html">`);
    expect(body).toContain(`<script src="http://127.0.0.2:${proxy.port}/__realbrowser/picker.js"></script>`);
  });

  it('follows an upstream absolute redirect', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/redirect-absolute`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<h1>Hello</h1>');
    expect(body).toContain(`<base href="http://127.0.0.2:${proxy.port}/html">`);
  });

  it('fails with 502 instead of looping forever on a redirect cycle', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/redirect-loop`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain('RealBrowser Proxy Error');
  });

  it('fails with 502 on a redirect to a non-http scheme', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/redirect-to-non-http`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(502);
  });

  it('treats url query parameters on subresources as upstream data', async () => {
    const pageUrl = `http://127.0.0.1:${upstreamPort}/html`;
    const page = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(pageUrl)}`);
    const cookie = page.headers.get('set-cookie')?.split(';', 1)[0];

    const asset = await fetch(`http://127.0.0.2:${proxy.port}/asset-with-url-param?url=theme`, {
      headers: { cookie: cookie! },
    });

    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('theme');
  });

  it('strips credentials when a redirect changes origin', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/redirect-cross-origin`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`, {
      headers: {
        authorization: 'Bearer secret',
        cookie: 'session=secret',
      },
    });

    expect(res.status).toBe(200);
    const headers = await res.json() as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(headers.host).toBe(`localhost:${upstreamPort}`);
  });

  it('clears and strips cookies before explicit cross-target navigation', async () => {
    const previousOrigin = `http://127.0.0.1:${upstreamPort}`;
    const nextTarget = `http://localhost:${upstreamPort}/echo-headers`;
    const cookie = `site_a=secret; __realbrowser_target_origin=${encodeURIComponent(previousOrigin)}`;
    const navigationUrl = `http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(nextTarget)}`;

    const firstNavigation = await fetch(navigationUrl, {
      headers: { cookie: 'site_a=secret' },
      redirect: 'manual',
    });
    expect(firstNavigation.status).toBe(307);
    expect(firstNavigation.headers.get('clear-site-data')).toBe('"cookies"');

    const forgedClean = await fetch(`${navigationUrl}&__realbrowser_clean=1`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(forgedClean.status).toBe(307);

    const clearingResponse = await fetch(navigationUrl, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(clearingResponse.status).toBe(307);
    expect(clearingResponse.headers.get('clear-site-data')).toBe('"cookies"');

    const cleanUrl = new URL(clearingResponse.headers.get('location')!, navigationUrl);
    const finalResponse = await fetch(cleanUrl, {
      headers: { cookie, authorization: 'Bearer secret' },
    });
    const upstreamHeaders = await finalResponse.json() as Record<string, string>;
    expect(upstreamHeaders.cookie).toBeUndefined();
    expect(upstreamHeaders.authorization).toBeUndefined();
  });

  it('applies same-origin cookies returned by intermediate redirects', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/redirect-set-cookie`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('step=one');
    const headers = await res.json() as Record<string, string>;
    expect(headers.cookie).toContain('step=one');
  });

  it('changes POST to GET after a 303 redirect', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/redirect-303`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`, {
      method: 'POST',
      body: 'payload',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: 'GET', body: '' });
  });

  it('preserves HEAD after a 303 redirect', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/redirect-303`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`, {
      method: 'HEAD',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-method')).toBe('HEAD');
  });

  it('replays method and body after a 307 redirect', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/redirect-307`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`, {
      method: 'POST',
      body: 'payload',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: 'POST', body: 'payload' });
  });

  it('strips accept-encoding from forwarded request headers', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/echo-headers`;
    const res = await fetch(`http://127.0.0.2:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`, {
      headers: { 'accept-encoding': 'gzip, deflate, br' },
    });

    expect(res.status).toBe(200);
    const headers = await res.json();
    expect(headers['accept-encoding']).toBeUndefined();
  });
});

