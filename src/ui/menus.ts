import type { Rules } from '../sim/rules.ts';
import type { MatchSetup } from '../sim/skirmish.ts';
import type { World } from '../sim/world.ts';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing menu element: ${id}`);
  return found as T;
}

/**
 * Modal menus as a stack of native <dialog>s. Opening one hides the previous;
 * Back/Escape returns to it; closing the last one calls `onEmpty` (resume play).
 * Gameplay input already ignores keys while any dialog is open.
 */
export class DialogStack {
  private readonly stack: HTMLDialogElement[] = [];
  onEmpty: () => void = () => {};
  /** Dialogs Escape must not close (main menu, results). */
  readonly sticky = new Set<HTMLDialogElement>();

  manage(dialog: HTMLDialogElement): void {
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      if (!this.sticky.has(dialog)) this.back();
    });
    // Closed by its own buttons (e.g. the field guide): treat as Back.
    dialog.addEventListener('close', () => { if (this.top() === dialog) this.pop(); });
    for (const button of dialog.querySelectorAll('[data-back]')) button.addEventListener('click', () => this.back());
  }

  top(): HTMLDialogElement | null { return this.stack[this.stack.length - 1] ?? null; }
  get size(): number { return this.stack.length; }

  open(dialog: HTMLDialogElement): void {
    const previous = this.top();
    this.stack.push(dialog);
    if (previous?.open) previous.close();
    if (!dialog.open) dialog.showModal();
  }

  /** Replace the whole stack with one dialog (or none). */
  reset(dialog: HTMLDialogElement | null = null): void {
    const open = this.stack.splice(0);
    for (const d of open) if (d.open) d.close();
    if (dialog) this.open(dialog);
  }

  back(): void {
    const current = this.stack.pop();
    if (current?.open) current.close();
    this.pop(false);
  }

  private pop(remove = true): void {
    if (remove) this.stack.pop();
    const previous = this.top();
    if (previous) { if (!previous.open) previous.showModal(); } else this.onEmpty();
  }
}

export interface Preferences { volume: number; muted: boolean; shake: boolean }

const PREFS_KEY = 'steel-front:prefs';
const SLOT_KEY = 'steel-front:save:';
const META_KEY = 'steel-front:save-meta:';
export const SLOT_COUNT = 3;

/** localStorage access that never throws (private mode, disabled storage). */
export const storage = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string): string | null {
    try { localStorage.setItem(key, value); return null; } catch (error) {
      const name = (error as DOMException)?.name;
      return name === 'QuotaExceededError' ? 'browser storage is full' : 'browser storage is unavailable';
    }
  },
};

export function loadPreferences(): Preferences {
  const fallback: Preferences = { volume: 0.7, muted: false, shake: true };
  try {
    const raw = JSON.parse(storage.get(PREFS_KEY) ?? 'null') as Partial<Preferences> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    return {
      volume: typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : fallback.volume,
      muted: typeof raw.muted === 'boolean' ? raw.muted : fallback.muted,
      shake: typeof raw.shake === 'boolean' ? raw.shake : fallback.shake,
    };
  } catch { return fallback; }
}

export function savePreferences(prefs: Preferences): void { storage.set(PREFS_KEY, JSON.stringify(prefs)); }

export interface SlotMeta { label: string; savedAt: string; tick: number }

export function slotMeta(slot: number): SlotMeta | null {
  if (storage.get(SLOT_KEY + slot) === null) return null;
  try {
    const meta = JSON.parse(storage.get(META_KEY + slot) ?? 'null') as SlotMeta | null;
    if (meta && typeof meta.label === 'string' && typeof meta.tick === 'number') return meta;
  } catch { /* fall through */ }
  return { label: 'Unreadable save', savedAt: '', tick: 0 };
}

export function readSlot(slot: number): string | null { return storage.get(SLOT_KEY + slot); }

/** Write a save; the previous contents of the slot survive a failed write. */
export function writeSlot(slot: number, text: string, meta: SlotMeta): string | null {
  const error = storage.set(SLOT_KEY + slot, text);
  if (error) return error;
  storage.set(META_KEY + slot, JSON.stringify(meta));
  return null;
}

export function clock(tick: number, ticksPerSecond: number): string {
  const seconds = Math.floor(tick / ticksPerSecond);
  const h = Math.floor(seconds / 3600);
  const m = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

export interface MenuHost {
  rules: Rules;
  prefs: Preferences;
  /** Reduced-motion preference: screen shake is unavailable. */
  reducedMotion: boolean;
  start(setup: MatchSetup): void;
  resume(): void;
  quitToMenu(): void;
  /** Returns an error message, or null on success. */
  save(slot: number): string | null;
  load(slot: number): string | null;
  playAgain(): void;
  applyPreferences(): void;
  click(): void;
  matchActive(): boolean;
  /** A battle is running and not yet decided. */
  canSave(): boolean;
  summary(): string;
}

/** Wires the menu dialogs to the application. */
export class Menus {
  readonly stack = new DialogStack();
  private readonly host: MenuHost;
  private readonly dialogs: Record<'main' | 'setup' | 'pause' | 'slots' | 'settings' | 'results' | 'guide', HTMLDialogElement>;
  private slotMode: 'save' | 'load' = 'load';
  private setup: { faction: string; map: string; difficulty: string };

  constructor(host: MenuHost) {
    this.host = host;
    const rules = host.rules;
    this.dialogs = {
      main: element('main-menu'), setup: element('skirmish-setup'), pause: element('pause-menu'), slots: element('save-slots'),
      settings: element('settings'), results: element('results'), guide: element('field-guide'),
    };
    for (const dialog of Object.values(this.dialogs)) this.stack.manage(dialog);
    this.stack.sticky.add(this.dialogs.main);
    this.stack.sticky.add(this.dialogs.results);
    this.stack.onEmpty = () => host.resume();
    this.setup = { faction: rules.skirmish.defaultFaction, map: rules.skirmish.defaultMap, difficulty: rules.ai.defaultDifficulty };
    for (const dialog of Object.values(this.dialogs)) dialog.addEventListener('click', event => { if ((event.target as HTMLElement).closest('button')) host.click(); });

    // Main menu.
    element('menu-new').addEventListener('click', () => this.stack.open(this.dialogs.setup));
    element('menu-continue').addEventListener('click', () => this.stack.reset());
    element('menu-load').addEventListener('click', () => this.openSlots('load'));
    element('menu-settings').addEventListener('click', () => this.openSettings());
    element('menu-controls').addEventListener('click', () => this.stack.open(this.dialogs.guide));
    const dev = element<HTMLSelectElement>('dev-scenario');
    for (const scenario of rules.scenarios.values()) dev.add(new Option(scenario.name, scenario.id));
    element('dev-start').addEventListener('click', () => host.start({ kind: 'scenario', id: dev.value, difficulty: this.setup.difficulty }));

    // Skirmish setup: radio cards built from data.
    const factions = element('setup-factions');
    for (const faction of rules.factions.values()) {
      factions.append(this.choice('faction', faction.id, faction.name, faction.id === 'allies' ? 'US Army · Sherman, M10, P-47' : 'Wehrmacht · Panzer IV, Tiger, Bf 109', faction.team));
    }
    const maps = element('setup-maps');
    for (const id of rules.skirmish.maps) {
      const preset = rules.maps.get(id)!;
      maps.append(this.choice('map', id, preset.name, preset.subtitle, (preset.palette.grass as string | undefined) ?? '#7e8761'));
    }
    const difficulties = element('setup-difficulties');
    const notes: Record<string, string> = { easy: 'Slow, small attacks', normal: 'Steady pressure', hard: 'Fast build, large waves' };
    for (const level of rules.ai.difficulties.values()) difficulties.append(this.choice('difficulty', level.id, level.name, notes[level.id] ?? ''));
    this.dialogs.setup.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      if (input.name in this.setup) (this.setup as Record<string, string>)[input.name] = input.value;
      this.describeSetup();
    });
    this.describeSetup();
    element('setup-start').addEventListener('click', () => host.start({ kind: 'skirmish', ...this.setup }));

    // Pause menu.
    element('pause-resume').addEventListener('click', () => this.stack.reset());
    element('pause-results').addEventListener('click', () => this.stack.open(this.dialogs.results));
    element('pause-save').addEventListener('click', () => this.openSlots('save'));
    element('pause-load').addEventListener('click', () => this.openSlots('load'));
    element('pause-settings').addEventListener('click', () => this.openSettings());
    element('pause-controls').addEventListener('click', () => this.stack.open(this.dialogs.guide));
    element('pause-quit').addEventListener('click', () => host.quitToMenu());

    // Settings apply immediately and persist.
    const volume = element<HTMLInputElement>('setting-volume');
    const mute = element<HTMLInputElement>('setting-mute');
    const shake = element<HTMLInputElement>('setting-shake');
    volume.addEventListener('input', () => { host.prefs.volume = Number(volume.value) / 100; this.syncSettings(); host.applyPreferences(); });
    mute.addEventListener('change', () => { host.prefs.muted = mute.checked; host.applyPreferences(); });
    shake.addEventListener('change', () => { host.prefs.shake = shake.checked; host.applyPreferences(); });

    // Results.
    element('results-view').addEventListener('click', () => this.stack.reset());
    element('results-menu').addEventListener('click', () => host.quitToMenu());
    element('results-again').addEventListener('click', () => host.playAgain());
  }

  private choice(name: string, value: string, title: string, note: string, swatch = ''): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = (this.setup as Record<string, string>)[name] === value;
    label.append(input);
    if (swatch) { const bar = document.createElement('span'); bar.className = 'swatch'; bar.style.background = swatch; label.append(bar); }
    const b = document.createElement('b');
    b.textContent = title;
    const small = document.createElement('small');
    small.textContent = note;
    label.append(b, small);
    return label;
  }

  private describeSetup(): void {
    const rules = this.host.rules;
    const enemy = Array.from(rules.factions.values()).find(f => f.id !== this.setup.faction)!;
    element('setup-summary').textContent = `${rules.factions.get(this.setup.faction)!.name} vs ${enemy.name} (${rules.ai.difficulties.get(this.setup.difficulty)!.name}) on ${rules.maps.get(this.setup.map)!.name}. `
      + `Both sides start with one MCV and ${rules.skirmish.credits} credits. Destroy the enemy MCV or headquarters to win.`;
  }

  showMain(): void {
    element('menu-continue').hidden = !this.host.matchActive();
    this.stack.reset(this.dialogs.main);
    element<HTMLButtonElement>('menu-new').focus();
  }

  showPause(): void {
    element('pause-summary').textContent = this.host.summary();
    element('pause-status').textContent = '';
    element('pause-results').hidden = !this.host.matchActive() || !this.resultsReady;
    element('pause-save').toggleAttribute('disabled', !this.host.canSave());
    this.stack.reset(this.dialogs.pause);
    element<HTMLButtonElement>('pause-resume').focus();
  }

  get paused(): boolean { return this.stack.size > 0; }
  private resultsReady = false;

  showResults(world: World, player: number, again: boolean): void {
    const outcome = world.outcome!;
    const rules = world.rules;
    const won = outcome.winner === player;
    const dialog = this.dialogs.results;
    dialog.classList.toggle('victory', won);
    dialog.classList.toggle('defeat', !won && !outcome.draw);
    element('results-label').textContent = `BATTLE REPORT · ${clock(outcome.tick, rules.game.ticksPerSecond)}`;
    element('results-title').textContent = outcome.draw ? 'Stalemate.' : won ? 'Victory.' : 'Defeat.';
    element('results-text').textContent = outcome.draw
      ? 'Both command posts fell in the same moment. Neither side holds the field.'
      : won ? 'The enemy command post is destroyed. The sector is yours.' : 'Your command has been destroyed. The sector is lost.';
    const table = element<HTMLTableElement>('results-table');
    const players = world.players;
    const name = (index: number): string => `${index === player ? 'YOU' : 'ENEMY'} · ${rules.factions.get(players[index].faction)!.name.toUpperCase()}`;
    const rows: Array<[string, (index: number) => number | string]> = [
      ['Units produced', i => players[i].stats.unitsBuilt],
      ['Units lost', i => players[i].stats.unitsLost],
      ['Structures built', i => players[i].stats.buildingsBuilt],
      ['Structures lost', i => players[i].stats.buildingsLost],
      ['Credits earned', i => players[i].ledger.delivered + players[i].ledger.oil],
      ['Credits spent', i => players[i].ledger.spent - players[i].ledger.refunded],
    ];
    const order = [player, ...players.map(p => p.index).filter(i => i !== player)];
    const head = `<thead><tr><th></th>${order.map(i => `<th>${name(i)}</th>`).join('')}</tr></thead>`;
    const body = rows.map(([label, value]) => `<tr><td>${label}</td>${order.map(i => `<td>${value(i)}</td>`).join('')}</tr>`).join('');
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    element('results-again').hidden = !again;
    this.resultsReady = true;
    this.stack.reset(dialog);
    element<HTMLButtonElement>(again ? 'results-again' : 'results-menu').focus();
  }

  clearResults(): void { this.resultsReady = false; }

  private openSettings(): void {
    this.syncSettings();
    const shake = element<HTMLInputElement>('setting-shake');
    shake.disabled = this.host.reducedMotion;
    element('setting-motion-note').textContent = this.host.reducedMotion ? 'SCREEN SHAKE IS OFF: YOUR SYSTEM REQUESTS REDUCED MOTION.' : 'SETTINGS ARE SAVED IN THIS BROWSER.';
    this.stack.open(this.dialogs.settings);
  }

  syncSettings(): void {
    const prefs = this.host.prefs;
    element<HTMLInputElement>('setting-volume').value = String(Math.round(prefs.volume * 100));
    element('setting-volume-value').textContent = `${Math.round(prefs.volume * 100)}%`;
    element<HTMLInputElement>('setting-mute').checked = prefs.muted;
    element<HTMLInputElement>('setting-shake').checked = prefs.shake && !this.host.reducedMotion;
  }

  private openSlots(mode: 'save' | 'load'): void {
    this.slotMode = mode;
    element('slots-label').textContent = mode === 'save' ? 'SAVE GAME' : 'LOAD GAME';
    element('slots-title').textContent = mode === 'save' ? 'Save to a slot.' : 'Load a saved battle.';
    this.status('', false);
    this.renderSlots();
    this.stack.open(this.dialogs.slots);
  }

  private status(text: string, ok: boolean): void {
    const line = element('slots-status');
    line.textContent = text;
    line.classList.toggle('ok', ok);
  }

  private renderSlots(): void {
    const list = element('slot-list');
    list.replaceChildren();
    const tps = this.host.rules.game.ticksPerSecond;
    for (let slot = 1; slot <= SLOT_COUNT; slot++) {
      const meta = slotMeta(slot);
      const button = document.createElement('button');
      button.className = 'slot';
      button.dataset.slot = String(slot);
      const when = meta?.savedAt ? new Date(meta.savedAt).toLocaleString() : '';
      button.innerHTML = `<span class="slot-number">SLOT ${slot}</span><span><b></b><small></small></span><span class="slot-number"></span>`;
      button.querySelector('b')!.textContent = meta ? meta.label : 'Empty slot';
      button.querySelector('small')!.textContent = meta ? when : this.slotMode === 'save' ? 'Save here' : 'Nothing saved';
      button.lastElementChild!.textContent = meta ? clock(meta.tick, tps) : '';
      button.disabled = this.slotMode === 'load' && !meta;
      button.addEventListener('click', () => {
        if (this.slotMode === 'save') {
          const error = this.host.save(slot);
          this.status(error ? `Save failed: ${error}. Your previous save in this slot is unchanged.` : `Saved to slot ${slot}.`, !error);
          this.renderSlots();
        } else {
          const error = this.host.load(slot);
          if (error) this.status(`Cannot load slot ${slot}: ${error}. ${this.host.matchActive() ? 'Your current battle is unchanged.' : ''}`, false);
        }
      });
      list.append(button);
    }
  }
}
