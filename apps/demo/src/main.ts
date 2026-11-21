import './style.css';
import { createMatch, SNAPSHOT_VERSION, TICK_RATE } from '@ashears/2d-fighter-framework';
import type { GameEvent, MatchDefinition, ReadonlyDeep, Seat, Snapshot } from '@ashears/2d-fighter-framework';
import { fighterIds, moveTips, referenceConfig, roster, ruleIds, stageIds, stageInfo, supportsMatch } from '@ashears/fighter-reference';
import type { FighterId, RuleId, StageId } from '@ashears/fighter-reference';
import { copyInviteLink, createInviteLink, DirectRoomConnection, readInviteLink, supportsDirectRooms } from '@ashears/fighter-direct';
import type { RoomView, ServerMessage } from '@ashears/fighter-relay/protocol';
import { Controls } from './input';
import { OfflineFight, OnlineFight, randomSeed, readReplay, storeReplay } from './session';
import type { LocalMode, Mode, SavedFight, Setup } from './session';
import { ArenaRenderer } from './stage';

function byId<ElementType extends HTMLElement = HTMLElement>(id: string): ElementType {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing interface element ${id}`);
  return element as ElementType;
}

const setupView = byId('setup-view');
const roomsAvailable = supportsDirectRooms();
const activeView = byId('active-view');
const roomView = byId('room-view');
const pairingView = byId('pairing-view');
const pairingCode = byId<HTMLTextAreaElement>('pairing-code');
const replyInput = byId<HTMLTextAreaElement>('reply-input');
const acceptReply = byId<HTMLButtonElement>('accept-reply');
let pairingAttempt = 0;
const resultView = byId('result-view');
const resultHeading = byId('result-heading');
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-mode]')];
const rulesField = byId<HTMLSelectElement>('rules');
const stageField = byId<HTMLSelectElement>('stage');
const fighterOne = byId<HTMLSelectElement>('fighter-one');
const fighterTwo = byId<HTMLSelectElement>('fighter-two');
const startButton = byId<HTMLButtonElement>('start');
const replayButton = byId<HTMLButtonElement>('replay');
const readyButton = byId<HTMLButtonElement>('ready');
const againButton = byId<HTMLButtonElement>('again');
const roomFighter = byId<HTMLSelectElement>('room-fighter');
const sound = byId<HTMLInputElement>('sound');
const touch = byId('touch-controls');
const debugToggle = byId<HTMLButtonElement>('debug-toggle');
const frameData = byId('frame-data');
const hud = byId('hud');
const info = byId('arena-message');

const renderer = new ArenaRenderer(byId('viewport'));
const connection = new DirectRoomConnection({
  id: 'aftershift', fighters: fighterIds, stages: stageIds, rules: ruleIds,
  config: referenceConfig, supports: supportsMatch,
}, onServerMessage, onDisconnect);
const controls = new Controls(touch, () => {
  const neutral = online?.input(0);
  if (neutral) connection.send(neutral);
});

let mode: Mode = 'cpu';
let setup = readSetup();
let currentSnapshot: Snapshot;
let definition: ReadonlyDeep<MatchDefinition>;
let offline: OfflineFight | undefined;
let online: OnlineFight | undefined;
let room: RoomView | undefined;
let seat: Seat = 0;
let debug = false;
let lastReplay = readReplay();
let privateResult = false;
let audio: AudioContext | undefined;
let capturePointer = matchMedia('(any-pointer: coarse)').matches;
let clock = performance.now();
let accumulator = 0;

function readSetup(): Setup {
  return {
    stage: stageField.value as StageId, rule: rulesField.value as RuleId,
    fighters: [fighterOne.value as FighterId, fighterTwo.value as FighterId],
    seed: randomSeed(),
  };
}

function showView(view: 'setup' | 'active' | 'pairing' | 'room' | 'result') {
  setupView.hidden = view !== 'setup';
  activeView.hidden = view !== 'active';
  roomView.hidden = view !== 'room';
  pairingView.hidden = view !== 'pairing';
  resultView.hidden = view !== 'result';
}

function setStatus(status: string) {
  byId('status').textContent = status;
}

function updateMode() {
  for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  byId('fighter-fields').hidden = mode === 'online';
  byId('join-form').hidden = mode !== 'online' || !roomsAvailable;
  startButton.hidden = mode === 'online' && !roomsAvailable;
  byId('setup-moves').hidden = mode === 'online';
  byId('opponent-label').textContent = mode === 'local' ? 'Player two' : mode === 'training' ? 'Training dummy' : 'CPU fighter';
  startButton.replaceChildren(document.createTextNode(
    mode === 'online' ? 'Copy invite link' : mode === 'training' ? 'Start training' : 'Start fight',
  ));
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '↗';
  startButton.append(arrow);
  const hints: Record<Mode, string> = {
    cpu: 'Fight a CPU opponent. Touch controls are available on mobile.',
    local: 'Two fighters, one keyboard.',
    training: 'The dummy starts in jab range. Try F, G, and H to see each move land.',
    online: roomsAvailable ? 'Play directly with a friend. Use the same Wi-Fi for the best chance of connecting.' : 'This browser does not support direct rooms.',
  };
  byId('setup-hint').textContent = hints[mode];
  replayButton.disabled = !lastReplay;
}

function drawMoves(container: HTMLElement, fighter: FighterId) {
  container.replaceChildren(...(['light', 'heavy', 'special'] as const).flatMap((slot, index) => {
    const binding = document.createElement('dt');
    const key = document.createElement('kbd');
    key.textContent = ['F', 'G', 'H'][index];
    binding.append(key);
    const detail = document.createElement('dd');
    const name = document.createElement('strong');
    name.textContent = roster[fighter].moves[slot].name;
    const tip = document.createElement('span');
    tip.textContent = moveTips[fighter][slot];
    detail.append(name, tip);
    return [binding, detail];
  }));
}

function drawPreview() {
  setup = readSetup();
  drawMoves(byId('setup-moves'), setup.fighters[0]);
  const config = referenceConfig(setup.fighters, setup.stage, setup.rule, setup.seed);
  const preview = createMatch(config.definition, config.rules);
  definition = preview.definition;
  currentSnapshot = preview.snapshot();
  renderer.stage(setup.stage, true);
  byId('stage-name').textContent = stageInfo[setup.stage].name;
  byId('session-label').textContent = 'Preview';
  hud.hidden = true;
  info.hidden = true;
}

function clearFight() {
  offline = undefined;
  online = undefined;
  controls.active = false;
  controls.local = false;
  controls.release();
  debug = false;
  info.hidden = true;
  frameData.hidden = true;
  touch.hidden = true;
  byId('match-tools').hidden = true;
  debugToggle.hidden = true;
  debugToggle.setAttribute('aria-pressed', 'false');
  debugToggle.textContent = 'Show hitboxes';
}

function backToSetup(exitRoom = false) {
  if (exitRoom) {
    connection.send({ type: 'leave' });
    connection.close();
    room = undefined;
  }
  clearFight();
  privateResult = false;
  showView('setup');
  updateMode();
  drawPreview();
}

function startLocal(selection: Setup, localMode: LocalMode | 'replay', saved?: SavedFight) {
  clearFight();
  if (room) {
    connection.send({ type: 'leave' });
    room = undefined;
  }
  connection.close();
  setStatus('');
  offline = new OfflineFight(selection, localMode, saved?.recording);
  startFight(selection, offline.match.definition, offline.match.snapshot(), localMode);
}

function enableSound() {
  if (!sound.checked || !window.AudioContext) return;
  audio ??= new AudioContext();
  if (audio.state === 'suspended') void audio.resume().catch(() => {});
}

function startFight(
  selection: Setup, matchDefinition: ReadonlyDeep<MatchDefinition>, snapshot: Snapshot,
  matchMode: LocalMode | 'replay' | 'online',
) {
  enableSound();
  setup = selection;
  definition = matchDefinition;
  currentSnapshot = snapshot;
  accumulator = 0;
  clock = performance.now();
  controls.active = matchMode !== 'replay';
  controls.local = matchMode === 'local';
  const labels = { cpu: 'CPU fight', local: 'Local versus', training: 'Training', replay: 'Replay', online: `Online · P${seat + 1}` };
  byId('stage-name').textContent = stageInfo[selection.stage].name;
  byId('session-label').textContent = labels[matchMode];
  byId('match-tools').hidden = false;
  touch.hidden = !capturePointer || !controls.active || controls.local;
  debugToggle.hidden = matchMode !== 'training';
  frameData.hidden = matchMode !== 'training';
  renderer.stage(selection.stage, true);
  buildHud();
  hud.hidden = false;
  if (matchMode === 'online') {
    showView('room');
    updateRoom();
    setStatus('Fight in progress.');
  } else {
    showView('active');
    byId('active-heading').textContent = labels[matchMode];
    byId('active-matchup').textContent = `${definition.fighters[0].name} vs. ${definition.fighters[1].name}`;
    drawMoves(byId('move-guide'), selection.fighters[0]);
    byId('move-guide').hidden = matchMode === 'replay';
    setStatus(matchMode === 'replay' ? 'Replaying the recorded inputs.' : 'Fight in progress.');
  }
  byId('stop').focus({ preventScroll: true });
  if (capturePointer) byId('arena').scrollIntoView({ block: 'start' });
}

function stopFight() {
  backToSetup(!!room);
  setStatus('');
  startButton.focus({ preventScroll: true });
}

function finish(snapshot: Snapshot) {
  if (offline?.mode === 'training') {
    const showBoxes = debug;
    startLocal({ ...setup, seed: randomSeed() }, 'training');
    setDebug(showBoxes);
    return;
  }
  const viewingReplay = offline?.mode === 'replay';
  if (offline && !viewingReplay) save({ setup, recording: offline.recording() });
  privateResult = !!online;
  controls.active = false;
  controls.release();
  touch.hidden = true;
  byId('match-tools').hidden = true;
  const winner = snapshot.winner;
  const mirrorMatch = definition.fighters[0].id === definition.fighters[1].id;
  resultHeading.textContent = winner === 'draw' || winner === null
    ? 'Draw' : `${definition.fighters[winner].name}${mirrorMatch ? ` (P${winner + 1})` : ''} wins`;
  byId('result-detail').textContent = setup.rule === 'health'
    ? `Rounds ${snapshot.roundWins[0]}–${snapshot.roundWins[1]} at ${stageInfo[setup.stage].name}.`
    : `Stocks remaining ${snapshot.fighters[0].stocks}–${snapshot.fighters[1].stocks}.`;
  againButton.textContent = viewingReplay ? 'Replay again' : 'Rematch';
  againButton.disabled = false;
  byId('result-back').textContent = privateResult ? 'Leave room' : 'Back to setup';
  byId('session-label').textContent = viewingReplay ? 'Replay complete' : 'Match complete';
  showView('result');
  info.hidden = true;
  setStatus('');
  resultHeading.focus({ preventScroll: true });
}

function save(fight: SavedFight) {
  lastReplay = fight;
  storeReplay(fight);
}

function validRoom(candidate: RoomView): candidate is RoomView & { stage: StageId; rule: RuleId } {
  return stageIds.includes(candidate.stage as StageId) && ruleIds.includes(candidate.rule as RuleId);
}

function updateRoom() {
  if (!room) return;
  byId('room-description').textContent = room.status === 'playing'
    ? `${stageInfo[room.stage as StageId].name} · You are player ${seat + 1}.`
    : `Connected directly. You are player ${seat + 1}.`;
  const players = byId('room-players');
  players.replaceChildren(...room.players.map((player, index) => {
    const item = document.createElement('li');
    const suffix = index === seat ? ' (you)' : '';
    const name = player?.fighter && roster[player.fighter as FighterId]?.name;
    item.textContent = player ? `Player ${index + 1}${suffix} · ${name || 'Picking'}${player.ready ? ' · Ready' : ''}` : 'Waiting for a guest';
    return item;
  }));
  const own = room.players[seat];
  roomFighter.value = own?.fighter ?? '';
  roomFighter.disabled = room.status !== 'waiting';
  readyButton.disabled = room.status !== 'waiting' || !own?.fighter;
  readyButton.textContent = own?.ready ? 'Cancel ready' : 'Ready';
}

function onDisconnect(detail: string) {
  room = undefined;
  backToSetup();
  setStatus(detail);
}

function onServerMessage(message: ServerMessage) {
  switch (message.type) {
    case 'room': {
      if (!validRoom(message.room)) return;
      const firstView = !room;
      room = message.room;
      seat = message.seat;
      if (room.status === 'waiting') {
        showView('room');
        updateRoom();
        setStatus('');
        if (firstView) {
          pairingCode.value = '';
          replyInput.value = '';
          roomFighter.focus({ preventScroll: true });
        }
      } else if (room.status === 'finished' && room.players[seat]?.rematch) {
        againButton.disabled = true;
        setStatus('Waiting for the other player to rematch.');
      }
      break;
    }
    case 'start': {
      if (!validRoom(message.room)) return;
      const fighters = message.room.players.map((player) => player?.fighter) as [FighterId, FighterId];
      if (!fighters.every((fighter) => fighterIds.includes(fighter))) return;
      clearFight();
      room = message.room;
      const selection: Setup = { fighters, stage: message.room.stage, rule: message.room.rule, seed: message.seed };
      const config = referenceConfig(fighters, selection.stage, selection.rule, selection.seed);
      if (message.snapshot.version !== SNAPSHOT_VERSION
        || createMatch(config.definition, config.rules).snapshot().configuration !== message.snapshot.configuration) {
        connection.close();
        onDisconnect('The players loaded different game versions. Reload both pages.');
        return;
      }
      online = new OnlineFight(selection, message.match, message.snapshot);
      startFight(selection, config.definition, message.snapshot, 'online');
      break;
    }
    case 'snapshot':
      if (online?.number !== message.match) return;
      online.receive(message.snapshot, message.events, performance.now());
      if (message.snapshot.phase === 'finished' && message.recording) save({ setup, recording: message.recording });
      break;
    case 'ended':
      connection.close();
      onDisconnect(message.reason === 'opponent-left' ? 'Your opponent left the room.'
        : message.reason === 'expired' ? 'The private room expired.'
        : message.reason === 'server-error' ? 'The browsers could not continue this room.'
        : 'You left the room.');
      break;
    case 'error':
      setStatus(message.message);
      break;
  }
}

function buildHud() {
  hud.innerHTML = `<div class="hud-side"><div class="hud-line"><span class="hud-badge"></span><span class="hud-value"></span></div>
    <div class="bar"><span class="fill"></span></div><div class="guard-bar"><span class="fill"></span></div></div>
    <div class="clock"></div>
    <div class="hud-side"><div class="hud-line"><span class="hud-badge"></span><span class="hud-value"></span></div>
    <div class="bar"><span class="fill"></span></div><div class="guard-bar"><span class="fill"></span></div></div>`;
  for (const [index, label] of [...hud.querySelectorAll('.hud-badge')].entries()) label.textContent = definition.fighters[index].name;
  updateHud(currentSnapshot);
}

function updateHud(snapshot: Snapshot) {
  const stock = setup.rule === 'stock';
  const seconds = Math.max(0, Math.ceil((definition.timeLimit - snapshot.roundTick) / TICK_RATE));
  hud.querySelector('.clock')!.textContent = offline?.mode === 'training'
    ? '∞' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  for (const [index, side] of [...hud.querySelectorAll('.hud-side')].entries()) {
    const actor = snapshot.fighters[index];
    const fighter = definition.fighters[index];
    const text = stock ? `${Math.round(actor.damage)}% · ${actor.stocks} ◆` : `${Math.ceil(actor.health)} HP · ${snapshot.roundWins[index]}`;
    side.querySelector('.hud-value')!.textContent = text;
    const [bar, guard] = side.querySelectorAll<HTMLElement>('.fill');
    bar.style.width = `${stock ? actor.stocks / 3 * 100 : actor.health / fighter.maxHealth * 100}%`;
    guard.style.width = `${fighter.maxGuard ? actor.guard / fighter.maxGuard * 100 : 0}%`;
  }
  if (!frameData.hidden) {
    frameData.textContent = snapshot.fighters.map((actor, index) => {
      const fighter = definition.fighters[index];
      if (!actor.move) return `${fighter.name} · ${actor.stun ? `stun ${actor.stun}f` : 'neutral'}`;
      const move = fighter.moves[actor.move.slot];
      const frame = actor.move.frame;
      const phase = frame < move.startup ? 'startup' : frame < move.startup + move.active ? 'active' : 'recovery';
      return `${fighter.name} · ${move.name}, ${phase} ${frame + 1}/${move.startup + move.active + move.recovery}f`;
    }).join('   /   ');
  }
}

function react(snapshot: Snapshot, events: readonly GameEvent[], now: number) {
  renderer.effects(snapshot, events, now);
  for (const event of events) {
    if (event.type === 'round-end' && snapshot.phase !== 'finished') {
      info.textContent = event.winner === 'draw' ? 'Round drawn' : `${definition.fighters[event.winner].name} takes the round`;
      info.hidden = false;
    } else if (event.type === 'round-start') info.hidden = true;
    if (!sound.checked || !audio || !['attack', 'hit', 'stock-lost', 'block'].includes(event.type)) continue;
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    const at = audio.currentTime;
    const impact = event.type === 'hit';
    const duration = impact ? .16 : .09;
    const frequency = event.type === 'block' ? 560 : event.type === 'stock-lost' ? 118 : impact ? 145 : 260;
    oscillator.type = impact ? 'triangle' : event.type === 'block' ? 'square' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(impact ? 43 : frequency / 2.5, at + duration);
    volume.gain.setValueAtTime(impact ? .20 : .045, at);
    volume.gain.exponentialRampToValueAtTime(.001, at + duration);
    oscillator.connect(volume).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + duration);
  }
}

function render(now: number) {
  const stepTime = 1000 / TICK_RATE;
  accumulator = Math.min(accumulator + now - clock, stepTime * 5);
  clock = now;
  while (accumulator >= stepTime) {
    accumulator -= stepTime;
    if (offline && currentSnapshot.phase !== 'finished') {
      const outcome = offline.tick(controls);
      if (!outcome) {
        backToSetup();
        setStatus('The recording ended before a match result.');
        break;
      }
      currentSnapshot = outcome.snapshot;
      react(currentSnapshot, outcome.events, now);
      updateHud(currentSnapshot);
      if (currentSnapshot.phase === 'finished') finish(currentSnapshot);
    } else if (online && controls.active) {
      const input = online.input(controls.next(0));
      if (input) connection.send(input);
    }
  }
  if (online && currentSnapshot.phase !== 'finished') {
    const display = online.sample(now);
    currentSnapshot = display.snapshot;
    react(currentSnapshot, display.events, now);
    updateHud(currentSnapshot);
    renderer.draw(definition, currentSnapshot, now, false, display.positions);
    if (currentSnapshot.phase === 'finished') finish(currentSnapshot);
  } else {
    renderer.draw(definition, currentSnapshot, now, debug);
  }
  requestAnimationFrame(render);
}

for (const button of modeButtons) {
  if (button.dataset.mode === 'online' && !roomsAvailable) button.disabled = true;
  button.addEventListener('click', () => {
    mode = button.dataset.mode as Mode;
    if (mode !== 'online' && !room) connection.close();
    setStatus('');
    updateMode();
  });
}

for (const select of [fighterOne, fighterTwo]) select.addEventListener('change', drawPreview);
rulesField.addEventListener('change', () => {
  stageField.value = rulesField.value === 'stock' ? 'overpass' : 'freight';
  drawPreview();
});
stageField.addEventListener('change', () => {
  if (stageField.value === 'freight' && rulesField.value === 'stock') rulesField.value = 'health';
  drawPreview();
});

async function startPairing(kind: 'invite' | 'reply', createCode: () => Promise<string>) {
  const attempt = ++pairingAttempt;
  showView('pairing');
  byId('pairing-heading').focus({ preventScroll: true });
  byId('pairing-hint').textContent = '';
  byId('pairing-share').hidden = true;
  byId('reply-form').hidden = true;
  pairingCode.value = '';
  replyInput.value = '';
  acceptReply.disabled = false;
  setStatus('Preparing a direct connection…');
  try {
    const code = await createCode();
    if (attempt !== pairingAttempt || pairingView.hidden) return;
    const share = kind === 'invite' ? createInviteLink(location.href, code) : code;
    pairingCode.value = share;
    byId('pairing-code-label').textContent = kind === 'invite' ? 'Invite link' : 'Reply code';
    byId('copy-code').textContent = kind === 'invite' ? 'Copy invite link' : 'Copy reply code';
    byId('pairing-hint').textContent = kind === 'invite'
      ? 'Send the link to your friend and keep this tab open. Paste their reply here to connect.'
      : 'Send your reply code to the host. Keep this tab open while they connect.';
    byId('pairing-share').hidden = false;
    byId('reply-form').hidden = kind !== 'invite';
    setStatus('');
    return share;
  } catch (error) {
    if (attempt !== pairingAttempt || pairingView.hidden) return;
    backToSetup();
    setStatus(error instanceof Error ? error.message : 'Could not prepare a direct connection.');
  }
}

byId('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const selection = readSetup();
  if (mode === 'online') {
    const link = startPairing('invite', () => connection.invite(selection.stage, selection.rule));
    const attempt = pairingAttempt;
    void Promise.all([link, copyInviteLink(link)]).then(([value, copied]) => {
      if (value && attempt === pairingAttempt && !pairingView.hidden) {
        setStatus(copied ? 'Invite link copied.' : 'Use Copy invite link to share your room.');
      }
    });
  } else startLocal(selection, mode);
});
byId('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const invite = byId<HTMLTextAreaElement>('invite-input').value;
  void startPairing('reply', () => connection.reply(invite));
});
byId('reply-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  acceptReply.disabled = true;
  try {
    await connection.accept(replyInput.value);
    if (!pairingView.hidden) setStatus('Connecting to your friend…');
  } catch (error) {
    if (pairingView.hidden) return;
    acceptReply.disabled = false;
    setStatus(error instanceof Error ? error.message : 'Could not accept the reply.');
  }
});
byId('cancel-pairing').addEventListener('click', () => {
  pairingAttempt++;
  connection.close();
  stopFight();
});
roomFighter.addEventListener('change', () => {
  if (roomFighter.value) connection.send({ type: 'select', fighter: roomFighter.value });
});
readyButton.addEventListener('click', () => connection.send({ type: 'ready', ready: !room?.players[seat]?.ready }));
for (const button of document.querySelectorAll('[data-leave-room]')) button.addEventListener('click', stopFight);
byId('copy-code').addEventListener('click', async () => {
  const value = pairingCode.value;
  const label = byId('pairing-code-label').textContent;
  try {
    await navigator.clipboard.writeText(value);
    if (!pairingView.hidden && pairingCode.value === value) setStatus(`${label} copied.`);
  } catch {
    if (pairingView.hidden || pairingCode.value !== value) return;
    pairingCode.focus();
    pairingCode.select();
    setStatus('Copy the selected text and send it to your friend.');
  }
});
byId('stop').addEventListener('click', stopFight);
byId('result-back').addEventListener('click', stopFight);
replayButton.addEventListener('click', () => { if (lastReplay) startLocal(lastReplay.setup, 'replay', lastReplay); });
againButton.addEventListener('click', () => {
  if (privateResult && online) {
    const match = online.number;
    againButton.disabled = true;
    setStatus('Waiting for the other player to rematch.');
    connection.send({ type: 'rematch', match });
  } else if (offline?.mode === 'replay' && lastReplay) {
    startLocal(lastReplay.setup, 'replay', lastReplay);
  } else if (offline && offline.mode !== 'replay') {
    startLocal({ ...setup, seed: randomSeed() }, offline.mode);
  }
});
function setDebug(visible: boolean) {
  debug = visible;
  debugToggle.setAttribute('aria-pressed', String(debug));
  debugToggle.textContent = debug ? 'Hide hitboxes' : 'Show hitboxes';
}

debugToggle.addEventListener('click', () => setDebug(!debug));
sound.addEventListener('change', enableSound);
matchMedia('(any-pointer: coarse)').addEventListener('change', (event) => {
  capturePointer = event.matches;
  touch.hidden = !capturePointer || !controls.active || controls.local;
});
window.addEventListener('pagehide', () => connection.close());

updateMode();
drawPreview();
const linkedInvite = readInviteLink(location.href);
if (linkedInvite !== null) {
  const page = new URL(location.href);
  page.hash = '';
  history.replaceState(history.state, '', page);
  if (roomsAvailable) {
    mode = 'online';
    updateMode();
    void startPairing('reply', () => connection.reply(linkedInvite));
  }
}
requestAnimationFrame(render);
