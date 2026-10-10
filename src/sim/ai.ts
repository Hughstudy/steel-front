import type { CommandInput } from './commands.ts';
import type { Entity } from './entities.ts';
import { MoveState } from './entities.ts';
import { canSee } from './fog.ts';
import type { QueueItem } from './production.ts';
import { constructionProblem, costOf, deployOrigin, lowPower, missingPrerequisites, ownedTypes } from './production.ts';
import type { AiDifficulty, AiFactionPlan, BuildingDef } from './rules.ts';
import type { Player, World } from './world.ts';
import { ringTiles } from './structures.ts';

/** One launched attack wave, kept for diagnostics and tests. */
export interface AiWave {
  index: number;
  launchTick: number;
  size: number;
  composition: Record<string, number>;
  /** Destination tile; first arrival (a member within reach of it or engaging) is recorded. */
  target: number;
  arrivedTick: number;
}

/**
 * Computer player state. Plain JSON data (no object references) so it can be
 * saved and replayed; every decision derives from it and the visible world.
 */
export interface AiState {
  difficulty: string;
  nextThink: number;
  /** Bounded placement search over candidate sites near the headquarters. */
  placeCursor: number;
  placeRetryTick: number;
  /** Bounded search for a deploy site when the MCV cannot deploy where it stands. */
  deployCursor: number;
  deployRetryTick: number;
  /** Active wave members (unit ids) and the wave they belong to (-1 none). */
  wave: number[];
  waveIndex: number;
  nextWaveTick: number;
  waveDelayed: boolean;
  waves: AiWave[];
  /** Units sent to answer a threat, and when a threat was last seen. */
  defenders: number[];
  threatTick: number;
  /** Rally/home tile in front of the base (-1 until the HQ exists). */
  home: number;
  /** While > tick, production is stalled after a failed bankruptcy recovery. */
  stalledUntil: number;
  commands: number;
  /** Capturable structures this player has owned; losing one is known, so it is not treated as neutral. */
  held: number[];
  /** Recent decisions for development diagnostics (bounded). */
  log: string[];
}

const LOG_LIMIT = 80;

export function createAiState(difficulty: string, firstWaveTick: number): AiState {
  return {
    difficulty, nextThink: 1, placeCursor: 0, placeRetryTick: 0, deployCursor: 0, deployRetryTick: 0,
    wave: [], waveIndex: 0, nextWaveTick: firstWaveTick, waveDelayed: false, waves: [],
    defenders: [], threatTick: -1000000, home: -1, stalledUntil: 0, commands: 0, held: [], log: [],
  };
}

/** Candidate offsets around a base anchor, nearest first (deterministic order, built once). */
let OFFSETS: Int32Array | null = null;
function offsets(): Int32Array {
  if (OFFSETS) return OFFSETS;
  const list: Array<[number, number, number]> = [];
  const r = 14;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) list.push([dx * dx + dy * dy, dy, dx]);
  list.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  OFFSETS = Int32Array.from(list.flatMap(([, dy, dx]) => [dx, dy]));
  return OFFSETS;
}

interface Snapshot {
  hq: Entity | null;
  mcv: Entity | null;
  buildings: Entity[];
  counts: Map<string, number>;
  army: Entity[];
  trucks: Entity[];
  engineers: Entity[];
  derricksOwned: number;
  dumpsLeft: boolean;
}

/** Context for one think: budgeted command issue plus logging. */
class Think {
  readonly world: World;
  readonly player: Player;
  readonly state: AiState;
  readonly knobs: AiDifficulty;
  readonly plan: AiFactionPlan;
  budget: number;

  constructor(world: World, player: Player, state: AiState, knobs: AiDifficulty, plan: AiFactionPlan) {
    this.world = world;
    this.player = player;
    this.state = state;
    this.knobs = knobs;
    this.plan = plan;
    this.budget = knobs.actionsPerThink;
  }

  issue(input: Omit<CommandInput, 'player'>): boolean {
    if (this.budget <= 0) return false;
    this.budget--;
    this.state.commands++;
    this.world.enqueue({ ...input, player: this.player.index });
    return true;
  }

  log(text: string): void {
    const log = this.state.log;
    log.push(`${this.world.tick} ${text}`);
    if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
  }
}

