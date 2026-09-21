import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startProxyServer } from '../proxy/proxy-server.js';
import { ChromeController } from '../cdp/chrome-controller.js';
import { resolveViewportMetrics } from '../browser/viewports.js';
import type { BrowserInput } from '../browser/protocol.js';

/**
 * Build the `output` declaration every DSH tool must carry:
 * `{ schema, render, presentationMeta? }`. The schema is a plain JSON Schema
 * restricted to the supported subset (type/oneOf/properties/required/
 * additionalProperties/items/enum/const + annotations), and `render` turns the
 * canonical value into the model-facing content blocks.
 */
function stringOutput(format?: (value: string) => string) {
  return {
    schema: { type: 'string' as const },
    render: (_args: any, value: any) => [
      { type: 'text', text: format ? format(String(value)) : String(value) },
    ],
  };
}

export interface HostPluginOptions {
  harness?: any;
  chrome?: any;
  startProxy?: (port?: number) => Promise<{ port: number; close: () => void }>;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function parseBrowserInput(value: any): BrowserInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid browser input');
  if (value.kind === 'text' && typeof value.text === 'string') return { kind: 'text', text: value.text };
  if (value.kind === 'wheel') {
    return {
      kind: 'wheel',
      x: finiteNumber(value.x, 'x'),
      y: finiteNumber(value.y, 'y'),
      deltaX: finiteNumber(value.deltaX, 'deltaX'),
      deltaY: finiteNumber(value.deltaY, 'deltaY'),
    };
  }
  if (value.kind === 'mouse' && ['mouseMoved', 'mousePressed', 'mouseReleased'].includes(value.type)) {
    if (value.button !== undefined && !['left', 'middle', 'right'].includes(value.button)) {
      throw new Error('Invalid mouse button');
    }
    if (value.clickCount !== undefined && (!Number.isInteger(value.clickCount) || value.clickCount < 0)) {
      throw new Error('Invalid click count');
    }
    return {
      kind: 'mouse',
      type: value.type,
      x: finiteNumber(value.x, 'x'),
      y: finiteNumber(value.y, 'y'),
      ...(value.button === undefined ? {} : { button: value.button }),
      ...(value.clickCount === undefined ? {} : { clickCount: value.clickCount }),
    };
  }
  if (value.kind === 'key' && ['keyDown', 'keyUp'].includes(value.type) &&
      typeof value.key === 'string' && typeof value.code === 'string' && Number.isInteger(value.modifiers)) {
    return { kind: 'key', type: value.type, key: value.key, code: value.code, modifiers: value.modifiers };
  }
  throw new Error('Invalid browser input');
}

