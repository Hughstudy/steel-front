import { catalog, hasProducer, missingPrerequisites, ownedTypes } from '../sim/production.ts';
import type { QueueItem } from '../sim/production.ts';
import type { World } from '../sim/world.ts';

export interface ProductionHost {
  world(): World;
  player(): number;
  /** Left click / digit: queue the item, or start placement when a structure is ready. */
  activate(type: string): void;
  /** Right click / Shift+digit: cancel the most recent item of the type. */
  cancel(type: string): void;
  /** Return keyboard focus to the battlefield. */
  battlefield(): void;
}

const REASON_TEXT: Record<string, string> = {
  funds: 'ON HOLD · FUNDS',
  'low-power': 'LOW POWER',
  prerequisite: 'MISSING PREREQ',
  'no-producer': 'NO PRODUCER',
  'exit-blocked': 'EXIT BLOCKED',
  ready: 'READY',
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing HUD element: ${id}`);
  return found as T;
}

interface Card { button: HTMLButtonElement; bar: HTMLElement; count: HTMLElement; state: HTMLElement }

/**
 * RA2-style build tabs. A keyboard-focused panel is its own input context
 * (`data-input-context="production"`): Q/W/E/R pick tabs and digits build, while
 * the battlefield handlers ignore those keys, so W never both pans and builds.
 */
export class ProductionPanel {
  private readonly root = element<HTMLElement>('production-panel');
  private readonly tabs = element<HTMLElement>('production-tabs');
  private readonly grid = element<HTMLElement>('production-items');
  private readonly notice = element<HTMLElement>('production-notice');
  private readonly host: ProductionHost;
  private active = '';
  private layoutKey = '';
  private cards = new Map<string, Card>();
  private noticeTick = -1;

  constructor(host: ProductionHost) {
    this.host = host;
    this.root.addEventListener('keydown', this.key);
    this.tabs.addEventListener('click', event => {
      const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-category]');
      if (tab?.dataset.category) this.select(tab.dataset.category);
    });
    this.grid.addEventListener('click', event => {
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-type]');
      if (card?.dataset.type && !card.disabled) this.host.activate(card.dataset.type);
    });
    this.grid.addEventListener('contextmenu', event => {
      event.preventDefault();
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-type]');
      if (card?.dataset.type) this.host.cancel(card.dataset.type);
    });
  }

  select(category: string): void {
    this.active = category;
    this.layoutKey = '';
  }

  private key = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const world = this.host.world();
    const category = world.rules.production.categories.find(c => c.hotkey === event.code);
    if (category) {
      event.preventDefault();
      this.select(category.id);
      return;
    }
    const digit = /^Digit([1-9])$/.exec(event.code);
    if (digit) {
      event.preventDefault();
      const card = this.grid.querySelectorAll<HTMLButtonElement>('button[data-type]')[Number(digit[1]) - 1];
      if (!card?.dataset.type) return;
      if (event.shiftKey) this.host.cancel(card.dataset.type);
      else if (!card.disabled) this.host.activate(card.dataset.type);
      return;
    }
    if (event.code === 'Escape') {
      event.preventDefault();
      this.host.battlefield();
    }
  };

  update(): void {
    const world = this.host.world();
    const player = this.host.player();
    const state = world.players[player];
    if (!state) return;
    const categories = world.rules.production.categories;
    if (!categories.some(c => c.id === this.active)) this.active = categories[0].id;
    const owned = ownedTypes(world, player);
    const items = catalog(world, player, this.active);
    const queue = state.queues[this.active] ?? [];
    // Rebuild DOM only when the tab, catalog or availability changes.
    const locks = items.map(def => {
      const missing = missingPrerequisites(world, player, def.id, owned);
      return missing.length ? missing.map(id => (world.rules.buildings.get(id) ?? world.rules.units.get(id))?.name ?? id).join(', ') : '';
    });
    const producer = hasProducer(world, player, this.active);
    const key = `${this.active}|${state.faction}|${producer}|${locks.join(';')}`;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.tabs.replaceChildren(...categories.map(category => {
        const tab = document.createElement('button');
        tab.dataset.category = category.id;
        tab.className = 'production-tab';
        tab.setAttribute('aria-pressed', String(category.id === this.active));
        tab.innerHTML = `<kbd>${category.hotkey.replace('Key', '')}</kbd>${category.name.toUpperCase()}<i></i>`;
        return tab;
      }));
      this.cards.clear();
      this.grid.replaceChildren(...items.map((def, index) => {
        const button = document.createElement('button');
        button.dataset.type = def.id;
        button.className = 'production-card';
        const lock = !producer ? 'Requires a producer' : locks[index] ? `Requires ${locks[index]}` : '';
        button.disabled = lock !== '';
        button.title = `${def.name} — $${def.cost}${lock ? ` · ${lock}` : ''}\nClick: build · Right-click: cancel`;
        button.innerHTML = `<span class="card-index">${index + 1}</span><b>${def.name}</b><span class="card-cost">$${def.cost}</span><span class="card-state">${lock ? 'LOCKED' : ''}</span><span class="card-count"></span><i class="card-bar"></i>`;
        this.cards.set(def.id, {
          button,
          bar: button.querySelector('.card-bar')!,
          count: button.querySelector('.card-count')!,
          state: button.querySelector('.card-state')!,
        });
        return button;
      }));
      if (items.length === 0) this.grid.textContent = 'Nothing to build here yet.';
    }
    // Per-frame values: queue counts, progress and pause reasons.
    const counts = new Map<string, number>();
    for (const item of queue) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    const head: QueueItem | undefined = queue[0];
    for (const [type, card] of this.cards) {
      const n = counts.get(type) ?? 0;
      card.count.textContent = n > 1 ? `×${n}` : '';
      const working = head?.type === type;
      card.bar.style.width = working ? `${Math.round(100 * head.work / head.total)}%` : '0%';
      card.button.classList.toggle('is-ready', working && head.reason === 'ready');
      card.button.classList.toggle('is-queued', n > 0);
      if (!card.button.disabled) card.state.textContent = working ? (REASON_TEXT[head.reason] ?? `${Math.round(100 * head.work / head.total)}%`) : n > 0 ? 'QUEUED' : '';
    }
    for (const tab of this.tabs.children) {
      const category = (tab as HTMLElement).dataset.category!;
      const first = state.queues[category]?.[0];
      tab.classList.toggle('is-busy', first !== undefined && first.reason !== 'ready');
      tab.classList.toggle('is-ready', first?.reason === 'ready');
    }
    if (state.noticeTick !== this.noticeTick) {
      this.noticeTick = state.noticeTick;
      this.notice.textContent = state.notice ? state.notice.toUpperCase() : '';
    }
    if (state.notice && world.tick - state.noticeTick > world.rules.game.ticksPerSecond * 4 && this.notice.textContent) this.notice.textContent = '';
  }
}
