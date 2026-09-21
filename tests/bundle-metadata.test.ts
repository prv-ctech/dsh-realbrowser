import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');

describe('DSH bundle metadata', () => {
  it('imports the package by its installed name', () => {
    const imports = [...patch.matchAll(/^\s+name:\s+['"]?([^'"\s]+)['"]?\s*$/gm)].map((match) => match[1]);
    expect(imports).toEqual([manifest.name]);
  });

  it('registers the client bundle by its installed name', () => {
    let registered;
    vm.runInNewContext(readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8'), {
      window: { __ModuleLoader__: { load: (value: { id?: string }) => { registered = value.id; } } },
    });
    expect(registered).toBe(manifest.name);
  });
});
