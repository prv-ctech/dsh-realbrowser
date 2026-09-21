import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { filterResponseHeaders, shouldInjectScript } from './header-filter.js';
import { generatePickerScript } from '../picker/picker-script.js';

export function startProxyServer(port = 0): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const pickerScript = generatePickerScript();

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
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
      const proxyHeaders = { ...req.headers, host: targetUrl.host };
      delete proxyHeaders['accept-encoding'];

      const proxyReq = client.request(
        targetUrl,
        {
          method: req.method,
          headers: proxyHeaders,
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
          proxyRes.on('data', (chunk) => {
            body += chunk;
          });
          proxyRes.on('end', () => {
            const injection = '<script src="/__realbrowser/picker.js"></script>';
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
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/html' });
          res.end(`<h3>RealBrowser Proxy Error</h3><p>${err.message}</p>`);
        } else {
          res.destroy();
        }
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
