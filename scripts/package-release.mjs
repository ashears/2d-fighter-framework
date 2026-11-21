import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packWorkspace, root } from './pack.mjs';

const destination = fileURLToPath(new URL('artifacts/', root));
mkdirSync(destination, { recursive: true });
const core = packWorkspace('packages/core', destination);
const relay = packWorkspace('packages/relay', destination);
const demo = join(destination, `aftershift-demo-${core.pack.version}.tar.gz`);
execFileSync('tar', ['-czf', demo, '-C', fileURLToPath(new URL('apps/demo/dist', root)), '.'], { stdio: 'inherit' });
const checksums = [core.path, relay.path, demo].map((file) => {
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  return `${sha256}  ${basename(file)}`;
});
writeFileSync(join(destination, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
console.log(checksums.join('\n'));
