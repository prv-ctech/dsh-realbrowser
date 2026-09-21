import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { filterResponseHeaders, shouldInjectScript } from './header-filter.js';
import { generatePickerScript } from '../picker/picker-script.js';

/** Maximum upstream redirects followed for a single proxied navigation. */
const MAX_REDIRECTS = 5;
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
const PROXY_HOST = '127.0.0.2';
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
  res.end(`<!doctype html><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title><style>body{font:14px system-ui;margin:2rem;line-height:1.5}</style><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>`);
}

/** Issue one upstream request, following redirects inside the proxy. */
function requestUpstream(
  targetUrl: URL,
  method: string,
  headers: OutgoingHttpHeaders,
  body: Buffer,
  redirectsLeft: number,
  redirectCookies: string[],
  onResponse: (proxyRes: IncomingMessage, finalUrl: URL, cookies: string[]) => void,
  onError: (err: Error) => void,
): void {
  const client = targetUrl.protocol === 'https:' ? https : http;
  const proxyReq = client.request(targetUrl, { method, headers }, (proxyRes) => {
    const status = proxyRes.statusCode || 200;
    const location = proxyRes.headers.location;

    if ([301, 302, 303, 307, 308].includes(status) && typeof location === 'string') {
      if (redirectsLeft <= 0) {
        proxyRes.resume();
        onError(new Error(`too many redirects (last: ${location})`));
        return;
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, targetUrl);
      } catch {
        proxyRes.resume();
        onError(new Error(`invalid redirect location: ${location}`));
        return;
      }
      if (!isHttpTarget(nextUrl)) {
        proxyRes.resume();
        onError(new Error(`unsupported redirect protocol: ${nextUrl.protocol}`));
        return;
      }

      const nextHeaders: OutgoingHttpHeaders = { ...headers, host: nextUrl.host };
      const originChanged = nextUrl.origin !== targetUrl.origin;
      if (originChanged) {
        delete nextHeaders.authorization;
        delete nextHeaders.cookie;
        delete nextHeaders['proxy-authorization'];
      }

      let nextMethod = method;
      let nextBody = body;
      const upperMethod = method.toUpperCase();
      if ((status === 303 && upperMethod !== 'GET' && upperMethod !== 'HEAD') ||
          ((status === 301 || status === 302) && upperMethod === 'POST')) {
        nextMethod = 'GET';
        nextBody = Buffer.alloc(0);
        delete nextHeaders['content-length'];
        delete nextHeaders['content-type'];
        delete nextHeaders['transfer-encoding'];
      }

      const responseCookies = proxyRes.headers['set-cookie'] ?? [];
      if (!originChanged && responseCookies.length) {
        const requestCookies = new Map<string, string>();
        for (const pair of (typeof nextHeaders.cookie === 'string' ? nextHeaders.cookie : '').split(';')) {
          const trimmed = pair.trim();
          if (trimmed) requestCookies.set(trimmed.split('=', 1)[0], trimmed);
        }
        for (const cookie of responseCookies) {
          const pair = cookie.split(';', 1)[0];
          requestCookies.set(pair.split('=', 1)[0], pair);
        }
        nextHeaders.cookie = [...requestCookies.values()].join('; ');
      }

      proxyRes.resume();
      requestUpstream(
        nextUrl,
        nextMethod,
        nextHeaders,
        nextBody,
        redirectsLeft - 1,
        originChanged ? [] : [...redirectCookies, ...responseCookies],
        onResponse,
        onError,
      );
      return;
    }

    onResponse(proxyRes, targetUrl, redirectCookies);
  });

  proxyReq.on('error', onError);
  proxyReq.end(body.length ? body : undefined);
}

