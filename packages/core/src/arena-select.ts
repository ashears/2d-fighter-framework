interface ArenaOption<Id extends string> {
  id: Id;
  name: string;
  description: string;
  image?: string;
  surfaces: readonly { x: number; y: number; width: number }[];
}

export function createArenaSelect<Id extends string>(
  container: HTMLElement,
  options: readonly ArenaOption<Id>[],
  initial: Id,
  viewport: { width: number; height: number },
  onSelect: (id: Id) => void,
) {
  let selected = initial;
  let hovered: Id | undefined;
  let focused: Id | undefined;

  const preview = document.createElement('div');
  const details = document.createElement('div');
  const name = document.createElement('strong');
  const description = document.createElement('p');
  const grid = document.createElement('div');
  preview.className = 'arena-select-preview';
  details.className = 'arena-select-details';
  grid.className = 'arena-select-grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Arena');
  details.append(name, description);

  function art(option: ArenaOption<Id>) {
    const scene = document.createElement('span');
    scene.className = 'arena-select-art';
    scene.dataset.arena = option.id;
    scene.setAttribute('aria-hidden', 'true');
    if (option.image) scene.style.backgroundImage = `url("${option.image}")`;
    for (const surface of option.surfaces) {
      const platform = document.createElement('span');
      platform.style.left = `${surface.x / viewport.width * 100}%`;
      platform.style.top = `${surface.y / viewport.height * 100}%`;
      platform.style.width = `${surface.width / viewport.width * 100}%`;
      scene.append(platform);
    }
    return scene;
  }

  const previews = new Map(options.map((option) => [option.id, art(option)]));
  const buttons = options.map((option) => {
    const button = document.createElement('button');
    const caption = document.createElement('span');
    button.type = 'button';
    caption.className = 'arena-select-caption';
    caption.textContent = option.name;
    button.append(art(option), caption);
    button.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      hovered = option.id;
      render();
    });
    button.addEventListener('pointerleave', () => {
      hovered = undefined;
      render();
    });
    button.addEventListener('focus', () => {
      hovered = undefined;
      focused = option.id;
      render();
    });
    button.addEventListener('blur', () => {
      focused = undefined;
      render();
    });
    button.addEventListener('click', () => {
      setValue(option.id);
      onSelect(option.id);
    });
    return button;
  });

  function render() {
    const option = options.find(({ id }) => id === (hovered ?? focused ?? selected))!;
    const scene = previews.get(option.id)!;
    if (preview.firstElementChild !== scene) preview.replaceChildren(scene, details);
    name.textContent = option.name;
    description.textContent = option.description;
    buttons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(options[index].id === selected));
    });
  }

  function setValue(id: Id) {
    selected = id;
    focused = undefined;
    hovered = undefined;
    render();
  }

  grid.append(...buttons);
  container.classList.add('arena-select');
  container.replaceChildren(preview, grid);
  render();
  return { get value() { return selected; }, setValue };
}
