import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');

describe('DSH bundle metadata', () => {
  it('imports the package by its installed name', () => {
    const imports = [...patch.matchAll(/^\s+name:\s+['"]?([^'"\s]+)['"]?\s*$/gm)].map((match) => match[1]);
    expect(imports).toEqual([manifest.name]);
  });
});
