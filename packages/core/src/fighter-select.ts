export interface FighterSelectEntry<Id extends string> {
  id: Id;
  name: string;
  detail?: string;
}

export interface FighterSelectSeat<Id extends string> {
  id: string;
  label: string;
  badge: string;
  fighter?: Id;
  editable?: boolean;
}

export interface FighterSelectOptions<Id extends string> {
  fighters: readonly FighterSelectEntry<Id>[];
  renderPortrait: (element: HTMLElement, fighter: Id) => void;
  onPick: (seat: string, fighter: Id) => void;
}

/** A browser roster picker. The caller owns selection, availability, and match readiness. */
export function createFighterSelect<Id extends string>(root: HTMLElement, options: FighterSelectOptions<Id>) {
  const { fighters, renderPortrait, onPick } = options;
  const document = root.ownerDocument;
  const entries = new Map(fighters.map((fighter) => [fighter.id, fighter]));
  const seatRow = document.createElement('div');
  const grid = document.createElement('div');
  const prompt = document.createElement('p');
  root.classList.add('fighter-select');
  grid.className = 'fighter-select-grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Fighter roster');
  seatRow.className = 'fighter-select-seats';
  seatRow.setAttribute('role', 'group');
  seatRow.setAttribute('aria-label', 'Fighter assignments');
  prompt.className = 'fighter-select-prompt';
  root.replaceChildren(seatRow, prompt, grid);

  let seats: readonly FighterSelectSeat<Id>[] = [];
  let active: string | undefined;
  let seatCards = new Map<string, HTMLElement>();
  let seatKey = '';

  function portrait(id: Id, className: string) {
    const element = document.createElement('span');
    element.className = className;
    element.setAttribute('aria-hidden', 'true');
    renderPortrait(element, id);
    return element;
  }

  const tiles = fighters.map(({ id, name, detail }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fighter-select-tile';
    button.dataset.pick = id;
    button.setAttribute('aria-label', name);
    const label = document.createElement('span');
    label.className = 'fighter-select-name';
    label.textContent = name;
    const meta = document.createElement('span');
    meta.className = 'fighter-select-detail';
    meta.textContent = detail ?? '';
    const badges = document.createElement('span');
    badges.className = 'fighter-select-badges';
    badges.setAttribute('aria-hidden', 'true');
    button.append(portrait(id, 'fighter-select-art'), label);
    if (detail) button.append(meta);
    button.append(badges);
    button.addEventListener('click', () => {
      if (active !== undefined) onPick(active, id);
    });
    grid.append(button);
    return { id, button, badges };
  });

  function refreshSelection() {
    const seat = seats.find(({ id }) => id === active);
    prompt.textContent = !seat ? 'Fighter selection is closed'
      : seatCards.get(seat.id)?.matches('button') ? `Pick for ${seat.label}` : 'Pick a fighter';
    for (const [id, card] of seatCards) {
      if (card.tagName === 'BUTTON') card.setAttribute('aria-pressed', String(id === active));
    }
    for (const { id, button, badges } of tiles) {
      button.setAttribute('aria-pressed', String(seat?.fighter === id));
      const state = button.dataset.locked === 'true' ? 'Locked'
        : seats.filter(({ fighter }) => fighter === id).map(({ badge }) => badge).join(' · ');
      if (badges.textContent !== state) badges.textContent = state;
    }
  }

  function update(nextSeats: readonly FighterSelectSeat<Id>[], locked: readonly Id[] = []) {
    seats = nextSeats;
    const editable = seats.filter((seat) => seat.editable !== false);
    if (!editable.some(({ id }) => id === active)) active = editable[0]?.id;
    const key = JSON.stringify(seats);
    if (key !== seatKey) {
      seatKey = key;
      const focused = document.activeElement;
      const focusedSeat = [...seatCards].find(([, card]) => card === focused)?.[0];
      seatCards = new Map(seats.map((seat) => {
        const canSwitch = editable.length > 1 && seat.editable !== false;
        const card = document.createElement(canSwitch ? 'button' : 'div');
        card.className = 'fighter-select-seat';
        card.dataset.seat = seat.id;
        const fighter = seat.fighter === undefined ? undefined : entries.get(seat.fighter);
        const tag = document.createElement('span');
        tag.className = 'fighter-select-seat-label';
        tag.textContent = seat.label;
        const name = document.createElement('strong');
        name.textContent = fighter?.name ?? 'Choose a fighter';
        if (fighter) card.append(portrait(fighter.id, 'fighter-select-seat-art'));
        card.append(tag, name);
        if (canSwitch) {
          (card as HTMLButtonElement).type = 'button';
          card.setAttribute('aria-label', seat.label);
          card.title = name.textContent;
          card.addEventListener('click', () => {
            active = seat.id;
            refreshSelection();
          });
        }
        return [seat.id, card];
      }));
      seatRow.replaceChildren(...seatCards.values());
      if (focusedSeat) seatCards.get(focusedSeat)?.focus({ preventScroll: true });
    }
    const unavailable = new Set(locked);
    for (const { id, button } of tiles) {
      button.dataset.locked = String(unavailable.has(id));
      button.disabled = active === undefined || unavailable.has(id);
    }
    refreshSelection();
  }

  grid.addEventListener('keydown', (event) => {
    const index = tiles.findIndex(({ button }) => button === event.target);
    if (index < 0) return;
    const columns = document.defaultView?.getComputedStyle(grid).gridTemplateColumns.split(' ').length ?? 1;
    const offsets = new Map([['ArrowLeft', -1], ['ArrowRight', 1], ['ArrowUp', -columns], ['ArrowDown', columns]]);
    const offset = offsets.get(event.key);
    if (offset === undefined) return;
    event.preventDefault();
    for (let target = index + offset; target >= 0 && target < tiles.length; target += offset) {
      if (!tiles[target].button.disabled) {
        tiles[target].button.focus();
        return;
      }
    }
  });

  return {
    update,
    focus() {
      (tiles.find(({ button }) => button.getAttribute('aria-pressed') === 'true' && !button.disabled)
        ?? tiles.find(({ button }) => !button.disabled))?.button.focus({ preventScroll: true });
    },
  };
}
