import type { EntityLayer } from '../render/entity-layer.ts';
import { drawSheet } from '../render/unit-atlas.ts';
import { MOVE_STATE_NAMES } from '../sim/entities.ts';
import type { Entity } from '../sim/entities.ts';
import type { World } from '../sim/world.ts';
import type { Selection } from './selection.ts';

export const REASON_TEXT: Record<string, string> = {
  traffic: 'waiting for traffic',
  congested: 'rerouting around congestion',
  'no-route': 'no route to destination',
  'nearest-valid': 'heading to nearest reachable ground',
  'no-room': 'destination crowded — finding space',
  yielding: 'giving way',
};

export const TASK_TEXT: Record<string, string> = {
  'seek-dump': 'looking for supplies',
  'seek-depot': 'returning to depot',
  'to-dump': 'driving to supply dump',
  'to-depot': 'hauling to depot',
  load: 'loading supplies',
  unload: 'unloading',
  capture: 'capture order',
  deploy: 'deploying',
};

export const STATUS_TEXT: Record<string, string> = {
  'no-resource': 'no reachable supplies',
  'no-depot': 'no depot to unload at',
  queued: 'waiting for a free dock',
  capturing: 'capturing',
  approaching: 'moving to capture',
  'already captured': 'target already captured',
  'no-route': 'no route to target',
  'deploy-blocked': 'cannot deploy here — move to open buildable ground',
  deploying: 'deploying',
  'making way': 'making way for construction',
};

function maxHp(world: World, entity: Entity): number {
  return entity.kind === 'unit' ? world.rules.units.get(entity.type)!.hp : world.rules.buildings.get(entity.type)!.hp;
}

function nameOf(world: World, type: string): string {
  return world.rules.units.get(type)?.name ?? world.rules.buildings.get(type)?.name ?? type;
}

