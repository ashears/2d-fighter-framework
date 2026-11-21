import { fighterIds, referenceConfig, ruleIds, stageIds, supportsMatch } from '@ashears/fighter-reference';
import { createRoomServer } from '@ashears/fighter-relay';

const relay = createRoomServer({
  game: { fighters: fighterIds, stages: stageIds, rules: ruleIds, config: referenceConfig, supports: supportsMatch },
  allowedOrigins: process.env.FIGHTER_ROOM_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean),
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const address = await relay.listen(port, host);
console.log(`Private room server listening at http://${host}:${address.port}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void relay.close(); });
}
