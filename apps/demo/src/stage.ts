import Phaser from 'phaser';
import { getCombatBoxes } from '@ashears/2d-fighter-framework';
import type { GameEvent, MatchDefinition, ReadonlyDeep, Seat, Snapshot } from '@ashears/2d-fighter-framework';
import { arenas } from '@ashears/fighter-reference';
import type { StageId } from '@ashears/fighter-reference';

const width = 960;
const height = 540;
const coral = 0xffad77;
const mint = 0x8be6ce;
const palettes = [
  { ink: 0x25192c, shade: 0x87394d, metal: 0xd06659, light: coral },
  { ink: 0x142033, shade: 0x366979, metal: 0x65b5b5, light: mint },
];

type Graphics = Phaser.GameObjects.Graphics;
type Point = { x: number; y: number };
interface Spark extends Point { born: number; color: number; strength: number }

function polygon(graphics: Graphics, color: number, points: number[], alpha = 1) {
  graphics.fillStyle(color, alpha);
  graphics.fillPoints(points.flatMap((x, index) => index % 2 ? [] : [new Phaser.Math.Vector2(x, points[index + 1])]), true);
}

function paintBackground(graphics: Graphics, stage: StageId) {
  const outdoors = stage === 'overpass';
  const palette = outdoors ? [0x192a42, 0x444368, 0xad6970] : [0x191a2d, 0x282538, 0x663c4b];
  graphics.clear();
  for (let y = 0; y < height; y += 3) {
    const progress = y / height * 2;
    const index = Math.min(1, Math.floor(progress));
    const a = Phaser.Display.Color.IntegerToColor(palette[index]);
    const b = Phaser.Display.Color.IntegerToColor(palette[index + 1]);
    const color = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, 540, (progress - index) * 540);
    graphics.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b)).fillRect(0, y, width, 3);
  }

  for (let i = 0; i < 58; i++) {
    const x = (i * 163 + 37) % width;
    const y = (i * i * 19 + 41) % 305;
    graphics.fillStyle(i % 5 ? 0xbdb8d3 : 0xffd6b0, i % 4 === 0 ? 0.65 : 0.25).fillCircle(x, y, i % 9 ? 1 : 1.7);
  }

  const sun = outdoors ? { x: 710, y: 168, r: 91 } : { x: 480, y: 264, r: 133 };
  const glow = outdoors ? 0xffc8ad : 0xf28d7f;
  graphics.fillStyle(glow, 0.045).fillCircle(sun.x, sun.y, sun.r + 25);
  graphics.lineStyle(1, glow, 0.26).strokeCircle(sun.x, sun.y, sun.r + 14);
  for (let y = -sun.r; y <= sun.r; y += 4) {
    const half = Math.sqrt(sun.r * sun.r - y * y);
    if (!half || (y > 12 && Math.abs(y % 12) > 4)) continue;
    graphics.fillStyle(glow, y < 12 ? 0.86 : 0.55).fillRect(sun.x - half, sun.y + y, half * 2, 4);
  }

  for (let column = 0; column < 26; column++) {
    const x = column * 40;
    const roof = 330 - (column * 31 % 99) - (column % 4 ? 0 : 22);
    graphics.fillStyle(outdoors ? 0x303c55 : 0x382a3f).fillRect(x, roof, 38, 125);
    for (let row = 0; row < 7; row++) {
      if ((row * 7 + column) % 5 > 2) continue;
      graphics.fillStyle(0xe1ab83, 0.31).fillRect(x + 10 + (row % 2) * 12, roof + 13 + row * 11, 5, 2);
    }
    if (column % 4 === 0) graphics.lineStyle(1, 0x483d5a, 0.8).lineBetween(x + 17, roof, x + 17, roof - 22);
  }

  polygon(graphics, 0x292638, [0, 360, 97, 333, 203, 371, 334, 348, 443, 374, 570, 354, 722, 386, 818, 343, 960, 369, 960, 540, 0, 540]);
  for (let x = 18; x < 950; x += 67) {
    const y = 391 + (x % 29);
    graphics.fillStyle(0x9b777e, 0.3).fillRect(x, y, 30, 2);
  }

  if (outdoors) {
    for (const x of [65, 894]) {
      graphics.fillStyle(0x252b46).fillRect(x - 14, 176, 28, 364);
      graphics.lineStyle(1, 0xa4a8bf, 0.27).lineBetween(x, 181, x, 528);
      graphics.fillStyle(coral, 0.8).fillCircle(x, 177, 3);
      for (let index = 1; index <= 6; index++) {
        graphics.lineStyle(1.5, 0xa0a7bf, 0.16).lineBetween(x, 176, x + (x < 100 ? 1 : -1) * index * 68, 420);
      }
    }
  } else {
    // Terminal gantries frame the play area and leave its silhouettes readable.
    polygon(graphics, 0x232132, [0, 114, 104, 126, 104, 423, 0, 454]);
    polygon(graphics, 0x232132, [960, 114, 856, 126, 856, 423, 960, 454]);
    for (const x of [82, 878]) {
      graphics.fillStyle(0x151622).fillRect(x - 8, 119, 16, 320);
      graphics.fillStyle(0x756065).fillRect(x - 8, 119, 2, 312);
      graphics.lineStyle(3, 0x746275, 0.55).lineBetween(x, 146, x + (x < 100 ? 91 : -91), 86);
      graphics.fillStyle(0xffb279, 0.82).fillRect(x - 13, 277, 26, 3);
    }
    graphics.lineStyle(1, 0xd3847f, 0.32).lineBetween(109, 312, 850, 312);
    graphics.lineStyle(1, 0x161825, 0.82).lineBetween(104, 321, 856, 321);
  }

  for (const { x, y, width: span, oneWay } of arenas[stage].surfaces) {
    const depth = oneWay ? 15 : 44;
    polygon(graphics, 0x171825, [
      x, y, x + span, y, x + span - (oneWay ? 10 : 20), y + depth, x + (oneWay ? 10 : 20), y + depth,
    ]);
    graphics.fillStyle(oneWay ? 0x9abcc1 : 0xb99996).fillRect(x, y, span, 3);
    graphics.fillStyle(oneWay ? 0x536775 : 0x51404b).fillRect(x + 3, y + 5, span - 6, 4);
    for (let bolt = x + 13; bolt < x + span - 8; bolt += 33) {
      graphics.fillStyle(oneWay ? mint : coral, bolt % 2 === 0 ? 0.56 : 0.79).fillRect(bolt, y + 8, 7, 2);
    }
    if (!oneWay) {
      for (let brace = x + 38; brace < x + span - 30; brace += 38) {
        graphics.lineStyle(2, 0xb9928e, 0.22).lineBetween(brace, y + 14, brace - 12, y + 32);
      }
    }
  }
  graphics.fillStyle(0x171722, 0.67).fillRect(0, 518, width, 22);
  graphics.lineStyle(1, 0xb0898d, 0.25).lineBetween(0, 518, width, 518);
}