/** One-line activity description for a single entity. */
export function describe(world: World, entity: Entity): string {
  if (entity.kind === 'building') {
    const def = world.rules.buildings.get(entity.type)!;
    const owner = entity.owner < 0 ? 'NEUTRAL' : `PLAYER ${entity.owner + 1}`;
    // Fog memory ghosts (negative ids) carry no live information.
    if (entity.id < 0) return `${owner} · LAST SEEN`;
    const parts = [owner];
    if (def.power !== 0 && entity.owner >= 0) parts.push(`POWER ${def.power > 0 ? '+' : ''}${def.power}`);
    if (entity.repairing) parts.push('REPAIRING');
    if (entity.rally >= 0) parts.push('RALLY SET');
    if (typeof def.capabilities.supply === 'number') parts.push(`${entity.stock} / ${def.capabilities.supply} supplies`);
    if (def.capabilities.oil) parts.push(entity.owner < 0 ? 'engineer can capture' : `+${world.rules.economy.oilPayout} every ${world.rules.economy.oilIntervalTicks / world.rules.game.ticksPerSecond}s`);
    if (def.dockSlots > 0) parts.push(`docks ${entity.docks?.length ?? 0}/${def.dockSlots}`);
    return parts.join(' · ');
  }
  const def = world.rules.units.get(entity.type)!;
  const parts: string[] = [];
  if (entity.rank > 0) parts.push(entity.rank > 1 ? 'ELITE' : 'VETERAN');
  const cargo = def.capabilities.cargo;
  if (typeof cargo === 'number') parts.push(`CARGO ${entity.cargo}/${cargo}`);
  if (entity.task === 'capture' && entity.timer > 0) {
    parts.push(`CAPTURING ${Math.round(100 * entity.timer / world.rules.economy.captureTicks)}%`);
  } else if (entity.attack >= 0) {
    parts.push('ATTACKING');
  } else if (entity.task && TASK_TEXT[entity.task]) {
    parts.push(`${entity.auto ? 'AUTO · ' : ''}${TASK_TEXT[entity.task]}`);
  } else {
    parts.push(MOVE_STATE_NAMES[entity.moveState].toUpperCase());
  }
  if (entity.status && STATUS_TEXT[entity.status] && entity.status !== 'capturing' && entity.status !== 'approaching') parts.push(STATUS_TEXT[entity.status]);
  else if (entity.reason && REASON_TEXT[entity.reason]) parts.push(REASON_TEXT[entity.reason]);
  return parts.join(' · ');
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing HUD element: ${id}`);
  return found as T;
}

/** Bottom-left information about the current selection; updates DOM only on change. */
export class SelectionPanel {
  private readonly terrain = element<HTMLElement>('terrain-panel');
  private readonly panel = element<HTMLElement>('selection-panel');
  private readonly portrait = element<HTMLCanvasElement>('unit-portrait');
  private readonly count = element<HTMLElement>('selection-count');
  private readonly eyebrow = element<HTMLElement>('selection-eyebrow');
  private readonly name = element<HTMLElement>('selection-name');
  private readonly hp = element<HTMLElement>('selection-hp');
  private readonly status = element<HTMLElement>('selection-status');
  private readonly types = element<HTMLElement>('selection-types');
  private lastKey = '';
  private lastTypes = '';
  private readonly onPickType: (type: string) => void;

  constructor(onPickType: (type: string) => void) {
    this.onPickType = onPickType;
    this.types.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-type]');
      if (button?.dataset.type) this.onPickType(button.dataset.type);
    });
  }

  update(world: World, selection: Selection, layer: EntityLayer, inspected: Entity | null = null): void {
    const members: Entity[] = [];
    for (const id of selection.ids) {
      const entity = world.get(id);
      if (entity) members.push(entity);
    }
    const inspecting = members.length === 0 && inspected !== null;
    if (inspecting) members.push(inspected);
    if (members.length === 0) {
      if (this.lastKey !== 'none') {
        this.terrain.hidden = false;
        this.panel.hidden = true;
        this.lastKey = 'none';
        this.lastTypes = '';
      }
      return;
    }
    members.sort((a, b) => a.id - b.id);
    const lead = members[0];
    const def = world.rules.units.get(lead.type);
    let hp = 0;
    let totalHp = 0;
    const counts = new Map<string, number>();
    for (const member of members) {
      hp += member.hp;
      totalHp += maxHp(world, member);
      counts.set(member.type, (counts.get(member.type) ?? 0) + 1);
    }
    const status = members.length === 1 ? describe(world, lead) : summarize(members);
    const key = `${selection.revision}|${lead.id}|${lead.owner}|${hp}|${status}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.terrain.hidden = true;
    this.panel.hidden = false;
    this.count.textContent = inspecting ? 'INTEL' : lead.kind === 'building' ? 'STRUCTURE' : `${members.length} UNIT${members.length === 1 ? '' : 'S'}`;
    const side = world.players[lead.owner]?.faction.toUpperCase() ?? 'NEUTRAL';
    this.eyebrow.textContent = members.length === 1 ? `${side} · ${def ? def.armor.toUpperCase() : 'STRUCTURE'}` : 'FORCE SELECTED';
    this.name.textContent = members.length === 1 ? nameOf(world, lead.type) : `${members.length} units`;
    this.hp.style.width = `${Math.round(100 * hp / Math.max(1, totalHp))}%`;
    this.status.textContent = status;
    const typeKey = `${lead.owner}|${Array.from(counts).join(',')}`;
    if (typeKey !== this.lastTypes) {
      this.lastTypes = typeKey;
      this.types.replaceChildren(...Array.from(counts).map(([type, n]) => {
        const button = document.createElement('button');
        button.dataset.type = type;
        button.title = 'Select only this type';
        button.textContent = `${nameOf(world, type)} ×${n}`;
        button.disabled = inspecting;
        return button;
      }));
      this.drawPortrait(world, lead, layer);
    }
  }

  private drawPortrait(world: World, entity: Entity, layer: EntityLayer): void {
    const context = this.portrait.getContext('2d')!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.portrait.width, this.portrait.height);
    if (entity.kind === 'building') {
      const sprite = layer.buildingFor(world, entity);
      const scale = Math.min(88 / sprite.canvas.width, 80 / sprite.canvas.height);
      context.setTransform(scale, 0, 0, scale, 47 - sprite.canvas.width * scale / 2, 84 - sprite.canvas.height * scale);
      context.drawImage(sprite.canvas, 0, 0);
      return;
    }
    const sprites = layer.spritesFor(world, entity);
    const scale = sprites.infantry ? 1.9 : 1.15;
    context.setTransform(scale, 0, 0, scale, 47, sprites.infantry ? 74 : 60);
    drawSheet(context, sprites.body, 3, 0, 0, 0);
    if (sprites.turret) drawSheet(context, sprites.turret, 3, 0, 0, 0);
  }
}

function summarize(members: Entity[]): string {
  const states = new Map<string, number>();
  for (const member of members) {
    const name = MOVE_STATE_NAMES[member.moveState];
    states.set(name, (states.get(name) ?? 0) + 1);
  }
  return Array.from(states).map(([name, n]) => `${n} ${name.toLowerCase()}`).join(' · ');
}