/** Run every computer player whose think interval is due (end of tick; commands apply next tick). */
export function updateAi(world: World): void {
  for (const player of world.players) {
    const state = player.ai;
    if (!state || world.tick < state.nextThink) continue;
    const knobs = world.rules.ai.difficulties.get(state.difficulty)!;
    const plan = world.rules.ai.factions.get(player.faction);
    state.nextThink = world.tick + knobs.thinkIntervalTicks;
    if (!plan) continue;
    think(new Think(world, player, state, knobs, plan));
  }
}

function snapshot(t: Think): Snapshot {
  const { world, player } = t;
  const snap: Snapshot = { hq: null, mcv: null, buildings: [], counts: new Map(), army: [], trucks: [], engineers: [], derricksOwned: 0, dumpsLeft: false };
  const placement = new Set(world.rules.production.categories.filter(c => c.placement).map(c => c.id));
  for (const entity of world.entities) {
    if (entity.hp <= 0 || world.removals.includes(entity.id)) continue;
    if (entity.kind === 'building') {
      const def = world.rules.buildings.get(entity.type)!;
      if (typeof def.capabilities.supply === 'number' && entity.stock > 0) snap.dumpsLeft = true;
      if (entity.owner !== player.index) continue;
      snap.buildings.push(entity);
      snap.counts.set(entity.type, (snap.counts.get(entity.type) ?? 0) + 1);
      if (def.capabilities.oil) snap.derricksOwned++;
      if (!snap.hq && def.produces.some(id => placement.has(id))) snap.hq = entity;
      continue;
    }
    if (entity.owner !== player.index) continue;
    const def = world.rules.units.get(entity.type)!;
    if (typeof def.capabilities.deploy === 'string') { snap.mcv ??= entity; continue; }
    if (typeof def.capabilities.cargo === 'number') snap.trucks.push(entity);
    else if (def.capabilities.capture) snap.engineers.push(entity);
    else if (def.weapons.length > 0) snap.army.push(entity);
  }
  return snap;
}

function think(t: Think): void {
  const snap = snapshot(t);
  const { state, world } = t;
  state.wave = state.wave.filter(id => world.get(id));
  state.defenders = state.defenders.filter(id => world.get(id));
  if (!snap.hq) {
    if (snap.mcv) bootstrap(t, snap.mcv);
  } else if (state.home < 0) {
    state.home = homeTile(t, snap.hq);
  }
  placeReady(t, snap);
  const stalled = bankruptcy(t, snap);
  defend(t, snap);
  if (!stalled && snap.hq) {
    setRallies(t, snap);
    structures(t, snap);
    workers(t, snap);
    army(t, snap);
  }
  engineers(t, snap);
  waves(t, snap);
}

// ------------------------------------------------------------ bootstrap

function hqDef(t: Think, mcv: Entity): BuildingDef {
  return t.world.rules.buildings.get(t.world.rules.units.get(mcv.type)!.capabilities.deploy as string)!;
}

function canDeployAt(t: Think, def: BuildingDef, tile: number): boolean {
  const origin = deployOrigin(t.world, def, tile);
  if (origin < 0) return false;
  const problem = constructionProblem(t.world, t.player.index, def, origin, false);
  return problem === '' || problem === 'occupied';
}

/** Deploy the MCV where it stands, or drive it to the nearest workable site (bounded search). */
function bootstrap(t: Think, mcv: Entity): void {
  const { world, state } = t;
  if (world.pending.some(p => p.unit === mcv.id)) return;
  if (mcv.next >= 0 || mcv.moveState === MoveState.Pending || mcv.moveState === MoveState.Moving || mcv.moveState === MoveState.Waiting) return;
  const def = hqDef(t, mcv);
  if (canDeployAt(t, def, mcv.tile)) {
    if (mcv.status !== 'deploy-blocked' || world.tick >= state.deployRetryTick) {
      if (t.issue({ kind: 'deploy', ids: [mcv.id], x: 0, y: 0 })) t.log('deploy MCV');
      state.deployRetryTick = world.tick + t.knobs.retryTicks;
    }
    return;
  }
  if (world.tick < state.deployRetryTick) return;
  const list = offsets();
  const w = world.nav.width;
  const cx = mcv.tile % w;
  const cy = (mcv.tile / w) | 0;
  for (let n = 0; n < t.knobs.placementTries; n++) {
    const i = state.deployCursor;
    state.deployCursor = (state.deployCursor + 2) % list.length;
    const x = cx + list[i];
    const y = cy + list[i + 1];
    if (!world.nav.inBounds(x, y)) continue;
    const tile = y * w + x;
    if (canDeployAt(t, def, tile) && world.nav.componentOf(tile) === world.nav.componentOf(mcv.tile)) {
      if (t.issue({ kind: 'move', ids: [mcv.id], x, y })) t.log(`move MCV to ${x},${y} to deploy`);
      return;
    }
  }
  state.deployRetryTick = world.tick + t.knobs.retryTicks;
}

