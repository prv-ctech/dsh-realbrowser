import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { formatCDPMessage, CDPClient } from '../src/cdp/cdp-client.js';
import { ChromeController } from '../src/cdp/chrome-controller.js';

describe('formatCDPMessage', () => {
  it('formats JSON-RPC message with incrementing id and params', () => {
    const msg = formatCDPMessage(1, 'Page.navigate', { url: 'https://example.com' });
    expect(JSON.parse(msg)).toEqual({
      id: 1,
      method: 'Page.navigate',
      params: { url: 'https://example.com' },
    });
  });

  it('formats JSON-RPC message without params', () => {
    const msg = formatCDPMessage(2, 'Page.captureScreenshot');
    expect(JSON.parse(msg)).toEqual({
      id: 2,
      method: 'Page.captureScreenshot',
    });
  });
});

describe('CDPClient', () => {
  let wss: WebSocketServer;
  let wsUrl: string;

  beforeAll(async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      wss.on('listening', resolve);
    });
    const port = (wss.address() as AddressInfo).port;
    wsUrl = `ws://127.0.0.1:${port}`;

    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.method === 'Page.navigate') {
          ws.send(JSON.stringify({ id: parsed.id, result: { frameId: '123' } }));
        } else if (parsed.method === 'Fail.test') {
          ws.send(JSON.stringify({ id: parsed.id, error: { message: 'Command failed' } }));
        } else if (parsed.method === 'Runtime.evaluate') {
          ws.send(JSON.stringify({ id: parsed.id, result: { result: { type: 'string', value: 'evaluated_val' } } }));
        } else if (parsed.method === 'Page.captureScreenshot') {
          ws.send(JSON.stringify({ id: parsed.id, result: { data: 'base64_data' } }));
        }
      });
    });
  });

  afterAll(() => {
    wss.close();
  });

  it('throws error when sending before connect', async () => {
    const client = new CDPClient();
    await expect(client.send('Page.navigate', { url: 'https://example.com' })).rejects.toThrow('WebSocket not connected');
  });

  it('connects to mock WebSocket server and sends commands successfully', async () => {
    const client = new CDPClient();
    await client.connect(wsUrl);

    const result = await client.send('Page.navigate', { url: 'https://example.com' });
    expect(result).toEqual({ frameId: '123' });

    client.close();
  });

  it('rejects with error message when CDP returns error', async () => {
    const client = new CDPClient();
    await client.connect(wsUrl);

    await expect(client.send('Fail.test')).rejects.toThrow('Command failed');

    client.close();
  });

  it('closes connection cleanly', async () => {
    const client = new CDPClient();
    await client.connect(wsUrl);
    client.close();
    await expect(client.send('Page.navigate')).rejects.toThrow('WebSocket not connected');
  });

  it('rejects pending promises when client is closed', async () => {
    const client = new CDPClient();
    await client.connect(wsUrl);
    const promise = client.send('Pending.test');
    client.close();
    await expect(promise).rejects.toThrow('WebSocket closed');
  });

  it('rejects pending promises when WebSocket disconnects', async () => {
    const client = new CDPClient();
    await client.connect(wsUrl);
    const promise = client.send('Pending.test');
    (client as any).ws?.close();
    await expect(promise).rejects.toThrow(/WebSocket closed/);
  });

  it('handles malformed JSON message without crashing', async () => {
    const client = new CDPClient();
    await client.connect(wsUrl);
    (client as any).ws?.emit('message', Buffer.from('invalid json {{{'));
    const result = await client.send('Page.navigate', { url: 'https://example.com' });
    expect(result).toEqual({ frameId: '123' });
    client.close();
  });
});

