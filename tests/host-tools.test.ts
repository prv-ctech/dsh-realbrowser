import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHostPlugin } from '../src/host/index.js';

describe('Host Plugin', () => {
  it('registers tools on harness', () => {
    const registered: string[] = [];
    const mockHarness = {
      handle: (name: string) => registered.push(name),
      registerTool: (tool: any) => registered.push(tool.name),
    };
    const plugin = createHostPlugin({ harness: mockHarness });
    expect(plugin).toBeDefined();
  });

  it('registers rpc handlers and tools on apply()', async () => {
    const handles = new Map<string, Function>();
    const tools = new Map<string, any>();

    const mockHarness = {
      handle: (name: string, fn: Function) => handles.set(name, fn),
      registerTool: (tool: any) => tools.set(tool.name, tool),
    };

    const mockChrome = {
      navigate: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ title: 'Test Page' }),
      screenshot: vi.fn().mockResolvedValue('base64_screenshot_data'),
      getDom: vi.fn().mockResolvedValue('<html><body>Test DOM</body></html>'),
      close: vi.fn(),
    };

    const mockProxyClose = vi.fn();
    const mockStartProxy = vi.fn().mockResolvedValue({
      port: 8888,
      close: mockProxyClose,
    });

    const plugin = createHostPlugin({
      harness: mockHarness,
      chrome: mockChrome,
      startProxy: mockStartProxy,
    });

    const disposeCallbacks: Function[] = [];
    const mockCtx = {
      on: (event: string, cb: Function) => {
        if (event === 'dispose') disposeCallbacks.push(cb);
      },
    };

    await plugin.apply(mockCtx);

    // Verify proxy started
    expect(mockStartProxy).toHaveBeenCalled();

    // Verify RPC handles registered
    expect(handles.has('realbrowser-get-proxy')).toBe(true);
    expect(handles.has('realbrowser-get-current-url')).toBe(true);
    expect(handles.has('realbrowser-navigate')).toBe(true);

    const proxyRes = await handles.get('realbrowser-get-proxy')!();
    expect(proxyRes).toEqual({ port: 8888 });

    const initialUrlRes = await handles.get('realbrowser-get-current-url')!();
    expect(initialUrlRes).toEqual({ url: 'https://example.com' });

    const navRes = await handles.get('realbrowser-navigate')!({ url: 'https://foo.com' });
    expect(mockChrome.navigate).toHaveBeenCalledWith('https://foo.com');
    expect(navRes).toEqual({ ok: true });

    const updatedUrlRes = await handles.get('realbrowser-get-current-url')!();
    expect(updatedUrlRes).toEqual({ url: 'https://foo.com' });

    // Verify tools registered
    expect(tools.has('realbrowser_navigate')).toBe(true);
    expect(tools.has('realbrowser_screenshot')).toBe(true);
    expect(tools.has('realbrowser_get_dom')).toBe(true);
    expect(tools.has('realbrowser_click')).toBe(true);
    expect(tools.has('realbrowser_type')).toBe(true);
    expect(tools.has('realbrowser_evaluate')).toBe(true);

    // Verify tool execution
    const navTool = tools.get('realbrowser_navigate')!;
    const navResult = await navTool.execute({ url: 'https://example.com' });
    expect(mockChrome.navigate).toHaveBeenCalledWith('https://example.com');
    expect(navResult).toBe('Navigated to https://example.com');

    const urlAfterTool = await handles.get('realbrowser-get-current-url')!();
    expect(urlAfterTool).toEqual({ url: 'https://example.com' });

    const screenshotTool = tools.get('realbrowser_screenshot')!;
    const screenshotResult = await screenshotTool.execute();
    expect(mockChrome.screenshot).toHaveBeenCalled();
    // The screenshot is persisted to a PNG file and the path is returned, so a
    // base64 payload never enters the model's context.
    expect(screenshotResult.path.endsWith('.png')).toBe(true);
    expect(screenshotResult.bytes).toBe(
      Buffer.from('base64_screenshot_data', 'base64').byteLength,
    );
    expect(fs.readFileSync(screenshotResult.path)).toEqual(
      Buffer.from('base64_screenshot_data', 'base64'),
    );
    fs.rmSync(path.dirname(screenshotResult.path), { recursive: true, force: true });

    const domTool = tools.get('realbrowser_get_dom')!;
    const domResult = await domTool.execute({ selector: '#app' });
    expect(mockChrome.getDom).toHaveBeenCalledWith('#app');
    expect(domResult).toBe('<html><body>Test DOM</body></html>');

    const clickTool = tools.get('realbrowser_click')!;
    const clickResult = await clickTool.execute({ selector: '#submit' });
    expect(mockChrome.click).toHaveBeenCalledWith('#submit');
    expect(clickResult).toBe('Clicked #submit');

    const typeTool = tools.get('realbrowser_type')!;
    const typeResult = await typeTool.execute({ selector: 'input[name="q"]', text: 'hello' });
    expect(mockChrome.type).toHaveBeenCalledWith('input[name="q"]', 'hello');
    expect(typeResult).toBe('Typed into input[name="q"]');

    const evalTool = tools.get('realbrowser_evaluate')!;
    const evalResult = await evalTool.execute({ expression: 'document.title' });
    expect(mockChrome.evaluate).toHaveBeenCalledWith('document.title');
    expect(evalResult).toBe(JSON.stringify({ title: 'Test Page' }));

    // Verify dispose
    expect(disposeCallbacks.length).toBe(1);
    disposeCallbacks[0]();
    expect(mockProxyClose).toHaveBeenCalled();
    expect(mockChrome.close).toHaveBeenCalled();
  });

  it('exposes browser RPC controls and raw frame route', async () => {
    const handles = new Map<string, Function>();
    const routes = new Map<string, any>();
    const snapshot = {
      url: 'https://current.test', title: 'Current', loading: false,
      canGoBack: true, canGoForward: false,
    };
    const mockChrome = {
      ensureLaunched: vi.fn().mockResolvedValue(undefined),
      getSnapshot: vi.fn(() => snapshot),
      navigate: vi.fn().mockResolvedValue(undefined),
      goBack: vi.fn().mockResolvedValue(undefined),
      goForward: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
      setViewport: vi.fn().mockResolvedValue(undefined),
      dispatchInput: vi.fn().mockResolvedValue(undefined),
      startScreencast: vi.fn().mockResolvedValue(undefined),
      stopScreencast: vi.fn().mockResolvedValue(undefined),
      latestFrameAfter: vi.fn((after: number) => after < 4
        ? { sequence: 4, data: Buffer.from('jpeg-bytes'), mediaType: 'image/jpeg' }
        : null),
      inspectElementAt: vi.fn().mockResolvedValue({ selector: '#hover', bounds: { x: 1, y: 2, width: 3, height: 4 } }),
      pickElementAt: vi.fn().mockResolvedValue({ selector: '#pick', screenshotMediaType: 'image/webp' }),
      close: vi.fn(),
    };
    const plugin = createHostPlugin({
      harness: { handle: (name: string, fn: Function) => handles.set(name, fn) },
      chrome: mockChrome,
      startProxy: vi.fn().mockResolvedValue({ port: 8888, close: vi.fn() }),
    });
    await plugin.apply({
      webServer: { register: (route: any) => (routes.set(route.path, route), () => routes.delete(route.path)) },
      effect: (factory: Function) => factory(),
    });

    expect(await handles.get('realbrowser-get-state')!()).toEqual(snapshot);
    await handles.get('realbrowser-navigate')!({ url: 'https://next.test' });
    await handles.get('realbrowser-command')!({ command: 'back' });
    await handles.get('realbrowser-command')!({ command: 'forward' });
    await handles.get('realbrowser-command')!({ command: 'reload' });
    await expect(handles.get('realbrowser-command')!({ command: 'stop' })).rejects.toThrow('Invalid browser command');
    await handles.get('realbrowser-set-viewport')!({ id: 'desktop-4k' });
    await handles.get('realbrowser-set-viewport')!({ id: 'responsive', width: 901.8, height: 612.2 });
    await handles.get('realbrowser-input')!({ kind: 'text', text: 'hello' });
    await handles.get('realbrowser-start-stream')!({ maxWidth: 1200, maxHeight: 800 });
    await handles.get('realbrowser-stop-stream')!();
    expect(await handles.get('realbrowser-hover-element')!({ x: 12, y: 34 }))
      .toEqual({ selector: '#hover', bounds: { x: 1, y: 2, width: 3, height: 4 } });
    expect(await handles.get('realbrowser-pick-element')!({ x: 12, y: 34 }))
      .toEqual({ selector: '#pick', screenshotMediaType: 'image/webp' });
    await expect(handles.get('realbrowser-pick-element')!({ x: Infinity, y: 1 })).rejects.toThrow('finite');

    expect(mockChrome.navigate).toHaveBeenCalledWith('https://next.test');
    expect(mockChrome.goBack).toHaveBeenCalledOnce();
    expect(mockChrome.goForward).toHaveBeenCalledOnce();
    expect(mockChrome.reload).toHaveBeenCalledOnce();
    expect(mockChrome.setViewport).toHaveBeenNthCalledWith(1, expect.objectContaining({ width: 3840, height: 2160 }));
    expect(mockChrome.setViewport).toHaveBeenNthCalledWith(2, { width: 902, height: 612, deviceScaleFactor: 1, mobile: false });
    expect(mockChrome.dispatchInput).toHaveBeenCalledWith({ kind: 'text', text: 'hello' });
    expect(mockChrome.startScreencast).toHaveBeenCalledWith(1200, 800);
    expect(mockChrome.stopScreencast).toHaveBeenCalledOnce();

    const route = routes.get('/realbrowser/frame');
    expect(route).toBeDefined();
    const headers = new Map<string, string>();
    const response: any = {
      statusCode: 0,
      body: undefined,
      setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
      end(value?: unknown) { this.body = value; },
    };
    await route.handler({ method: 'GET', url: '/realbrowser/frame?after=0' }, response);
    expect(response.statusCode).toBe(200);
    expect(headers.get('content-type')).toBe('image/jpeg');
    expect(headers.get('x-realbrowser-sequence')).toBe('4');
    expect(headers.get('cache-control')).toBe('no-store');
    expect(response.body).toEqual(Buffer.from('jpeg-bytes'));

    const api = routes.get('/realbrowser/api');
    const apiResponse: any = {
      statusCode: 0,
      body: '',
      setHeader: vi.fn(),
      end(value?: unknown) { this.body = value; },
    };
    const apiRequest = (method: string, payload: unknown) => ({
      method: 'POST',
      url: `/realbrowser/api/${method}`,
      async *[Symbol.asyncIterator]() { yield JSON.stringify(payload); },
    });
    await api.handler(apiRequest('command', { command: 'back' }), apiResponse);
    expect(apiResponse.statusCode).toBe(200);
    expect(mockChrome.goBack).toHaveBeenCalledTimes(2);
    await api.handler(apiRequest('set-viewport', { id: 'desktop-1080p' }), apiResponse);
    expect(mockChrome.setViewport).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080 }));
    await api.handler(apiRequest('get-state', {}), apiResponse);
    expect(JSON.parse(apiResponse.body)).toEqual(snapshot);
  });

  it('uses globalThis.harness when options.harness is not provided', async () => {
    const handles = new Map<string, Function>();
    (globalThis as any).harness = {
      handle: (name: string, fn: Function) => handles.set(name, fn),
    };

    const mockStartProxy = vi.fn().mockResolvedValue({
      port: 9999,
      close: vi.fn(),
    });

    try {
      const plugin = createHostPlugin({ startProxy: mockStartProxy });
      await plugin.apply({});
      expect(handles.has('realbrowser-get-proxy')).toBe(true);
      expect(handles.has('realbrowser-navigate')).toBe(true);
    } finally {
      delete (globalThis as any).harness;
    }
  });

  it('handles environment without harness or ctx.on gracefully', async () => {
    const mockStartProxy = vi.fn().mockResolvedValue({
      port: 9999,
      close: vi.fn(),
    });
    const plugin = createHostPlugin({ startProxy: mockStartProxy });
    await expect(plugin.apply({})).resolves.toBeUndefined();
    expect(mockStartProxy).toHaveBeenCalled();
  });

  it('ensures Chrome is launched before executing tools', async () => {
    const tools = new Map<string, any>();
    const mockHarness = {
      handle: vi.fn(),
      registerTool: (tool: any) => tools.set(tool.name, tool),
    };

    const callOrder: string[] = [];
    const mockChrome = {
      ensureLaunched: vi.fn().mockImplementation(async () => {
        callOrder.push('ensureLaunched');
      }),
      navigate: vi.fn().mockImplementation(async () => {
        callOrder.push('navigate');
      }),
      click: vi.fn().mockImplementation(async () => {
        callOrder.push('click');
      }),
      type: vi.fn().mockImplementation(async () => {
        callOrder.push('type');
      }),
      evaluate: vi.fn().mockImplementation(async () => {
        callOrder.push('evaluate');
        return 'test';
      }),
      screenshot: vi.fn().mockImplementation(async () => {
        callOrder.push('screenshot');
        return 'data';
      }),
      getDom: vi.fn().mockImplementation(async () => {
        callOrder.push('getDom');
        return '<html></html>';
      }),
      close: vi.fn(),
    };

    const plugin = createHostPlugin({
      harness: mockHarness,
      chrome: mockChrome,
      startProxy: vi.fn().mockResolvedValue({ port: 8888, close: vi.fn() }),
    });

    await plugin.apply({});

    // Test realbrowser_navigate
    callOrder.length = 0;
    await tools.get('realbrowser_navigate').execute({ url: 'https://example.com' });
    expect(callOrder).toEqual(['ensureLaunched', 'navigate']);

    // Test realbrowser_click
    callOrder.length = 0;
    await tools.get('realbrowser_click').execute({ selector: '#btn' });
    expect(callOrder).toEqual(['ensureLaunched', 'click']);

    // Test realbrowser_type
    callOrder.length = 0;
    await tools.get('realbrowser_type').execute({ selector: '#input', text: 'abc' });
    expect(callOrder).toEqual(['ensureLaunched', 'type']);

    // Test realbrowser_evaluate
    callOrder.length = 0;
    await tools.get('realbrowser_evaluate').execute({ expression: '1+1' });
    expect(callOrder).toEqual(['ensureLaunched', 'evaluate']);

    // Test realbrowser_screenshot
    callOrder.length = 0;
    await tools.get('realbrowser_screenshot').execute();
    expect(callOrder).toEqual(['ensureLaunched', 'screenshot']);

    // Test realbrowser_get_dom
    callOrder.length = 0;
    await tools.get('realbrowser_get_dom').execute({ selector: '#test' });
    expect(callOrder).toEqual(['ensureLaunched', 'getDom']);
  });

  // Regression guard: the DSH tools registry throws
  // `tool "<name>" must declare output { schema, render, presentationMeta? }`
  // for a definition without `output`, and that throw is FATAL during
  // composition load — it aborts the whole harness boot rather than just
  // disabling the plugin.
  it('declares output { schema, render } on every registered tool', async () => {
    const registered: any[] = [];
    const mockCtx = {
      tools: {
        register: (tool: any) => {
          registered.push(tool);
        },
      },
    };

    const plugin = createHostPlugin({
      chrome: { close: vi.fn() },
      startProxy: vi.fn().mockResolvedValue({ port: 8888, close: vi.fn() }),
    });
    await plugin.apply(mockCtx);

    expect(registered.map((t) => t.name)).toEqual([
      'realbrowser_navigate',
      'realbrowser_screenshot',
      'realbrowser_get_dom',
      'realbrowser_click',
      'realbrowser_type',
      'realbrowser_evaluate',
    ]);

    for (const tool of registered) {
      expect(tool.output, `${tool.name} must declare output`).toBeDefined();
      expect(typeof tool.output.render, `${tool.name}.output.render`).toBe('function');
      expect(tool.output.schema, `${tool.name}.output.schema`).toBeDefined();
      // render() must yield model-facing content blocks for a real value.
      const blocks = tool.output.render({}, { path: '/tmp/x.png', bytes: 1 });
      expect(Array.isArray(blocks), `${tool.name}.output.render must return blocks`).toBe(true);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].type).toBe('text');
      expect(typeof blocks[0].text).toBe('string');
    }
  });
});