/** A gathering point a few tiles from the HQ toward the enemy start. */
function homeTile(t: Think, hq: Entity): number {
  const { world, player } = t;
  const s = world.subTile;
  const enemy = enemyStart(t);
  let x = hq.x / s;
  let y = hq.y / s;
  if (enemy >= 0) {
    const ex = enemy % world.nav.width + 0.5;
    const ey = ((enemy / world.nav.width) | 0) + 0.5;
    const d = Math.max(1, Math.hypot(ex - x, ey - y));
    x += (ex - x) / d * 7;
    y += (ey - y) / d * 7;
  }
  const tile = world.nav.index(Math.floor(x), Math.floor(y));
  return world.nav.nearestInComponent(tile, world.nav.componentOf(player.start >= 0 ? player.start : hq.tile));
}

/** The declared start sector of the first other player (strategic destination, not live intel). */
function enemyStart(t: Think): number {
  for (const other of t.world.players) if (other.index !== t.player.index && other.start >= 0) return other.start;
  return -1;
}

// ------------------------------------------------------------ structures

function queueOf(t: Think, category: string): QueueItem[] {
  return t.player.queues[category] ?? [];
}

function structureCategory(t: Think): string {
  return t.world.rules.production.categories.find(c => c.placement)?.id ?? '';
}

/** How many of a type the player has, is building, or is about to place. */
function planned(t: Think, snap: Snapshot, type: string): number {
  let n = snap.counts.get(type) ?? 0;
  for (const items of Object.values(t.player.queues)) for (const item of items) if (item.type === type) n++;
  for (const p of t.world.pending) if (p.player === t.player.index && p.type === type && p.item >= 0) n++;
  return n;
}

/** Place a finished structure on the nearest valid, spaced site (bounded search; retried later). */
function placeReady(t: Think, snap: Snapshot): void {
  const { world, state } = t;
  if (!snap.hq) return;
  const head = queueOf(t, structureCategory(t))[0];
  if (!head || head.reason !== 'ready' || world.pending.some(p => p.item === head.id)) return;
  if (world.tick < state.placeRetryTick) return;
  const def = world.rules.buildings.get(head.type)!;
  const list = offsets();
  const w = world.nav.width;
  const ax = snap.hq.tile % w;
  const ay = (snap.hq.tile / w) | 0;
  for (let n = 0; n < t.knobs.placementTries; n++) {
    const i = state.placeCursor;
    state.placeCursor += 2;
    if (state.placeCursor >= list.length) {
      state.placeCursor = 0;
      state.placeRetryTick = world.tick + t.knobs.retryTicks;
      t.log(`no site for ${head.type}; retry later`);
      return;
    }
    const x = ax + list[i] - (def.footprint.w >> 1);
    const y = ay + list[i + 1] - (def.footprint.h >> 1);
    if (!spaced(t, def, x, y)) continue;
    const origin = y * w + x;
    const problem = constructionProblem(world, t.player.index, def, origin);
    if (problem !== '' && problem !== 'occupied') continue;
    if (t.issue({ kind: 'place', ids: [], x, y, type: head.type })) {
      t.log(`place ${head.type} at ${x},${y}`);
      state.placeCursor = 0;
    }
    return;
  }
}

