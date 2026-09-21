import { startProxyServer } from '../proxy/proxy-server.js';
import { ChromeController } from '../cdp/chrome-controller.js';

export interface HostPluginOptions {
  harness?: any;
  chrome?: any;
  startProxy?: (port?: number) => Promise<{ port: number; close: () => void }>;
}

export function createHostPlugin(options?: HostPluginOptions) {
  let proxyInstance: { port: number; close: () => void } | null = null;
  const chrome = options?.chrome || new ChromeController();
  const startProxy = options?.startProxy || startProxyServer;
  let currentUrl = 'https://example.com';

  const ensureChrome = async () => {
    if (typeof chrome.ensureLaunched === 'function') {
      await chrome.ensureLaunched();
    }
  };

  return {
    async apply(ctx: any) {
      proxyInstance = await startProxy();

      const harness = options?.harness || (globalThis as any).harness;
      if (harness) {
        harness.handle('realbrowser-get-proxy', async () => {
          return { port: proxyInstance?.port };
        });

        harness.handle('realbrowser-get-current-url', async () => {
          return { url: currentUrl };
        });

        harness.handle('realbrowser-navigate', async (args: { url: string }) => {
          await ensureChrome();
          await chrome.navigate(args.url);
          currentUrl = args.url;
          return { ok: true };
        });

        if (harness.registerTool) {
          harness.registerTool({
            name: 'realbrowser_navigate',
            description: 'Navigate the RealBrowser to a URL',
            parameters: {
              type: 'object',
              properties: { url: { type: 'string' } },
              required: ['url'],
            },
            execute: async ({ url }: { url: string }) => {
              await ensureChrome();
              await chrome.navigate(url);
              currentUrl = url;
              return `Navigated to ${url}`;
            },
          });

          harness.registerTool({
            name: 'realbrowser_screenshot',
            description: 'Take a screenshot of the current page in RealBrowser (returns base64 PNG)',
            parameters: {
              type: 'object',
              properties: {},
            },
            execute: async () => {
              await ensureChrome();
              return await chrome.screenshot();
            },
          });

          harness.registerTool({
            name: 'realbrowser_get_dom',
            description: 'Get outer HTML of page or element matching selector in RealBrowser',
            parameters: {
              type: 'object',
              properties: {
                selector: { type: 'string' },
              },
            },
            execute: async ({ selector }: { selector?: string } = {}) => {
              await ensureChrome();
              return await chrome.getDom(selector);
            },
          });

          harness.registerTool({
            name: 'realbrowser_click',
            description: 'Click an element matching CSS selector in RealBrowser',
            parameters: {
              type: 'object',
              properties: { selector: { type: 'string' } },
              required: ['selector'],
            },
            execute: async ({ selector }: { selector: string }) => {
              await ensureChrome();
              await chrome.click(selector);
              return `Clicked ${selector}`;
            },
          });

          harness.registerTool({
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
            execute: async ({ selector, text }: { selector: string; text: string }) => {
              await ensureChrome();
              await chrome.type(selector, text);
              return `Typed into ${selector}`;
            },
          });

          harness.registerTool({
            name: 'realbrowser_evaluate',
            description: 'Evaluate JavaScript expression in RealBrowser',
            parameters: {
              type: 'object',
              properties: { expression: { type: 'string' } },
              required: ['expression'],
            },
            execute: async ({ expression }: { expression: string }) => {
              await ensureChrome();
              const result = await chrome.evaluate(expression);
              return JSON.stringify(result);
            },
          });
        }
      }

      ctx.on?.('dispose', () => {
        proxyInstance?.close();
        chrome.close();
      });
    },
  };
}

export default createHostPlugin;
