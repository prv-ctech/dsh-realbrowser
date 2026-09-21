import { describe, it, expect, vi } from 'vitest';
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
    expect(screenshotResult).toBe('base64_screenshot_data');

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
});