/** Keep a one-tile corridor around every structure so exits, docks and roads stay open. */
function spaced(t: Think, def: BuildingDef, ox: number, oy: number): boolean {
  const nav = t.world.nav;
  for (let y = oy - 1; y <= oy + def.footprint.h; y++) {
    for (let x = ox - 1; x <= ox + def.footprint.w; x++) {
      if (!nav.inBounds(x, y)) return false;
      if (nav.structure[y * nav.width + x] !== 0) return false;
    }
  }
  return true;
}

/** Queue the next unmet base-plan step (power first when the margin would be exceeded). */
function structures(t: Think, snap: Snapshot): void {
  const { world, player, plan, knobs } = t;
  const category = structureCategory(t);
  if (queueOf(t, category).length > 0) return;
  let next = '';
  for (const step of plan.base) {
    if (planned(t, snap, step.type) >= step.count) continue;
    if (world.tick < Math.floor(step.afterTick * knobs.tempoPercent / 100)) break;
    // Redundant production only pays when income outruns spending (credits banked).
    if (player.credits < step.minCredits) break;
    next = step.type;
    break;
  }
  const power = world.rules.buildings.get(plan.power)!;
  const owned = ownedTypes(world, player.index);
  if (next) {
    const missing = missingPrerequisites(world, player.index, next, owned);
    if (missing.length) next = missing[0]; // recover a lost prerequisite first
  }
  const draw = next ? world.rules.buildings.get(next)!.power : 0;
  const margin = player.power.supply - player.power.demand;
  const needPower = lowPower(player) || (draw < 0 && margin + draw < knobs.powerMargin);
  if (needPower && missingPrerequisites(world, player.index, power.id, owned).length === 0) next = power.id;
  if (!next) return;
  if (t.issue({ kind: 'build', ids: [], x: 0, y: 0, type: next })) t.log(`build ${next}`);
}

function setRallies(t: Think, snap: Snapshot): void {
  const { world, state } = t;
  if (state.home < 0) return;
  const w = world.nav.width;
  for (const building of snap.buildings) {
    const def = world.rules.buildings.get(building.type)!;
    if (building.rally >= 0 || def.exit === null) continue;
    if (!t.issue({ kind: 'rally', ids: [], x: state.home % w, y: (state.home / w) | 0, target: building.id })) return;
  }
}

// ------------------------------------------------------------ economy

function queuedOf(t: Think, type: string): number {
  let n = 0;
  for (const items of Object.values(t.player.queues)) for (const item of items) if (item.type === type) n++;
  return n;
}

/** Mirrors the queue command's own checks so the AI never re-issues an order that will bounce. */
function canProduce(t: Think, type: string): boolean {
  const def = t.world.rules.units.get(type);
  if (!def || def.producer === null) return false;
  if (queueOf(t, def.producer).length >= t.world.rules.production.queueLimit) return false;
  if (missingPrerequisites(t.world, t.player.index, type).length) return false;
  return t.world.entities.some(e => e.kind === 'building' && e.owner === t.player.index && t.world.rules.buildings.get(e.type)!.produces.includes(def.producer!));
}

/** Keep the truck and engineer counts at their targets (they come before army production). */
function trucksShort(t: Think, snap: Snapshot): boolean {
  return snap.dumpsLeft && snap.trucks.length + queuedOf(t, t.plan.truck) < t.knobs.truckTarget;
}

function workers(t: Think, snap: Snapshot): void {
  const { plan, knobs } = t;
  if (trucksShort(t, snap) && canProduce(t, plan.truck)) {
    if (t.issue({ kind: 'build', ids: [], x: 0, y: 0, type: plan.truck })) t.log(`build ${plan.truck}`);
  }
  // A needed truck stuck behind army items: cancel what is ahead of it (refunded in full; re-queued later).
  const queue = queueOf(t, t.world.rules.units.get(plan.truck)!.producer!);
  const at = queue.findIndex(item => item.type === plan.truck);
  if (snap.dumpsLeft && snap.trucks.length < knobs.truckTarget && at > 0 && queue[0].type !== plan.truck) {
    if (t.issue({ kind: 'cancel', ids: [], x: 0, y: 0, type: queue[0].type })) t.log(`cancel ${queue[0].type} to bring a truck forward`);
  }
  // Engineers only once hauling is under way (or no supplies are left to haul).
  const hauling = snap.trucks.length > 0 || !snap.dumpsLeft;
  const wanted = hauling ? Math.min(knobs.engineerTarget, captureTargets(t, snap).length) : 0;
  if (snap.engineers.length + queuedOf(t, plan.engineer) < wanted && canProduce(t, plan.engineer)) {
    if (t.issue({ kind: 'build', ids: [], x: 0, y: 0, type: plan.engineer })) t.log(`build ${plan.engineer}`);
  }
}

