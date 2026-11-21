import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npm, packWorkspace, root } from './pack.mjs';

const consumer = mkdtempSync(join(tmpdir(), 'fighter-consumer-'));
try {
  const { path, pack } = packWorkspace('packages/core', consumer);
  const relay = packWorkspace('packages/relay', consumer);
  const files = pack.files.map((file) => file.path);
  for (const asset of ['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE']) assert(files.includes(asset), asset);
  assert(files.every((file) => !file.includes('tsbuildinfo')));
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'smoke-consumer', private: true, type: 'module' }));
  execFileSync(npm, ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--cache', join(consumer, '.npm-cache'), path, relay.path], { cwd: consumer, stdio: 'inherit' });
  const manifestPath = join(consumer, 'node_modules', '@ashears', '2d-fighter-framework', 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  writeFileSync(join(consumer, 'app.ts'), `
import { Button, createMatch, healthRules, TICK_RATE } from '@ashears/2d-fighter-framework';
import type { FighterDefinition, MatchDefinition } from '@ashears/2d-fighter-framework';
import { createRoomServer } from '@ashears/fighter-relay';
import type { RoomGame } from '@ashears/fighter-relay';
import { decodeClientMessage, encodeMessage } from '@ashears/fighter-relay/protocol';
import type { ClientMessage } from '@ashears/fighter-relay/protocol';

const move = { name: 'Strike', startup: 1, active: 1, recovery: 3, actions: [] };
const fighter: FighterDefinition = {
  id: 'sample', name: 'Sample', maxHealth: 100, maxGuard: 50, guardRegen: .25,
  walkSpeed: 4, jumpSpeed: 11, airJumps: 1, hurtbox: { x: -12, y: -30, width: 24, height: 30 },
  moves: { light: move, heavy: move, special: move },
};
const definition: MatchDefinition = {
  fighters: [fighter, fighter], seed: 1, timeLimit: TICK_RATE * 30,
  stage: {
    id: 'test', gravity: 1, fallSpeed: 12, walls: { left: 0, right: 300 },
    spawns: [{ x: 90, y: 150 }, { x: 210, y: 150 }],
    surfaces: [{ id: 'floor', x: 0, y: 150, width: 300, oneWay: false }],
  },
};
const match = createMatch(definition, healthRules);
const first = match.step([Button.Right, Button.Left]);
if (first.snapshot.tick !== 1 || first.snapshot.fighters[0].position.x !== 94) throw new Error('Invalid packed simulation');
if (false) {
  // @ts-expect-error Snapshot values are read-only.
  first.snapshot.fighters[0].position.x = 100;
}
const game: RoomGame<'sample', 'test', 'health', null> = {
  fighters: ['sample'], stages: ['test'], rules: ['health'],
  config: (_fighters, _stage, _rule, seed) => ({ definition: { ...definition, seed }, rules: healthRules }),
};
const message: ClientMessage = { type: 'create', stage: 'test', rule: 'health' };
if (decodeClientMessage(encodeMessage(message))?.type !== 'create') throw new Error('Invalid packed room protocol');
const relay = createRoomServer({ game });
try {
  const { port } = await relay.listen(0);
  const response = await fetch(\`http://127.0.0.1:\${port}/health\`);
  if (!response.ok || (await response.text()).trim() !== 'ok') throw new Error('Invalid packed room server');
} finally {
  await relay.close();
}
console.log('Packed core and relay ran successfully in a clean consumer.');
`);
  const tsc = fileURLToPath(new URL('node_modules/typescript/bin/tsc', root));
  const typeRoots = fileURLToPath(new URL('node_modules/@types', root));
  execFileSync(process.execPath, [
    tsc, '--target', 'ES2022', '--module', 'NodeNext', '--strict', '--typeRoots', typeRoots, '--types', 'node', 'app.ts',
  ], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, ['app.js'], { cwd: consumer, stdio: 'inherit' });
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
