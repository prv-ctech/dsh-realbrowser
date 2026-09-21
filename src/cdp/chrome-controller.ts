import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CDPClient } from './cdp-client.js';
import type { BrowserInput, BrowserSnapshot, PickedElementResult, ViewportMetrics } from '../browser/protocol.js';

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

const ELEMENT_AT_POINT_FUNCTION = String.raw`function(x, y) {
  let element = document.elementFromPoint(x, y);
  while (element && element.shadowRoot) {
    const nested = element.shadowRoot.elementFromPoint(x, y);
    if (!nested || nested === element) break;
    element = nested;
  }
  if (!element) return null;
  const cssEscape = (value) => globalThis.CSS?.escape
    ? globalThis.CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, (char) => '\\' + char.codePointAt(0).toString(16) + ' ');
  const css = [];
  for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
    if (current.id) {
      css.unshift('#' + cssEscape(current.id));
      break;
    }
    let part = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((child) => child.tagName === current.tagName)
      : [];
    if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
    css.unshift(part);
  }
  const xpathLiteral = (value) => {
    if (!value.includes('"')) return '"' + value + '"';
    if (!value.includes("'")) return "'" + value + "'";
    const items = [];
    for (const [index, part] of value.split('"').entries()) {
      if (index > 0) items.push("'\"'");
      items.push('"' + part + '"');
    }
    return 'concat(' + items.join(', ') + ')';
  };
  const xpath = [];
  for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
    if (current.id) {
      xpath.unshift('//*[@id=' + xpathLiteral(current.id) + ']');
      break;
    }
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((child) => child.tagName === current.tagName)
      : [];
    xpath.unshift(tag + (siblings.length > 1 ? '[' + (siblings.indexOf(current) + 1) + ']' : ''));
  }
  const rect = element.getBoundingClientRect();
  return {
    selector: css.join(' > '),
    xpath: xpath.join('/'),
    tag: element.tagName.toLowerCase(),
    text: (element.textContent || '').trim().slice(0, 500),
    html: (element.outerHTML || '').slice(0, 4000),
    url: location.href,
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}`;

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
  private screencastActive = false;
  private screencastDisposer: (() => void) | null = null;
  private frameSequence = 0;
  private latestFrame: { sequence: number; data: Buffer; mediaType: 'image/jpeg' } | null = null;

  constructor(cdp: CDPClient = new CDPClient(), port = 0, executablePath?: string) {
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

  async inspectElementAt(
    x: number,
    y: number,
  ): Promise<Omit<PickedElementResult, 'screenshotBase64' | 'screenshotMediaType'>> {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Element coordinates must be finite');
    const response = await this.cdp.send<{ result?: { value?: any } }>('Runtime.evaluate', {
      expression: `(${ELEMENT_AT_POINT_FUNCTION})(${JSON.stringify(x)}, ${JSON.stringify(y)})`,
      returnByValue: true,
    });
    const value = response.result?.value;
    if (value === null) throw new Error('No element found at coordinates');
    if (!value || typeof value !== 'object') throw new Error('Element metadata is unavailable');
    if (![value.selector, value.xpath, value.tag, value.text, value.html, value.url]
      .every((field) => typeof field === 'string')) {
      throw new Error('Element metadata is unavailable');
    }
    const rawBounds = value.bounds;
    if (!rawBounds || typeof rawBounds !== 'object' ||
        ![rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.height].every(Number.isFinite)) {
      throw new Error('Element bounds are unavailable');
    }
    const bounds = {
      x: rawBounds.x,
      y: rawBounds.y,
      width: rawBounds.width,
      height: rawBounds.height,
    };
    if (bounds.width <= 0 || bounds.height <= 0) throw new Error('Element bounds must have positive size');
    return {
      selector: value.selector,
      xpath: value.xpath,
      tag: value.tag.toLowerCase(),
      text: value.text.slice(0, 500),
      html: value.html.slice(0, 4000),
      url: value.url,
      bounds,
    };
  }

  async pickElementAt(x: number, y: number): Promise<PickedElementResult> {
    const selection = await this.inspectElementAt(x, y);
    const layout = await this.cdp.send<{
      cssLayoutViewport?: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
    }>('Page.getLayoutMetrics');
    const viewport = layout.cssLayoutViewport;
    if (!viewport || ![viewport.pageX, viewport.pageY, viewport.clientWidth, viewport.clientHeight].every(Number.isFinite)) {
      throw new Error('Browser viewport metrics are unavailable');
    }
    const left = Math.max(selection.bounds.x, 0);
    const top = Math.max(selection.bounds.y, 0);
    const right = Math.min(selection.bounds.x + selection.bounds.width, viewport.clientWidth);
    const bottom = Math.min(selection.bounds.y + selection.bounds.height, viewport.clientHeight);
    if (right <= left || bottom <= top) throw new Error('Element moved outside the viewport before capture');
    const shot = await this.cdp.send<{ data: string }>('Page.captureScreenshot', {
      format: 'webp',
      quality: 82,
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: viewport.pageX + left,
        y: viewport.pageY + top,
        width: right - left,
        height: bottom - top,
        scale: 1,
      },
    });
    if (typeof shot.data !== 'string' || !shot.data) throw new Error('Element screenshot returned no image data');
    return { ...selection, screenshotBase64: shot.data, screenshotMediaType: 'image/webp' };
  }

  async startScreencast(maxWidth: number, maxHeight: number): Promise<void> {
    if (this.screencastActive) await this.stopScreencast();
    this.screencastDisposer = this.cdp.on('Page.screencastFrame', (params: any) => {
      if (!this.screencastActive || typeof params?.data !== 'string') return;
      this.latestFrame = {
        sequence: ++this.frameSequence,
        data: Buffer.from(params.data, 'base64'),
        mediaType: 'image/jpeg',
      };
      void this.cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
    });
    this.screencastActive = true;
    try {
      await this.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: Math.max(1, Math.round(maxWidth)),
        maxHeight: Math.max(1, Math.round(maxHeight)),
        everyNthFrame: 1,
      });
    } catch (error) {
      this.clearScreencastLocal();
      throw error;
    }
  }

  async stopScreencast(): Promise<void> {
    if (!this.screencastActive) return;
    this.clearScreencastLocal();
    await this.cdp.send('Page.stopScreencast');
  }

  latestFrameAfter(sequence: number): { sequence: number; data: Buffer; mediaType: 'image/jpeg' } | null {
    return this.latestFrame && this.latestFrame.sequence > sequence ? this.latestFrame : null;
  }

  private clearScreencastLocal(): void {
    this.screencastActive = false;
    this.screencastDisposer?.();
    this.screencastDisposer = null;
    this.latestFrame = null;
  }

  async ensureLaunched(headless = true): Promise<void> {
    if (this.launchPromise) return this.launchPromise;
    if (this.proc) return;
    this.launchPromise = this.launch(headless).finally(() => {
      this.launchPromise = null;
    });
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

  private readAssignedPort(): number | undefined {
    if (this.port !== 0 || !this.userDataDir) return this.port || undefined;
    try {
      const value = Number.parseInt(
        fs.readFileSync(path.join(this.userDataDir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/, 1)[0],
        10,
      );
      if (Number.isInteger(value) && value > 0 && value <= 65535) return value;
    } catch {}
    return undefined;
  }

  private async waitForDebugger(maxRetries = 20): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        this.port = this.readAssignedPort() ?? this.port;
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
    this.clearScreencastLocal();
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
