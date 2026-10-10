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

  update(world: World, selection: Selection, layer: EntityLayer): void {
    const members: Entity[] = [];
    for (const id of selection.ids) {
      const entity = world.get(id);
      if (entity) members.push(entity);
    }
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
    let maxHp = 0;
    const counts = new Map<string, number>();
    for (const member of members) {
      const d = world.rules.units.get(member.type);
      hp += member.hp;
      maxHp += d ? d.hp : member.hp;
      counts.set(member.type, (counts.get(member.type) ?? 0) + 1);
    }
    const status = members.length === 1
      ? `${MOVE_STATE_NAMES[lead.moveState].toUpperCase()}${lead.reason && REASON_TEXT[lead.reason] ? ` · ${REASON_TEXT[lead.reason]}` : ''}`
      : summarize(members);
    const key = `${selection.revision}|${lead.type}|${hp}|${status}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.terrain.hidden = true;
    this.panel.hidden = false;
    this.count.textContent = `${members.length} UNIT${members.length === 1 ? '' : 'S'}`;
    this.eyebrow.textContent = members.length === 1 ? `${(world.players[lead.owner]?.faction ?? '').toUpperCase()} · ${def?.armor.toUpperCase() ?? ''}` : 'FORCE SELECTED';
    this.name.textContent = members.length === 1 ? def?.name ?? lead.type : `${members.length} units`;
    this.hp.style.width = `${Math.round(100 * hp / Math.max(1, maxHp))}%`;
    this.status.textContent = status;
    const typeKey = Array.from(counts).join(',');
    if (typeKey !== this.lastTypes) {
      this.lastTypes = typeKey;
      this.types.replaceChildren(...Array.from(counts).map(([type, n]) => {
        const button = document.createElement('button');
        button.dataset.type = type;
        button.title = 'Select only this type';
        button.textContent = `${world.rules.units.get(type)?.name ?? type} ×${n}`;
        return button;
      }));
      this.drawPortrait(world, lead, layer);
    }
  }

  private drawPortrait(world: World, entity: Entity, layer: EntityLayer): void {
    const context = this.portrait.getContext('2d')!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.portrait.width, this.portrait.height);
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