/**
 * Capturable structures not believed to be ours, nearest to the base first. Static
 * map objects are known from the start; their owner is what was last seen.
 */
function captureTargets(t: Think, snap: Snapshot): Entity[] {
  const { world, player } = t;
  const memory = player.fog.memory;
  const origin = snap.hq ?? snap.mcv;
  if (!origin) return [];
  // The ground region the base can reach: the MCV's own tile, or any free tile around the HQ.
  const component = origin.kind === 'unit'
    ? world.nav.componentOf(origin.next >= 0 ? origin.next : origin.tile)
    : ringTiles(world, world.rules.buildings.get(origin.type)!, origin.tile).map(tile => world.nav.componentOf(tile)).find(c => c >= 0) ?? -1;
  const list: Array<{ entity: Entity; d: number }> = [];
  for (const entity of world.entities) {
    if (entity.kind !== 'building' || !world.rules.buildings.get(entity.type)!.capabilities.capturable) continue;
    if (entity.owner === player.index) {
      if (!t.state.held.includes(entity.id)) t.state.held.push(entity.id);
      continue;
    }
    const lost = t.state.held.includes(entity.id);
    const known = canSee(world, player.index, entity) ? entity.owner : lost ? -2 : memory.get(entity.id)?.owner ?? -1;
    if (known !== -1) continue; // enemy-held (seen, or lost to the enemy): leave to the army
    // Engineers capture from an adjacent tile, so the approach ring (not the blocked origin) must be reachable.
    const def = world.rules.buildings.get(entity.type)!;
    if (component >= 0 && !ringTiles(world, def, entity.tile).some(tile => world.nav.componentOf(tile) === component)) continue;
    // Expand on our own side of the map: closer to our start than to the enemy's.
    const enemy = enemyStart(t);
    if (enemy >= 0 && player.start >= 0) {
      const w = world.nav.width;
      const ex = entity.tile % w;
      const ey = (entity.tile / w) | 0;
      const own = (ex - player.start % w) ** 2 + (ey - ((player.start / w) | 0)) ** 2;
      const theirs = (ex - enemy % w) ** 2 + (ey - ((enemy / w) | 0)) ** 2;
      if (own > theirs) continue;
    }
    list.push({ entity, d: (entity.x - origin.x) ** 2 + (entity.y - origin.y) ** 2 });
  }
  return list.sort((a, b) => a.d - b.d || a.entity.id - b.entity.id).map(item => item.entity);
}

function engineers(t: Think, snap: Snapshot): void {
  const taken = new Set(snap.engineers.filter(e => e.task === 'capture').map(e => e.target));
  const targets = captureTargets(t, snap).filter(e => !taken.has(e.id));
  for (const engineer of snap.engineers) {
    if (engineer.task !== '' || engineer.next >= 0 || engineer.moveState === MoveState.Pending) continue;
    const target = targets.shift();
    if (!target) return;
    if (t.issue({ kind: 'capture', ids: [engineer.id], x: 0, y: 0, target: target.id })) t.log(`engineer ${engineer.id} → capture ${target.type} ${target.id}`);
  }
}

/** Building types a working truck depends on (its prerequisite closure). */
function essentials(t: Think): Set<string> {
  const result = new Set<string>();
  const stack = [...t.world.rules.units.get(t.plan.truck)!.prerequisites];
  while (stack.length) {
    const type = stack.pop()!;
    if (result.has(type)) continue;
    result.add(type);
    stack.push(...(t.world.rules.buildings.get(type)?.prerequisites ?? []));
  }
  return result;
}

