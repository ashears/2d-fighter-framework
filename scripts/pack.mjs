import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const root = new URL('../', import.meta.url);
export const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export function packWorkspace(directory, destination) {
  const manifest = JSON.parse(readFileSync(new URL(`${directory}/package.json`, root), 'utf8'));
  const cache = mkdtempSync(join(tmpdir(), 'fighter-pack-cache-'));
  try {
    const [pack] = JSON.parse(execFileSync(npm, [
      'pack', '--workspace', manifest.name, '--pack-destination', destination,
      '--cache', cache, '--json',
    ], { cwd: root, encoding: 'utf8' }));
    const files = new Set(pack.files.map(({ path }) => path));
    for (const entry of Object.values(manifest.exports)) {
      for (const target of Object.values(entry)) {
        assert(files.has(target.slice(2)), `${manifest.name} archive is missing ${target}`);
      }
    }
    return { path: join(destination, pack.filename), pack };
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}
