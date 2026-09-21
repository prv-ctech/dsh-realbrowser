import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CDPClient } from './cdp-client.js';

export class ChromeController {
  private proc: ChildProcess | null = null;
  private cdp: CDPClient;
  public port: number;
  private executablePath?: string;
  private launchPromise: Promise<void> | null = null;
  private userDataDir: string | null = null;

  constructor(cdp: CDPClient = new CDPClient(), port = 9222, executablePath?: string) {
    this.cdp = cdp;
    this.port = port;
    this.executablePath = executablePath;
  }

  private resolveBinary(): string {
    if (this.executablePath) return this.executablePath;
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    if (process.env.CHROME_BIN) return process.env.CHROME_BIN;

    const candidates = ['google-chrome', 'chromium', 'chromium-browser'];
    const pathEnv = process.env.PATH || '';
    const delimiter = process.platform === 'win32' ? ';' : ':';
    const dirs = pathEnv.split(delimiter);

    for (const candidate of candidates) {
      for (const dir of dirs) {
        if (!dir) continue;
        const fullPath = path.join(dir, candidate);
        try {
          if (fs.existsSync(fullPath)) {
            fs.accessSync(fullPath, fs.constants.X_OK);
            return fullPath;
          }
        } catch {
          // ignore and continue
        }
      }
    }
    return candidates[0];
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
    this.cdp.close();
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.cleanupUserDataDir();
    this.launchPromise = null;
  }
}