/**
 * No income source and none on its way: make sure the truck (and any missing
 * building it depends on) is affordable. Cancel non-essential queued items (full
 * refund of what was paid) or sell one non-essential building, but only if that
 * actually closes the gap; otherwise stall and reassess on a long timer.
 */
function bankruptcy(t: Think, snap: Snapshot): boolean {
  const { world, player, state, plan } = t;
  if (world.tick < state.stalledUntil) return true;
  if (!snap.hq || snap.trucks.length > 0 || snap.derricksOwned > 0) return false;
  if (snap.engineers.some(e => e.task === 'capture')) return false; // income is on its way
  if (!snap.dumpsLeft) {
    const engineerCost = costOf(world, plan.engineer);
    if (captureTargets(t, snap).length && (snap.engineers.length > 0 || queuedOf(t, plan.engineer) > 0 || player.credits >= engineerCost)) return false;
    state.stalledUntil = world.tick + t.knobs.bankruptcyRetryTicks;
    t.log('bankrupt: no supplies or oil left; stalled');
    return true;
  }
  const needed = essentials(t);
  const items = Object.values(player.queues).flat();
  // Credits still needed for missing essential buildings and for one truck.
  let need = 0;
  for (const type of needed) if (planned(t, snap, type) === 0) need += costOf(world, type);
  for (const item of items) if (needed.has(item.type)) need += costOf(world, item.type) - item.paid;
  const trucks = items.filter(item => item.type === plan.truck);
  need += trucks.length ? Math.min(...trucks.map(item => costOf(world, item.type) - item.paid)) : costOf(world, plan.truck);
  if (player.credits >= need) return false;
  const percent = world.rules.production.cancelRefundPercent;
  const spare = items.filter(item => !needed.has(item.type) && item.type !== plan.truck);
  const refundable = spare.reduce((sum, item) => sum + Math.floor(item.paid * percent / 100), 0);
  if (spare.length && player.credits + refundable >= need) {
    for (const item of spare) if (!t.issue({ kind: 'cancel', ids: [], x: 0, y: 0, type: item.type })) break;
    t.log('bankrupt: cancelled queued items to restore income');
    return true;
  }
  const candidates = snap.buildings
    .filter(b => b !== snap.hq && !needed.has(b.type) && world.rules.buildings.get(b.type)!.sellable)
    .map(b => {
      const def = world.rules.buildings.get(b.type)!;
      return { b, refund: Math.floor(def.cost * world.rules.production.sellRefundPercent / 100 * b.hp / def.hp) };
    })
    .filter(c => player.credits + refundable + c.refund >= need)
    .sort((a, b) => a.refund - b.refund || a.b.id - b.b.id);
  if (candidates.length) {
    for (const item of spare) if (!t.issue({ kind: 'cancel', ids: [], x: 0, y: 0, type: item.type })) break;
    if (t.issue({ kind: 'sell', ids: [], x: 0, y: 0, target: candidates[0].b.id })) t.log(`bankrupt: sell ${candidates[0].b.type} to restore income`);
    return true;
  }
  state.stalledUntil = world.tick + t.knobs.bankruptcyRetryTicks;
  t.log('bankrupt: no recovery possible; stalled');
  return true;
}

// ------------------------------------------------------------ army

/** Fill unit queues toward the composition weights, by largest deficit. */
function army(t: Think, snap: Snapshot): void {
  const { world, plan, knobs } = t;
  const structureHead = queueOf(t, structureCategory(t))[0];
  if (structureHead && structureHead.reason === 'funds') return; // the base comes first
  if (snap.dumpsLeft && snap.trucks.length === 0) return; // and income before an army
  const counts = new Map<string, number>();
  let total = 0;
  for (const unit of snap.army) { counts.set(unit.type, (counts.get(unit.type) ?? 0) + 1); total++; }
  for (const { type } of plan.army) { const q = queuedOf(t, type); counts.set(type, (counts.get(type) ?? 0) + q); total += q; }
  if (total >= knobs.armyCap) return;
  const weightSum = plan.army.reduce((sum, a) => sum + a.weight, 0);
  const truckCategory = world.rules.units.get(plan.truck)!.producer;
  const short = trucksShort(t, snap);
  for (const category of world.rules.production.categories) {
    if (category.placement || queueOf(t, category.id).length >= knobs.queueDepth) continue;
    if (short && category.id === truckCategory) continue; // trucks first
    let best = '';
    let bestDeficit = -Infinity;
    for (const { type, weight } of plan.army) {
      if (world.rules.units.get(type)!.producer !== category.id || !canProduce(t, type)) continue;
      const deficit = weight * (total + 1) / weightSum - (counts.get(type) ?? 0);
      if (deficit > bestDeficit) { bestDeficit = deficit; best = type; }
    }
    if (!best) continue;
    if (!t.issue({ kind: 'build', ids: [], x: 0, y: 0, type: best })) return;
    counts.set(best, (counts.get(best) ?? 0) + 1);
    total++;
  }
}