function paintFighter(graphics: Graphics, x: number, y: number, seat: Seat, id: string, tick: number, actor: Snapshot['fighters'][0]) {
  if (actor.respawn || actor.health <= 0) return;
  const { ink, shade, metal, light } = palettes[seat];
  const heavy = id === 'forge';
  const alpha = actor.invulnerable > 0 && tick % 9 < 4 ? 0.55 : 1;
  const facing = actor.move?.facing ?? actor.facing;
  const bob = actor.surface === null ? 1 : Math.sin(tick * 0.12 + seat) * 1.8;
  const stride = actor.surface && Math.abs(actor.velocity.x) > 1 ? Math.sin(tick * 0.52) * 12 : 0;
  const striking = actor.move ? Math.min(24, actor.move.frame * 3) * (actor.move.slot === 'light' ? 0.7 : 1) : 0;
  const pose = (color: number, points: number[], opacity = alpha) =>
    polygon(graphics, color, points.map((point, index) => index % 2 ? y + point + bob : x + point * facing), opacity);

  graphics.fillStyle(0x0e101d, 0.48).fillEllipse(x, y + 1, heavy ? 76 : 62, 10);
  pose(ink, [-21, -44, -1, -42, -3 - stride, -9, -24 - stride, -1, -30 - stride, -5, -23 - stride, -18]);
  pose(shade, [1, -44, 21, -44, 18 + stride, -14, 31 + stride, -5, 29 + stride, 0, 9 + stride, 0]);
  pose(metal, [3, -36, 17, -37, 15 + stride, -17, 6 + stride, -16]);
  pose(light, [-22 - stride, -8, -10 - stride, -10, -10 - stride, -6, -23 - stride, -4]);

  if (heavy) {
    pose(ink, [-30, -77, -19, -88, 17, -88, 30, -74, 22, -38, -22, -38]);
    pose(shade, [-25, -72, -15, -83, 17, -79, 24, -68, 17, -43, -19, -43]);
    pose(metal, [-20, -73, 10, -79, 19, -71, 13, -55, -14, -55]);
    pose(light, [-14, -71, 9, -75, 6, -68, -15, -64]);
    pose(ink, [-18, -93, -7, -105, 17, -105, 29, -97, 22, -79, -13, -79]);
    pose(metal, [-12, -93, -5, -102, 17, -101, 24, -95, 16, -85, -9, -85]);
    pose(light, [4, -96, 23, -95, 21, -90, 6, -90]);
    pose(ink, [13, -77, 34, -76, 43 + striking, -59, 37 + striking, -46, 20 + striking, -46, 17, -58]);
    pose(metal, [20, -74, 33, -70, 39 + striking, -59, 33 + striking, -50, 23 + striking, -51, 21, -62]);
    pose(light, [31 + striking, -62, 40 + striking, -60, 35 + striking, -52, 29 + striking, -54]);
  } else {
    pose(ink, [-17, -75, 17, -78, 25, -63, 12, -39, -18, -39, -23, -60]);
    pose(shade, [-13, -74, 14, -75, 20, -63, 9, -43, -14, -45, -18, -60]);
    pose(metal, [-13, -71, 10, -71, 15, -65, 2, -52, -12, -57]);
    pose(light, [-10, -69, 12, -67, 8, -62, -9, -64]);
    pose(ink, [-15, -87, -4, -101, 15, -100, 25, -89, 15, -73, -12, -75]);
    pose(metal, [-11, -86, -3, -96, 13, -96, 20, -88, 12, -79, -8, -81]);
    pose(light, [0, -89, 18, -88, 15, -82, 4, -83]);
    pose(light, [-7, -96, -14, -112, -11, -114, -2, -96]);
    pose(shade, [13, -68, 23, -65, 28 + striking, -57, 27 + striking, -48, 14 + striking, -47, 11, -59]);
    pose(light, [20 + striking, -55, 27 + striking, -56, 28 + striking, -50, 19 + striking, -49]);
  }

  if (actor.guarding) {
    graphics.fillStyle(light, 0.12).fillCircle(x + 10 * facing, y - 56, 57);
    graphics.lineStyle(2, light, 0.75).strokeCircle(x + 10 * facing, y - 56, 57);
  }
  if (actor.stun > 0) graphics.lineStyle(2, light, 0.55).lineBetween(x - 14, y - 111, x - 5, y - 119);
}

