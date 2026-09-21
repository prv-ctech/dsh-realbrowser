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
        res.end('<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>');
      } else if (url.pathname === '/html-no-body-tag') {
        res.writeHead(200, {
          'content-type': 'text/html',
        });
        res.end('<div>No body closing tag</div>');
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

  it('serves /__realbrowser/picker.js', async () => {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/__realbrowser/picker.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    const text = await res.text();
    expect(text).toBe(generatePickerScript());
  });

  it('returns 400 when url param is missing', async () => {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing target ?url= parameter');
  });

  it('returns 400 when url param is invalid', async () => {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/?url=not-a-valid-url`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Invalid target URL');
  });

  it('proxies HTML content, strips headers, and injects picker script before </body>', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/html`;
    const res = await fetch(`http://127.0.0.1:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
    expect(res.headers.get('content-security-policy')).not.toContain('frame-ancestors');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");

    const body = await res.text();
    expect(body).toContain('<script src="/__realbrowser/picker.js"></script></body>');
    expect(body).toContain('<h1>Hello</h1>');
  });

  it('proxies HTML content and appends picker script if no </body> tag', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/html-no-body-tag`;
    const res = await fetch(`http://127.0.0.1:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<div>No body closing tag</div><script src="/__realbrowser/picker.js"></script>');
  });

  it('proxies non-HTML content without injecting script', async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/json`;
    const res = await fetch(`http://127.0.0.1:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json();
    expect(json).toEqual({ status: 'ok' });
  });

  it('returns 502 when upstream server is unreachable', async () => {
    // Port 1 is reserved and not listening
    const targetUrl = `http://127.0.0.1:1/unreachable`;
    const res = await fetch(`http://127.0.0.1:${proxy.port}/?url=${encodeURIComponent(targetUrl)}`);

    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain('RealBrowser Proxy Error');
  });
});