/** Visible enemy units near any owned structure. */
function threats(t: Think, snap: Snapshot): Entity[] {
  const { world, player, knobs } = t;
  const r = knobs.defenseRadius * world.subTile;
  const found: Entity[] = [];
  for (const entity of world.entities) {
    if (entity.kind !== 'unit' || entity.owner < 0 || entity.owner === player.index || entity.hp <= 0) continue;
    if (!canSee(world, player.index, entity)) continue;
    if (snap.buildings.some(b => (b.x - entity.x) ** 2 + (b.y - entity.y) ** 2 <= r * r)) found.push(entity);
  }
  return found;
}

function idle(unit: Entity): boolean {
  return unit.amove < 0 && unit.attack < 0 && unit.next < 0 && unit.moveState !== MoveState.Pending;
}

function tileXY(world: World, tile: number): { x: number; y: number } {
  return { x: tile % world.nav.width, y: (tile / world.nav.width) | 0 };
}

/** Answer threats with units not committed to a wave; send them home once it is calm. */
function defend(t: Think, snap: Snapshot): void {
  const { world, state, knobs } = t;
  const seen = threats(t, snap);
  const inWave = new Set(state.wave);
  const home = snap.army.filter(u => !inWave.has(u.id));
  if (seen.length) {
    state.threatTick = world.tick;
    const anchor = snap.hq ?? snap.buildings[0];
    seen.sort((a, b) => ((a.x - anchor.x) ** 2 + (a.y - anchor.y) ** 2) - ((b.x - anchor.x) ** 2 + (b.y - anchor.y) ** 2) || a.id - b.id);
    const target = seen[0];
    const ids = home.filter(u => idle(u) || !state.defenders.includes(u.id)).map(u => u.id);
    if (ids.length) {
      const s = world.subTile;
      if (t.issue({ kind: 'amove', ids, x: Math.floor(target.x / s), y: Math.floor(target.y / s) })) {
        t.log(`defend with ${ids.length} against ${target.type}`);
        for (const id of ids) if (!state.defenders.includes(id)) state.defenders.push(id);
      }
    }
    return;
  }
  if (state.defenders.length && world.tick - state.threatTick >= knobs.defenseCalmTicks && state.home >= 0) {
    const ids = state.defenders.filter(id => { const u = world.get(id); return u && idle(u); });
    const { x, y } = tileXY(world, state.home);
    if (ids.length && t.issue({ kind: 'move', ids, x, y })) t.log(`defenders return home (${ids.length})`);
    state.defenders = [];
  }
}

/** Nearest remembered hostile structure to a point, else the enemy's declared start sector. */
function waveTarget(t: Think, fromX: number, fromY: number): number {
  const { player } = t;
  let best = -1;
  let bestD = Infinity;
  for (const record of player.fog.memory.values()) {
    if (record.owner < 0 || record.owner === player.index) continue;
    const d = (record.x - fromX) ** 2 + (record.y - fromY) ** 2;
    if (d < bestD || (d === bestD && record.tile < best)) { bestD = d; best = record.tile; }
  }
  return best >= 0 ? best : enemyStart(t);
}