export function startProxyServer(port = 0): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const pickerScript = generatePickerScript();
    const cleanNavigations = new Map<string, string>();

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || PROXY_HOST}`);

      if (reqUrl.pathname === '/__realbrowser/picker.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(pickerScript);
        return;
      }

      const explicitTarget = reqUrl.pathname === '/' ? reqUrl.searchParams.get('url') : null;
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
          targetUrl = new URL(`${reqUrl.pathname}${reqUrl.search}`, storedOrigin);
        } catch {
          sendProxyError(res, 400, 'Missing target URL', 'The saved website origin is invalid. Navigate again.');
          return;
        }
      }

      if (!isHttpTarget(targetUrl)) {
        sendProxyError(res, 400, 'Unsupported target URL', 'Only HTTP and HTTPS targets are supported.');
        return;
      }

      const cleanToken = reqUrl.searchParams.get('__realbrowser_clean');
      const cleanNavigation = Boolean(
        explicitTarget && cleanToken && cleanNavigations.get(cleanToken) === explicitTarget,
      );
      if (cleanToken) cleanNavigations.delete(cleanToken);

      if (explicitTarget && (!storedOrigin || storedOrigin !== targetUrl.origin) && !cleanNavigation) {
        if (cleanNavigations.size >= 128) {
          cleanNavigations.delete(cleanNavigations.keys().next().value!);
        }
        const token = randomUUID();
        cleanNavigations.set(token, explicitTarget);
        const cleanUrl = new URL('/', reqUrl);
        cleanUrl.searchParams.set('url', explicitTarget);
        cleanUrl.searchParams.set('__realbrowser_clean', token);
        req.resume();
        res.writeHead(307, {
          location: `${cleanUrl.pathname}${cleanUrl.search}`,
          'clear-site-data': '"cookies"',
          'cache-control': 'no-store',
        });
        res.end();
        return;
      }

      const proxyHeaders: OutgoingHttpHeaders = { ...req.headers, host: targetUrl.host };
      delete proxyHeaders['accept-encoding'];
      if (cleanNavigation) {
        delete proxyHeaders.authorization;
        delete proxyHeaders['proxy-authorization'];
      }
      const forwardedCookies = cleanNavigation ? '' : (req.headers.cookie ?? '')
        .split(';')
        .map((entry) => entry.trim())
        .filter((entry) => entry && !entry.startsWith(`${TARGET_ORIGIN_COOKIE}=`))
        .join('; ');
      if (forwardedCookies) proxyHeaders.cookie = forwardedCookies;
      else delete proxyHeaders.cookie;
      const method = req.method || 'GET';
      const hasBody = method !== 'GET' && method !== 'HEAD';

      const fail = (err: Error) => {
        if (!res.headersSent) {
          sendProxyError(res, 502, 'RealBrowser Proxy Error', err.message);
        } else {
          res.destroy();
        }
      };

      const sendRequest = (requestBody: Buffer) => requestUpstream(
        targetUrl,
        method,
        proxyHeaders,
        requestBody,
        MAX_REDIRECTS,
        [],
        (proxyRes, finalUrl, redirectCookies) => {
          const headers = filterResponseHeaders(proxyRes.headers);
          const finalCookies = headers['set-cookie'];
          if (redirectCookies.length) {
            headers['set-cookie'] = [
              ...redirectCookies,
              ...(Array.isArray(finalCookies) ? finalCookies : finalCookies ? [finalCookies] : []),
            ];
          }
          const isHtml = shouldInjectScript(proxyRes.headers['content-type']);

          if (!isHtml) {
            res.writeHead(proxyRes.statusCode || 200, headers);
            proxyRes.pipe(res);
            return;
          }

          delete headers['content-length'];
          const proxyOrigin = new URL('/', reqUrl).origin;
          const localBase = new URL('/', proxyOrigin);
          localBase.pathname = finalUrl.pathname;
          localBase.search = finalUrl.search;
          const localBaseUrl = localBase.href;
          const targetCookie = `${TARGET_ORIGIN_COOKIE}=${encodeURIComponent(finalUrl.origin)}; Path=/; SameSite=Lax; HttpOnly`;
          const upstreamCookies = headers['set-cookie'];
          headers['set-cookie'] = [
            ...(Array.isArray(upstreamCookies) ? upstreamCookies : upstreamCookies ? [upstreamCookies] : []),
            targetCookie,
          ];
          res.writeHead(proxyRes.statusCode || 200, headers);

          let body = '';
          proxyRes.setEncoding('utf-8');
          proxyRes.on('data', (chunk) => {
            body += chunk;
          });
          proxyRes.on('end', () => {
            const injection = `<script src="${proxyOrigin}/__realbrowser/picker.js"></script>`;
            const baseTag = `<base href="${escapeHtml(localBaseUrl)}">`;

            if (/<head[^>]*>/i.test(body)) {
              body = body.replace(/<head[^>]*>/i, `$&${baseTag}`);
            } else if (/<\/head>/i.test(body)) {
              body = body.replace(/<\/head>/i, `${baseTag}</head>`);
            } else {
              body = baseTag + body;
            }

            if (/<\/body>/i.test(body)) {
              body = body.replace(/<\/body>/i, `${injection}</body>`);
            } else {
              body += injection;
            }
            res.end(body);
          });
        },
        fail,
      );

      if (!hasBody) {
        sendRequest(Buffer.alloc(0));
        return;
      }

      const chunks: Buffer[] = [];
      let requestBodyBytes = 0;
      let requestBodyTooLarge = false;
      req.on('data', (chunk: Buffer) => {
        requestBodyBytes += chunk.length;
        if (requestBodyBytes > MAX_REQUEST_BODY_BYTES) {
          requestBodyTooLarge = true;
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (requestBodyTooLarge) {
          sendProxyError(res, 413, 'Request body too large', 'The proxy accepts request bodies up to 10 MiB.');
          return;
        }
        sendRequest(Buffer.concat(chunks));
      });
      req.on('error', fail);
    });

    server.listen(port, PROXY_HOST, () => {
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
