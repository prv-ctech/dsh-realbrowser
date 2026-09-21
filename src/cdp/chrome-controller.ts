import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CDPClient } from './cdp-client.js';
import type { BrowserInput, BrowserSnapshot, ViewportMetrics } from '../browser/protocol.js';

/** Build layouts used by the puppeteer / playwright download caches. */
const CACHED_BUILD_LAYOUTS = [
  path.join('chrome-linux64', 'chrome'),
  path.join('chrome-linux', 'chrome'),
  path.join('chrome-headless-shell-linux64', 'chrome-headless-shell'),
  path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  path.join('chrome-win64', 'chrome.exe'),
];

/** Browser executable names looked up on PATH. */
const PATH_BROWSER_NAMES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'chrome',
];

function isExecutable(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Roots that hold downloaded browser builds on this machine. */
function defaultBrowserCacheRoots(): string[] {
  const home = os.homedir();
  return [
    process.env.PUPPETEER_CACHE_DIR || path.join(home, '.cache', 'puppeteer', 'chrome'),
    process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(home, '.cache', 'ms-playwright'),
  ];
}

/**
 * Find a downloaded browser build under any of `roots`. Version directories are
 * scanned newest-name-first so a newer build wins.
 *
 * @param roots - cache roots; defaults to the puppeteer/playwright locations.
 * @returns the executable path, or undefined when no root holds a usable build.
 */
export function findCachedBrowserBinary(
  roots: string[] = defaultBrowserCacheRoots(),
): string | undefined {
  for (const root of roots) {
    let versions: string[];
    try {
      versions = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const version of versions.sort().reverse()) {
      for (const layout of CACHED_BUILD_LAYOUTS) {
        const candidate = path.join(root, version, layout);
        if (isExecutable(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

export interface ChromeLookup {
  /** Directories searched for a browser executable, in order. */
  pathDirs?: string[];
  /** Cache roots holding downloaded browser builds. */
  cacheRoots?: string[];
  /** Environment supplying CHROME_PATH / CHROME_BIN and PATH. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve a usable Chrome/Chromium executable.
 *
 * Lookup order: explicit path, `CHROME_PATH`/`CHROME_BIN`, PATH entries, then
 * the downloaded-browser caches. Throwing an actionable error matters here — the
 * previous fallback returned the bare name `google-chrome`, so a machine with no
 * system Chrome failed much later as `spawn google-chrome ENOENT`, far from the
 * cause and invisible to the user.
 *
 * @param explicit - caller-supplied path; validated, never silently ignored.
 * @param lookup - injectable discovery inputs (tests).
 * @returns an absolute path to an executable browser.
 */
export function resolveChromeBinary(explicit?: string, lookup: ChromeLookup = {}): string {
  if (explicit) {
    if (isExecutable(explicit)) return explicit;
    throw new Error(`RealBrowser: the configured Chrome path is not executable: ${explicit}`);
  }

  const env = lookup.env ?? process.env;
  for (const key of ['CHROME_PATH', 'CHROME_BIN'] as const) {
    const value = env[key]?.trim();
    if (!value) continue;
    if (isExecutable(value)) return value;
    throw new Error(`RealBrowser: ${key} is not an executable path: ${value}`);
  }

  const pathDirs = lookup.pathDirs ?? (env.PATH || '').split(path.delimiter);
  const names =
    process.platform === 'win32'
      ? PATH_BROWSER_NAMES.flatMap((name) => [`${name}.exe`, name])
      : PATH_BROWSER_NAMES;
  for (const name of names) {
    for (const dir of pathDirs) {
      if (!dir) continue;
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }

  const cached = findCachedBrowserBinary(lookup.cacheRoots);
  if (cached) return cached;

  throw new Error(
    'RealBrowser could not find a Chrome/Chromium executable. Install Chrome or Chromium, or ' +
      'point CHROME_PATH at the browser binary (a download under ~/.cache/puppeteer works).',
  );
}

export class ChromeController {
  private proc: ChildProcess | null = null;
  private cdp: CDPClient;
  public port: number;
  private executablePath?: string;
  private launchPromise: Promise<void> | null = null;
  private userDataDir: string | null = null;
  private snapshot: BrowserSnapshot = {
    url: 'about:blank',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };
  private snapshotListeners = new Set<(snapshot: BrowserSnapshot) => void>();
  private cdpDisposers: Array<() => void> = [];

  constructor(cdp: CDPClient = new CDPClient(), port = 9222, executablePath?: string) {
    this.cdp = cdp;
    this.port = port;
    this.executablePath = executablePath;
    const on = (cdp as any).on?.bind(cdp);
    if (on) {
      this.cdpDisposers.push(
        on('Page.frameStartedLoading', () => this.updateSnapshot({ loading: true })),
        on('Page.frameNavigated', (params: any) => {
          if (!params?.frame?.parentId && typeof params?.frame?.url === 'string') {
            this.updateSnapshot({ url: params.frame.url });
          }
        }),
        on('Page.loadEventFired', () => {
          this.updateSnapshot({ loading: false });
          void this.refreshHistory();
        }),
      );
    }
  }

  private resolveBinary(): string {
    return resolveChromeBinary(this.executablePath);
  }

  private updateSnapshot(update: Partial<BrowserSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    const value = this.getSnapshot();
    for (const listener of this.snapshotListeners) listener(value);
  }

  private async refreshHistory(): Promise<{ currentIndex: number; entries: Array<{ id: number; url?: string; title?: string }> }> {
    const history = await this.cdp.send<{
      currentIndex: number;
      entries: Array<{ id: number; url?: string; title?: string }>;
    }>('Page.getNavigationHistory');
    const current = history.entries[history.currentIndex];
    this.updateSnapshot({
      ...(current?.url ? { url: current.url } : {}),
      ...(typeof current?.title === 'string' ? { title: current.title } : {}),
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
    });
    return history;
  }

  async initialize(): Promise<void> {
    await this.cdp.send('Page.enable');
    await this.cdp.send('DOM.enable');
    await this.cdp.send('Runtime.enable');
    await this.refreshHistory();
  }

  getSnapshot(): BrowserSnapshot {
    return { ...this.snapshot };
  }

  onSnapshot(listener: (snapshot: BrowserSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  async setViewport(metrics: ViewportMetrics): Promise<void> {
    if (!Number.isInteger(metrics.width) || metrics.width <= 0 ||
        !Number.isInteger(metrics.height) || metrics.height <= 0) {
      throw new Error('Viewport dimensions must be positive integers');
    }
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: metrics.width,
      height: metrics.height,
      screenWidth: metrics.width,
      screenHeight: metrics.height,
      deviceScaleFactor: metrics.deviceScaleFactor,
      mobile: metrics.mobile,
    });
  }

  async goBack(): Promise<void> {
    const history = await this.refreshHistory();
    const entry = history.entries[history.currentIndex - 1];
    if (entry) await this.cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
  }

  async goForward(): Promise<void> {
    const history = await this.refreshHistory();
    const entry = history.entries[history.currentIndex + 1];
    if (entry) await this.cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
  }

  async reload(): Promise<void> {
    await this.cdp.send('Page.reload', { ignoreCache: false });
  }

  async dispatchInput(input: BrowserInput): Promise<void> {
    if (input.kind === 'mouse') {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: input.type,
        x: input.x,
        y: input.y,
        ...(input.button ? { button: input.button } : {}),
        ...(input.clickCount === undefined ? {} : { clickCount: input.clickCount }),
      });
    } else if (input.kind === 'wheel') {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: input.x,
        y: input.y,
        deltaX: input.deltaX,
        deltaY: input.deltaY,
      });
    } else if (input.kind === 'key') {
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: input.type,
        key: input.key,
        code: input.code,
        modifiers: input.modifiers,
      });
    } else {
      await this.cdp.send('Input.insertText', { text: input.text });
    }
  }

  async ensureLaunched(headless = true): Promise<void> {
    if (this.proc) return;
    if (!this.launchPromise) {
      this.launchPromise = this.launch(headless).finally(() => {
        this.launchPromise = null;
      });
    }
    return this.launchPromise;
  }

  async launch(headless = true): Promise<void> {
    const binary = this.resolveBinary();
    if (!this.userDataDir) {
      this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realbrowser-chrome-'));
    }
    const args = [
      `--remote-debugging-port=${this.port}`,
      headless ? '--headless=new' : '',
      `--user-data-dir=${this.userDataDir}`,
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ].filter(Boolean);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const proc = spawn(binary, args, { stdio: 'ignore' });
      this.proc = proc;

      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          this.proc = null;
          this.cleanupUserDataDir();
          reject(err);
        }
      });

      this.waitForDebugger()
        .then(() => this.getPageWsUrl())
        .then((wsUrl) => this.cdp.connect(wsUrl))
        .then(() => this.initialize())
        .then(() => {
          if (!settled) {
            settled = true;
            resolve();
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            if (this.proc) {
              this.proc.kill();
              this.proc = null;
            }
            this.cleanupUserDataDir();
            reject(err);
          }
        });
    });
  }

  private async waitForDebugger(maxRetries = 20): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await new Promise<void>((resolve, reject) => {
          http.get(`http://127.0.0.1:${this.port}/json/version`, (res) => {
            if (res.statusCode === 200) resolve();
            else reject();
          }).on('error', reject);
        });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error('Timed out waiting for Chrome debugging port');
  }

  private async getPageWsUrl(): Promise<string> {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${this.port}/json/list`, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          const targets = JSON.parse(body);
          const page = targets.find((t: any) => t.type === 'page');
          if (page && page.webSocketDebuggerUrl) resolve(page.webSocketDebuggerUrl);
          else reject(new Error('No page target found'));
        });
      }).on('error', reject);
    });
  }

  async navigate(url: string): Promise<void> {
    await this.cdp.send('Page.navigate', { url });
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    const res = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result?.value;
  }

  async click(selector: string): Promise<void> {
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  }

  async type(selector: string, text: string): Promise<void> {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
  }

  async screenshot(): Promise<string> {
    const res = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    return res.data;
  }

  async getDom(selector?: string): Promise<string> {
    if (selector) {
      const result = await this.evaluate<string>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? el.outerHTML : '';
      })()`);
      return result || '';
    }
    const result = await this.evaluate<string>(`document.documentElement ? document.documentElement.outerHTML : ''`);
    return result || '';
  }

  private cleanupUserDataDir(): void {
    if (this.userDataDir) {
      try {
        fs.rmSync(this.userDataDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
      this.userDataDir = null;
    }
  }

  close(): void {
    for (const dispose of this.cdpDisposers.splice(0)) dispose();
    this.snapshotListeners.clear();
    this.cdp.close();
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.cleanupUserDataDir();
    this.launchPromise = null;
  }
}