/** Launch escalating waves from actual units, keep them moving, and record arrival. */
function waves(t: Think, snap: Snapshot): void {
  const { world, state, knobs } = t;
  const s = world.subTile;
  const current = state.waves[state.waves.length - 1];
  if (state.wave.length && current) {
    const members = state.wave.map(id => world.get(id)!);
    const tx = (current.target % world.nav.width + 0.5) * s;
    const ty = (((current.target / world.nav.width) | 0) + 0.5) * s;
    if (current.arrivedTick < 0 && members.some(u => (u.x - tx) ** 2 + (u.y - ty) ** 2 <= (12 * s) ** 2)) {
      current.arrivedTick = world.tick;
      t.log(`wave ${current.index} arrived`);
    }
    // Most of the wave idle: push on to the next known target or disband at the enemy start.
    if (members.filter(idle).length * 2 >= members.length) {
      const cx = members.reduce((sum, u) => sum + u.x, 0) / members.length;
      const cy = members.reduce((sum, u) => sum + u.y, 0) / members.length;
      const next = waveTarget(t, cx, cy);
      const nx = (next % world.nav.width + 0.5) * s;
      const ny = (((next / world.nav.width) | 0) + 0.5) * s;
      if (next < 0 || (cx - nx) ** 2 + (cy - ny) ** 2 <= (4 * s) ** 2) {
        t.log(`wave ${current.index} disbanded; returning home`);
        if (state.home >= 0) {
          const { x, y } = tileXY(world, state.home);
          t.issue({ kind: 'move', ids: state.wave.slice(), x, y });
        }
        state.wave = [];
      } else {
        const { x, y } = tileXY(world, next);
        if (t.issue({ kind: 'amove', ids: state.wave.slice(), x, y })) current.target = next;
      }
    }
    return;
  }
  if (world.tick < state.nextWaveTick || !snap.hq) return;
  const size = Math.min(knobs.waveMaxSize, knobs.waveStartSize + knobs.waveGrowth * state.waveIndex);
  const recentThreat = world.tick - state.threatTick < knobs.defenseCalmTicks;
  const available = snap.army.filter(u => !state.defenders.includes(u.id));
  if (recentThreat || available.length - knobs.defenseReserve < size) {
    if (!state.waveDelayed) t.log(`wave ${state.waveIndex} delayed: ${available.length} available, need ${size} + reserve ${knobs.defenseReserve}`);
    state.waveDelayed = true;
    return;
  }
  // Draw the wave from units gathered nearest home; the rest stay as the reserve.
  if (state.home >= 0) {
    const hx = (state.home % world.nav.width + 0.5) * s;
    const hy = (((state.home / world.nav.width) | 0) + 0.5) * s;
    available.sort((a, b) => ((a.x - hx) ** 2 + (a.y - hy) ** 2) - ((b.x - hx) ** 2 + (b.y - hy) ** 2) || a.id - b.id);
  }
  // Mixed arms: take the nearest unit of each type in turn (types ordered by their nearest unit).
  const byType = new Map<string, Entity[]>();
  for (const unit of available) {
    const list = byType.get(unit.type);
    if (list) list.push(unit);
    else byType.set(unit.type, [unit]);
  }
  // Commit a share of the surplus army when it outgrows the scheduled size (never above the maximum).
  const committed = Math.min(knobs.waveMaxSize, Math.max(size, Math.floor((available.length - knobs.defenseReserve) * knobs.waveCommitPercent / 100)));
  const chosen: Entity[] = [];
  for (let round = 0; chosen.length < committed; round++) {
    let added = false;
    for (const list of byType.values()) {
      if (round < list.length && chosen.length < committed) { chosen.push(list[round]); added = true; }
    }
    if (!added) break;
  }
  const target = waveTarget(t, snap.hq.x, snap.hq.y);
  if (target < 0) return;
  const { x, y } = tileXY(world, target);
  if (!t.issue({ kind: 'amove', ids: chosen.map(u => u.id), x, y })) return;
  const composition: Record<string, number> = {};
  for (const unit of chosen) composition[unit.type] = (composition[unit.type] ?? 0) + 1;
  state.waves.push({ index: state.waveIndex, launchTick: world.tick, size: chosen.length, composition, target, arrivedTick: -1 });
  state.wave = chosen.map(u => u.id);
  t.log(`wave ${state.waveIndex} launched: ${chosen.length} units → ${x},${y}`);
  state.waveIndex++;
  state.waveDelayed = false;
  state.nextWaveTick = world.tick + knobs.waveIntervalTicks;
}