export class ArenaRenderer {
  private background?: Graphics;
  private action?: Graphics;
  private selectedStage: StageId = 'freight';
  private sparks: Spark[] = [];

  constructor(parent: HTMLElement) {
    new Phaser.Game({
      type: Phaser.CANVAS, parent, width, height, transparent: true,
      audio: { noAudio: true }, input: { keyboard: false, mouse: false, touch: false },
      banner: false,
      scene: {
        create: (function (renderer: ArenaRenderer) {
          return function (this: Phaser.Scene) {
            renderer.background = this.add.graphics();
            renderer.action = this.add.graphics();
            paintBackground(renderer.background, renderer.selectedStage);
            this.game.canvas.setAttribute('aria-hidden', 'true');
          };
        })(this),
      },
    });
  }

  stage(stage: StageId, reset = false) {
    if (reset) this.sparks = [];
    if (stage === this.selectedStage) return;
    this.selectedStage = stage;
    this.sparks = [];
    if (this.background) paintBackground(this.background, stage);
  }

  effects(snapshot: Snapshot, events: readonly GameEvent[], now: number) {
    for (const event of events) {
      if (event.type !== 'hit' && event.type !== 'block' && event.type !== 'guard-break') continue;
      const seat = 'target' in event ? event.target : event.seat;
      const { x, y } = snapshot.fighters[seat].position;
      this.sparks.push({ x, y: y - 58, born: now, color: event.type === 'block' ? mint : coral, strength: event.type === 'guard-break' ? 1.6 : 1 });
    }
  }

  draw(
    definition: ReadonlyDeep<MatchDefinition>, snapshot: Snapshot, now: number, debug = false,
    positions: readonly [Readonly<Point>, Readonly<Point>] = [snapshot.fighters[0].position, snapshot.fighters[1].position],
  ) {
    const graphics = this.action;
    if (!graphics) return;
    graphics.clear();
    const boxes = getCombatBoxes(definition, snapshot);
    for (const { kind, box, seat } of boxes) {
      if (kind !== 'projectile') continue;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      graphics.fillStyle(palettes[seat].light, 0.2).fillEllipse(x, y, box.width + 16, box.height + 16);
      polygon(graphics, palettes[seat].light, [x - 13, y, x, y - 10, x + 13, y, x, y + 10]);
      graphics.fillStyle(0xffedd7).fillCircle(x, y, 4);
    }
    for (const seat of [0, 1] as const) {
      const { x, y } = positions[seat];
      paintFighter(graphics, x, y, seat, definition.fighters[seat].id, snapshot.tick, snapshot.fighters[seat]);
    }
    this.sparks = this.sparks.filter(({ born }) => now - born < 220);
    for (const spark of this.sparks) {
      const progress = (now - spark.born) / 220;
      const length = progress * 46 * spark.strength;
      for (let ray = 0; ray < 8; ray++) {
        const angle = ray * Math.PI / 4 + 0.18;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        graphics.lineStyle(2.5, spark.color, (1 - progress) * 0.9)
          .lineBetween(spark.x + dx * length, spark.y + dy * length, spark.x + dx * (length + 10), spark.y + dy * (length + 10));
      }
    }
    if (debug) {
      for (const { kind, box } of boxes) {
        const color = kind === 'hurtbox' ? mint : coral;
        graphics.fillStyle(color, 0.19).fillRect(box.x, box.y, box.width, box.height);
        graphics.lineStyle(1, color, 0.89).strokeRect(box.x, box.y, box.width, box.height);
      }
    }
  }
}