export function createHostPlugin(options?: HostPluginOptions) {
  let proxyInstance: { port: number; close: () => void } | null = null;
  const chrome = options?.chrome || new ChromeController();
  const startProxy = options?.startProxy || startProxyServer;
  let currentUrl = 'https://example.com';
  const getState = () => chrome.getSnapshot?.() ?? {
    url: currentUrl,
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };

  const ensureChrome = async () => {
    if (typeof chrome.ensureLaunched === 'function') {
      await chrome.ensureLaunched();
    }
  };

  return {
    async apply(ctx: any) {
      proxyInstance = await startProxy();

      // Register webServer HTTP route for client UI
      if (ctx.webServer?.register) {
        ctx.effect?.(() => ctx.webServer.register({
          kind: 'prefix',
          path: '/realbrowser/api',
          handler: async (req: any, res: any) => {
            res.setHeader('content-type', 'application/json');
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.end(JSON.stringify({ error: 'method not allowed' }));
              return;
            }
            const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
            const method = pathname.startsWith('/realbrowser/api/')
              ? pathname.slice('/realbrowser/api/'.length)
              : undefined;

            let body = '';
            for await (const chunk of req) body += chunk;
            let payload: any = {};
            try { payload = body ? JSON.parse(body) : {}; } catch {}

            try {
              if (method === 'get-proxy') {
                res.statusCode = 200;
                res.end(JSON.stringify({ port: proxyInstance?.port }));
              } else if (method === 'get-current-url') {
                res.statusCode = 200;
                res.end(JSON.stringify({ url: getState().url }));
              } else if (method === 'navigate') {
                if (typeof payload.url !== 'string' || !payload.url) throw new Error('Invalid URL');
                await ensureChrome();
                await chrome.navigate(payload.url);
                currentUrl = payload.url;
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: true }));
              } else if (method === 'get-state') {
                res.statusCode = 200;
                res.end(JSON.stringify(getState()));
              } else if (method === 'command') {
                if (!['back', 'forward', 'reload'].includes(payload.command)) throw new Error('Invalid browser command');
                await ensureChrome();
                if (payload.command === 'back') await chrome.goBack();
                else if (payload.command === 'forward') await chrome.goForward();
                else await chrome.reload();
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: true }));
              } else if (method === 'set-viewport') {
                if (typeof payload.id !== 'string') throw new Error('Invalid viewport');
                const responsiveSize = payload.id === 'responsive'
                  ? { width: finiteNumber(payload.width, 'width'), height: finiteNumber(payload.height, 'height') }
                  : { width: 1, height: 1 };
                const metrics = resolveViewportMetrics(payload.id, responsiveSize);
                await ensureChrome();
                await chrome.setViewport(metrics);
                res.statusCode = 200;
                res.end(JSON.stringify(metrics));
              } else if (method === 'input') {
                const input = parseBrowserInput(payload);
                await ensureChrome();
                await chrome.dispatchInput(input);
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: true }));
              } else if (method === 'start-stream') {
                const maxWidth = finiteNumber(payload.maxWidth, 'maxWidth');
                const maxHeight = finiteNumber(payload.maxHeight, 'maxHeight');
                if (maxWidth <= 0 || maxHeight <= 0) throw new Error('Stream dimensions must be positive');
                await ensureChrome();
                await chrome.startScreencast(maxWidth, maxHeight);
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: true }));
              } else if (method === 'stop-stream') {
                await ensureChrome();
                await chrome.stopScreencast();
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: true }));
              } else {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'unknown method' }));
              }
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err?.message || String(err) }));
            }
          },
        }), 'realbrowser: /realbrowser/api routes');
        ctx.effect?.(() => ctx.webServer.register({
          kind: 'prefix',
          path: '/realbrowser/frame',
          handler: async (req: any, res: any) => {
            res.setHeader('cache-control', 'no-store');
            if (req.method !== 'GET') {
              res.statusCode = 405;
              res.setHeader('allow', 'GET');
              res.end();
              return;
            }
            const url = new URL(req.url ?? '/realbrowser/frame', 'http://dsh.internal');
            if (url.pathname !== '/realbrowser/frame') {
              res.statusCode = 404;
              res.end();
              return;
            }
            const rawAfter = url.searchParams.get('after') ?? '0';
            if (!/^\d+$/.test(rawAfter)) {
              res.statusCode = 400;
              res.end();
              return;
            }
            const after = Number(rawAfter);
            if (!Number.isSafeInteger(after)) {
              res.statusCode = 400;
              res.end();
              return;
            }
            const frame = chrome.latestFrameAfter(after);
            if (!frame) {
              res.statusCode = 204;
              res.end();
              return;
            }
            res.statusCode = 200;
            res.setHeader('content-type', frame.mediaType);
            res.setHeader('x-realbrowser-sequence', String(frame.sequence));
            res.end(frame.data);
          },
        }), 'realbrowser: frame route');
      }

      // Tools definition. Every row must declare `output`: the DSH tools
      // registry rejects a definition without it, and that rejection is fatal
      // during composition load (it aborts the whole harness boot).
      const toolDefs = [
        {
          name: 'realbrowser_navigate',
          description: 'Navigate the RealBrowser to a URL',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url'],
          },
          output: stringOutput(),
          execute: async ({ url }: { url: string }) => {
            await ensureChrome();
            await chrome.navigate(url);
            currentUrl = url;
            return `Navigated to ${url}`;
          },
        },
        {
          name: 'realbrowser_screenshot',
          description:
            'Capture a PNG screenshot of the current RealBrowser page. The PNG is written to a file and the absolute path is returned; inspect it with the read_image tool.',
          parameters: {
            type: 'object',
            properties: {},
          },
          output: {
            schema: {
              type: 'object' as const,
              properties: {
                path: { type: 'string' as const, description: 'Absolute path of the saved PNG file.' },
                bytes: { type: 'integer' as const, description: 'Size of the saved PNG in bytes.' },
              },
              required: ['path', 'bytes'],
            },
            render: (_args: any, value: any) => [
              { type: 'text', text: `Screenshot saved to ${value.path} (${value.bytes} bytes)` },
            ],
          },
          execute: async () => {
            await ensureChrome();
            const base64 = await chrome.screenshot();
            if (typeof base64 !== 'string' || base64.length === 0) {
              throw new Error('RealBrowser screenshot returned no image data');
            }
            const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'realbrowser-shot-'));
            const file = path.join(dir, `screenshot-${Date.now()}.png`);
            const buffer = Buffer.from(base64, 'base64');
            await fsp.writeFile(file, buffer);
            return { path: file, bytes: buffer.byteLength };
          },
        },
        {
          name: 'realbrowser_get_dom',
          description: 'Get outer HTML of page or element matching selector in RealBrowser',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
            },
          },
          output: stringOutput((value) => value),
          execute: async ({ selector }: { selector?: string } = {}) => {
            await ensureChrome();
            return await chrome.getDom(selector);
          },
        },
        {
          name: 'realbrowser_click',
          description: 'Click an element matching CSS selector in RealBrowser',
          parameters: {
            type: 'object',
            properties: { selector: { type: 'string' } },
            required: ['selector'],
          },
          output: stringOutput(),
          execute: async ({ selector }: { selector: string }) => {
            await ensureChrome();
            await chrome.click(selector);
            return `Clicked ${selector}`;
          },
        },
        {
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
          output: stringOutput(),
          execute: async ({ selector, text }: { selector: string; text: string }) => {
            await ensureChrome();
            await chrome.type(selector, text);
            return `Typed into ${selector}`;
          },
        },
        {
          name: 'realbrowser_evaluate',
          description: 'Evaluate JavaScript expression in RealBrowser',
          parameters: {
            type: 'object',
            properties: { expression: { type: 'string' } },
            required: ['expression'],
          },
          output: stringOutput(),
          execute: async ({ expression }: { expression: string }) => {
            await ensureChrome();
            const result = await chrome.evaluate(expression);
            // `JSON.stringify` returns undefined for undefined/function values,
            // which would violate the string output schema.
            const text = JSON.stringify(result);
            return text === undefined ? String(result) : text;
          },
        },
      ];

      // Register tools via ctx.tools or harness
      if (ctx.tools?.register) {
        for (const tool of toolDefs) {
          ctx.tools.register(tool);
        }
      }

      const harness = options?.harness || (globalThis as any).harness;
      if (harness) {
        harness.handle?.('realbrowser-get-proxy', async () => {
          return { port: proxyInstance?.port };
        });

        harness.handle?.('realbrowser-get-current-url', async () => {
          return { url: getState().url };
        });

        harness.handle?.('realbrowser-get-state', async () => getState());

        harness.handle?.('realbrowser-navigate', async (args: { url: string }) => {
          if (!args || typeof args.url !== 'string' || !args.url) throw new Error('Invalid URL');
          await ensureChrome();
          await chrome.navigate(args.url);
          currentUrl = args.url;
          return { ok: true };
        });

        harness.handle?.('realbrowser-command', async (args: { command: string }) => {
          if (!args || !['back', 'forward', 'reload'].includes(args.command)) {
            throw new Error('Invalid browser command');
          }
          await ensureChrome();
          if (args.command === 'back') await chrome.goBack();
          else if (args.command === 'forward') await chrome.goForward();
          else await chrome.reload();
          return { ok: true };
        });

        harness.handle?.('realbrowser-set-viewport', async (args: { id: string; width?: number; height?: number }) => {
          if (!args || typeof args.id !== 'string') throw new Error('Invalid viewport');
          const responsiveSize = args.id === 'responsive'
            ? { width: finiteNumber(args.width, 'width'), height: finiteNumber(args.height, 'height') }
            : { width: 1, height: 1 };
          const metrics = resolveViewportMetrics(args.id, responsiveSize);
          await ensureChrome();
          await chrome.setViewport(metrics);
          return metrics;
        });

        harness.handle?.('realbrowser-input', async (args: BrowserInput) => {
          const input = parseBrowserInput(args);
          await ensureChrome();
          await chrome.dispatchInput(input);
          return { ok: true };
        });

        harness.handle?.('realbrowser-start-stream', async (args: { maxWidth: number; maxHeight: number }) => {
          const maxWidth = finiteNumber(args?.maxWidth, 'maxWidth');
          const maxHeight = finiteNumber(args?.maxHeight, 'maxHeight');
          if (maxWidth <= 0 || maxHeight <= 0) throw new Error('Stream dimensions must be positive');
          await ensureChrome();
          await chrome.startScreencast(maxWidth, maxHeight);
          return { ok: true };
        });

        harness.handle?.('realbrowser-stop-stream', async () => {
          await ensureChrome();
          await chrome.stopScreencast();
          return { ok: true };
        });

        if (harness.registerTool) {
          for (const tool of toolDefs) {
            harness.registerTool(tool);
          }
        }
      }

      // Own the long-lived resources with this fiber so stop/update/undefine
      // releases the proxy port and the Chrome process.
      if (ctx.effect) {
        ctx.effect(() => () => {
          proxyInstance?.close();
          proxyInstance = null;
          chrome.close();
        }, 'realbrowser: proxy + chrome lifecycle');
      } else {
        ctx.on?.('dispose', () => {
          proxyInstance?.close();
          chrome.close();
        });
      }
    },
  };
}

export default createHostPlugin;
