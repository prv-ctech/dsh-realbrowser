import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCachedBrowserBinary, resolveChromeBinary } from '../src/cdp/chrome-controller.js';

/** Create a fake cached browser build at `<root>/<version>/<layout>`. */
function makeCachedBuild(root: string, version: string, layout: string): string {
  const binary = path.join(root, version, ...layout.split('/'));
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, '#!/bin/sh\n', { mode: 0o755 });
  return binary;
}

describe('Chrome binary resolution', () => {
  const tmpDirs: string[] = [];
  const tmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-chrome-'));
    tmpDirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('findCachedBrowserBinary', () => {
    it('finds a puppeteer-style chrome build', () => {
      const root = tmp();
      const binary = makeCachedBuild(root, 'linux-152.0.7977.54', 'chrome-linux64/chrome');
      expect(findCachedBrowserBinary([root])).toBe(binary);
    });

    it('finds a chrome-headless-shell build', () => {
      const root = tmp();
      const binary = makeCachedBuild(
        root,
        'linux-1',
        'chrome-headless-shell-linux64/chrome-headless-shell',
      );
      expect(findCachedBrowserBinary([root])).toBe(binary);
    });

    it('prefers the newest version directory', () => {
      const root = tmp();
      makeCachedBuild(root, 'linux-100', 'chrome-linux64/chrome');
      const newest = makeCachedBuild(root, 'linux-200', 'chrome-linux64/chrome');
      expect(findCachedBrowserBinary([root])).toBe(newest);
    });

    it('returns undefined when no root holds a usable build', () => {
      const root = tmp();
      fs.mkdirSync(path.join(root, 'linux-1'), { recursive: true });
      expect(findCachedBrowserBinary([root])).toBeUndefined();
      expect(findCachedBrowserBinary([path.join(root, 'missing')])).toBeUndefined();
      expect(findCachedBrowserBinary([])).toBeUndefined();
    });
  });

  describe('resolveChromeBinary', () => {
    it('honors an explicit executable path', () => {
      expect(resolveChromeBinary(process.execPath)).toBe(process.execPath);
    });

    it('rejects an explicit path that is not executable', () => {
      expect(() => resolveChromeBinary('/definitely/not/a/browser')).toThrow(/not executable/i);
    });

    // The reported defect: with no system Chrome installed, resolution fell back
    // to the bare name "google-chrome" and spawn failed with ENOENT.
    it('throws an actionable error instead of returning a bare unresolved name', () => {
      const empty = tmp();
      expect(() =>
        resolveChromeBinary(undefined, {
          env: {},
          pathDirs: [empty],
          cacheRoots: [empty],
        }),
      ).toThrow(/CHROME_PATH/);
    });

    it('falls back to a cached build when nothing is on PATH', () => {
      const cacheRoot = tmp();
      const binary = makeCachedBuild(cacheRoot, 'linux-152', 'chrome-linux64/chrome');
      expect(
        resolveChromeBinary(undefined, {
          env: {},
          pathDirs: [tmp()],
          cacheRoots: [cacheRoot],
        }),
      ).toBe(binary);
    });

    it('prefers CHROME_PATH from the environment', () => {
      const binDir = tmp();
      const binary = path.join(binDir, 'my-chrome');
      fs.writeFileSync(binary, '#!/bin/sh\n', { mode: 0o755 });
      expect(
        resolveChromeBinary(undefined, {
          env: { CHROME_PATH: binary },
          pathDirs: [],
          cacheRoots: [],
        }),
      ).toBe(binary);
    });
  });
});