describe('ChromeController', () => {
  let wss: WebSocketServer;
  let wsUrl: string;
  let mockCdp: CDPClient;

  beforeAll(async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      wss.on('listening', resolve);
    });
    const port = (wss.address() as AddressInfo).port;
    wsUrl = `ws://127.0.0.1:${port}`;

    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.method === 'Page.navigate') {
          ws.send(JSON.stringify({ id: parsed.id, result: { frameId: 'nav_frame' } }));
        } else if (parsed.method === 'Runtime.evaluate') {
          ws.send(JSON.stringify({ id: parsed.id, result: { result: { value: 'evaluated_result' } } }));
        } else if (parsed.method === 'Page.captureScreenshot') {
          ws.send(JSON.stringify({ id: parsed.id, result: { data: 'screenshot_base64_data' } }));
        }
      });
    });

    mockCdp = new CDPClient();
    await mockCdp.connect(wsUrl);
  });

  afterAll(() => {
    mockCdp.close();
    wss.close();
  });

  it('navigates to url', async () => {
    const controller = new ChromeController(mockCdp);
    await expect(controller.navigate('https://example.com')).resolves.toBeUndefined();
  });

  it('evaluates expression and returns result value', async () => {
    const controller = new ChromeController(mockCdp);
    const res = await controller.evaluate('1 + 1');
    expect(res).toBe('evaluated_result');
  });

  it('clicks selector via evaluate', async () => {
    let evaluatedExpression = '';
    const spyCdp = {
      send: async (method: string, params?: Record<string, unknown>) => {
        if (method === 'Runtime.evaluate') {
          evaluatedExpression = params?.expression as string;
          return { result: { value: undefined } };
        }
        return {};
      },
      close: () => {},
      connect: async () => {},
    } as unknown as CDPClient;

    const controller = new ChromeController(spyCdp);
    await controller.click('#submit-btn');
    expect(evaluatedExpression).toContain('document.querySelector("#submit-btn")?.click()');
  });

  it('types text into selector via evaluate', async () => {
    let evaluatedExpression = '';
    const spyCdp = {
      send: async (method: string, params?: Record<string, unknown>) => {
        if (method === 'Runtime.evaluate') {
          evaluatedExpression = params?.expression as string;
          return { result: { value: undefined } };
        }
        return {};
      },
      close: () => {},
      connect: async () => {},
    } as unknown as CDPClient;

    const controller = new ChromeController(spyCdp);
    await controller.type('#input-box', 'hello world');
    expect(evaluatedExpression).toContain('document.querySelector("#input-box")');
    expect(evaluatedExpression).toContain('"hello world"');
    expect(evaluatedExpression).toContain("new Event('input'");
    expect(evaluatedExpression).toContain("new Event('change'");
  });

  it('captures screenshot and returns base64 data', async () => {
    const controller = new ChromeController(mockCdp);
    const data = await controller.screenshot();
    expect(data).toBe('screenshot_base64_data');
  });

  it('close closes CDP and kills proc if present', () => {
    let closed = false;
    let killed = false;
    const fakeCdp = {
      close: () => { closed = true; },
    } as unknown as CDPClient;

    const controller = new ChromeController(fakeCdp);
    (controller as any).proc = {
      kill: () => { killed = true; },
    };

    controller.close();
    expect(closed).toBe(true);
    expect(killed).toBe(true);
    expect((controller as any).proc).toBeNull();
  });

  it('ensureLaunched returns immediately if proc exists', async () => {
    const controller = new ChromeController(mockCdp);
    (controller as any).proc = { kill: vi.fn() };
    const launchSpy = vi.spyOn(controller, 'launch').mockResolvedValue(undefined);
    await controller.ensureLaunched();
    expect(launchSpy).not.toHaveBeenCalled();
  });

  it('ensureLaunched launches once on concurrent calls', async () => {
    const controller = new ChromeController(mockCdp);
    let resolveLaunch!: () => void;
    const launchPromise = new Promise<void>((res) => { resolveLaunch = res; });
    const launchSpy = vi.spyOn(controller, 'launch').mockImplementation(() => launchPromise);

    const p1 = controller.ensureLaunched();
    const p2 = controller.ensureLaunched();
    expect(launchSpy).toHaveBeenCalledTimes(1);

    resolveLaunch();
    await Promise.all([p1, p2]);
  });

  it('waitForDebugger times out if port is unreachable', async () => {
    // Port 1 is not open
    const controller = new ChromeController(mockCdp, 1);
    await expect((controller as any).waitForDebugger(2)).rejects.toThrow('Timed out waiting for Chrome debugging port');
  });

  it('getPageWsUrl returns page target webSocketDebuggerUrl', async () => {
    const mockHttp = http.createServer((req, res) => {
      if (req.url === '/json/list') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          { type: 'background_page', id: 'bg1' },
          { type: 'page', id: 'page1', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page1' }
        ]));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => mockHttp.listen(0, '127.0.0.1', resolve));
    const port = (mockHttp.address() as AddressInfo).port;

    const controller = new ChromeController(mockCdp, port);
    const pageWsUrl = await (controller as any).getPageWsUrl();
    expect(pageWsUrl).toBe('ws://127.0.0.1:9222/devtools/page/page1');

    mockHttp.close();
  });

  it('getPageWsUrl rejects if no page target found', async () => {
    const mockHttp = http.createServer((req, res) => {
      if (req.url === '/json/list') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          { type: 'service_worker', id: 'sw1' }
        ]));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => mockHttp.listen(0, '127.0.0.1', resolve));
    const port = (mockHttp.address() as AddressInfo).port;

    const controller = new ChromeController(mockCdp, port);
    await expect((controller as any).getPageWsUrl()).rejects.toThrow('No page target found');

    mockHttp.close();
  });

  it('handles process spawn error and rejects launch without crashing', async () => {
    const controller = new ChromeController(mockCdp, 9222, 'nonexistent-chrome-binary-test-xyz');
    await expect(controller.launch()).rejects.toThrow();
  });
});
