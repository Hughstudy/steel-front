import type { BuildingDef, FactionDef } from '../sim/rules.ts';
import { box, cross, flat, poly, project, shade, star } from './iso-shapes.ts';

/** A baked building image anchored at its footprint centre. */
export interface BuildingSprite {
  canvas: HTMLCanvasElement;
  anchorX: number;
  anchorY: number;
  /** Projected half extents of the footprint diamond, for hit testing. */
  halfWidth: number;
  halfHeight: number;
  top: number;
}

const CONCRETE = '#9a9886';
const SANDBAG = '#b4a479';
const ROOF = '#5d6150';
const NEUTRAL = '#8b8a7b';

type Painter = (c: CanvasRenderingContext2D, w: number, h: number, faction: FactionDef | null, p: Record<string, number>) => void;

function slab(c: CanvasRenderingContext2D, w: number, h: number, color: string, inset = 0.05): void {
  box(c, 0, 0, 0, w - inset * 2, h - inset * 2, 0, 2, { color, top: shade(color, 1.04) });
}

function mark(c: CanvasRenderingContext2D, faction: FactionDef | null, u: number, v: number, z: number, size: number): void {
  if (!faction) return;
  if (faction.insignia === 'star') star(c, u, v, 0, z, size, faction.trim);
  else cross(c, u, v, 0, z, size * 0.8, '#1c1d1d', '#e8e6dc');
}

function flag(c: CanvasRenderingContext2D, u: number, v: number, base: number, color: string): void {
  const [x0, y0] = project(u, v, base);
  const [, y1] = project(u, v, base + 30);
  c.strokeStyle = '#3d3a30';
  c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0, y1); c.stroke();
  c.fillStyle = color;
  c.beginPath(); c.moveTo(x0, y1); c.lineTo(x0 + 11, y1 + 3); c.lineTo(x0, y1 + 7); c.closePath(); c.fill();
}

function sandbags(c: CanvasRenderingContext2D, from: [number, number], to: [number, number]): void {
  const steps = Math.max(2, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.16));
  for (let i = 0; i <= steps; i++) {
    const u = from[0] + (to[0] - from[0]) * i / steps;
    const v = from[1] + (to[1] - from[1]) * i / steps;
    const [x, y] = project(u, v, 3);
    c.fillStyle = i % 2 ? SANDBAG : shade(SANDBAG, 0.88);
    c.beginPath(); c.ellipse(x, y, 4.2, 2.6, 0, 0, Math.PI * 2); c.fill();
  }
}

const painters: Record<string, Painter> = {
  hq(c, w, h, faction) {
    const hull = faction?.hull ?? NEUTRAL;
    slab(c, w, h, CONCRETE);
    sandbags(c, [-w / 2 + 0.1, h / 2 - 0.1], [w / 2 - 0.1, h / 2 - 0.1]);
    sandbags(c, [w / 2 - 0.1, -h / 2 + 0.1], [w / 2 - 0.1, h / 2 - 0.1]);
    box(c, -0.15, -0.15, 0, w * 0.6, h * 0.55, 2, 26, { color: faction?.insignia === 'cross' ? '#8f9188' : '#9b9172' });
    box(c, -0.15, -0.15, 0, w * 0.64, h * 0.6, 26, 30, { color: ROOF, taper: 0.06 });
    mark(c, faction, -0.15, -0.15, 30.3, 9);
    box(c, 0.75, 0.5, 0, 0.5, 0.42, 2, 16, { color: hull });
    box(c, 0.75, 0.5, 0, 0.56, 0.48, 16, 19, { color: shade(hull, 0.8), taper: 0.25 });
    // Radio mast with guy wires.
    const [mx, my] = project(-0.9, 0.55, 2);
    const [, mt] = project(-0.9, 0.55, 62);
    c.strokeStyle = '#4b4a40'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(mx, my); c.lineTo(mx, mt); c.stroke();
    c.strokeStyle = 'rgba(60,60,52,.6)'; c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(mx, mt + 4); c.lineTo(mx - 12, my + 2); c.moveTo(mx, mt + 4); c.lineTo(mx + 12, my + 4); c.stroke();
    flag(c, 0.95, -1.1, 2, faction?.team ?? '#888');
  },
  dump(c, w, h) {
    flat(c, 0, 0, 0, 0.5, [[-w / 2 + 0.1, -h / 2 + 0.1], [w / 2 - 0.1, -h / 2 + 0.1], [w / 2 - 0.1, h / 2 - 0.1], [-w / 2 + 0.1, h / 2 - 0.1]], '#8d8360');
    const crates: Array<[number, number, number]> = [[-0.45, -0.4, 0], [-0.05, -0.45, 0], [-0.4, 0.05, 0], [-0.42, -0.42, 1], [0.35, 0.35, 0]];
    for (const [u, v, level] of crates) box(c, u, v, 0, 0.36, 0.36, level * 12, level * 12 + 12, { color: '#9c8456', top: '#b39a68' });
    for (const [u, v] of [[0.35, -0.3], [0.5, -0.05], [0.15, 0.55], [0.5, 0.6]] as Array<[number, number]>) {
      const [x, y] = project(u, v, 0);
      c.fillStyle = '#56604a'; c.fillRect(x - 4, y - 13, 8, 13);
      c.fillStyle = '#6d7a5c'; c.beginPath(); c.ellipse(x, y - 13, 4, 2, 0, 0, Math.PI * 2); c.fill();
    }
    // Camouflage net over the stack.
    flat(c, -0.2, -0.2, 0, 26, [[-0.45, -0.45], [0.35, -0.45], [0.35, 0.35], [-0.45, 0.35]], 'rgba(79,96,62,.55)');
  },
  supply_source(c, w, h, faction, params) {
    painters.dump(c, w, h, faction, params);
    // A standing infinity sign distinguishes replenishing yards from finite stacks.
    const [x, y] = project(0.65, -0.65, 0);
    c.fillStyle = '#494c40'; c.fillRect(x - 1, y - 35, 2, 35);
    c.fillStyle = '#2b403b'; c.fillRect(x - 13, y - 40, 26, 18);
    c.strokeStyle = '#d4d9ad'; c.lineWidth = 1; c.strokeRect(x - 13, y - 40, 26, 18);
    c.fillStyle = '#f1efce'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('∞', x, y - 31);
  },
  derrick(c, w, h, faction) {
    flat(c, 0, 0, 0, 0.5, [[-w / 2 + 0.1, -h / 2 + 0.1], [w / 2 - 0.1, -h / 2 + 0.1], [w / 2 - 0.1, h / 2 - 0.1], [-w / 2 + 0.1, h / 2 - 0.1]], '#4d4a3d');
    // Storage tanks.
    for (const [u, v] of [[0.45, 0.35], [0.45, -0.25]] as Array<[number, number]>) {
      const [x, y] = project(u, v, 0);
      c.fillStyle = '#7d7a68'; c.fillRect(x - 9, y - 18, 18, 18);
      c.fillStyle = '#9a9784'; c.beginPath(); c.ellipse(x, y - 18, 9, 4.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#6a6858'; c.beginPath(); c.ellipse(x, y, 9, 4.5, 0, 0, Math.PI); c.fill();
    }
    // Lattice tower.
    const legs: Array<[number, number]> = [[-0.6, -0.6], [0.0, -0.6], [0.0, 0.0], [-0.6, 0.0]];
    const apex = project(-0.3, -0.3, 64);
    c.strokeStyle = '#3e3b30'; c.lineWidth = 1.4;
    for (const [u, v] of legs) { const [x, y] = project(u, v, 0); c.beginPath(); c.moveTo(x, y); c.lineTo(apex[0], apex[1]); c.stroke(); }
    c.lineWidth = 0.7;
    for (let level = 1; level < 5; level++) {
      const t = level / 5;
      c.beginPath();
      legs.forEach(([u, v], i) => {
        const [x, y] = project(u + (-0.3 - u) * t, v + (-0.3 - v) * t, 64 * t);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      });
      c.closePath(); c.stroke();
    }
    flag(c, -0.3, -0.3, 64, faction?.team ?? '#c8c4b0');
  },
  power(c, w, h, faction) {
    slab(c, w, h, CONCRETE);
    box(c, -0.1, 0.05, 0, w * 0.7, h * 0.55, 2, 22, { color: '#8d8a78' });
    box(c, -0.1, 0.05, 0, w * 0.74, h * 0.6, 22, 25, { color: ROOF });
    for (const v of [-0.55, -0.1]) {
      const [x, y] = project(-0.55, v, 20);
      c.fillStyle = '#6f6b5d'; c.fillRect(x - 3.5, y - 34, 7, 34);
      c.fillStyle = '#4b4940'; c.beginPath(); c.ellipse(x, y - 34, 3.5, 1.8, 0, 0, Math.PI * 2); c.fill();
    }
    box(c, 0.6, 0.6, 0, 0.32, 0.32, 2, 13, { color: faction?.hull ?? NEUTRAL });
    c.strokeStyle = '#d7c86f'; c.lineWidth = 1.2;
    const [zx, zy] = project(0.25, 0.6, 15);
    c.beginPath(); c.moveTo(zx, zy - 6); c.lineTo(zx - 3, zy); c.lineTo(zx + 1, zy); c.lineTo(zx - 2, zy + 6); c.stroke();
    mark(c, faction, -0.1, 0.05, 25.3, 6);
  },
  barracks(c, w, h, faction) {
    slab(c, w, h, '#8f8a6e');
    const color = faction?.insignia === 'cross' ? '#857a62' : '#7c7d5d';
    box(c, 0, 0, 0, w * 0.82, h * 0.5, 2, 14, { color });
    // Pitched roof as two sloped quads.
    const half = h * 0.28;
    const len = w * 0.44;
    poly(c, [project(-len, -half, 14), project(len, -half, 14), project(len, 0, 24), project(-len, 0, 24)], shade(ROOF, 0.9));
    poly(c, [project(-len, half, 14), project(len, half, 14), project(len, 0, 24), project(-len, 0, 24)], shade(ROOF, 1.1));
    sandbags(c, [-w / 2 + 0.1, h / 2 - 0.08], [0.2, h / 2 - 0.08]);
    mark(c, faction, len * 0.3, half * 0.3, 21, 5);
    flag(c, w / 2 - 0.2, -h / 2 + 0.25, 2, faction?.team ?? '#888');
  },
  factory(c, w, h, faction) {
    slab(c, w, h, CONCRETE);
    box(c, -0.2, -0.1, 0, w * 0.72, h * 0.78, 2, 30, { color: '#87887a' });
    // Curved hangar roof approximated with three tapered slabs.
    box(c, -0.2, -0.1, 0, w * 0.74, h * 0.8, 30, 34, { color: ROOF });
    box(c, -0.2, -0.1, 0, w * 0.74, h * 0.55, 34, 38, { color: shade(ROOF, 1.05) });
    // Big door on the +u face.
    const du = -0.2 + w * 0.36;
    poly(c, [project(du + 0.01, -0.75, 2), project(du + 0.01, 0.55, 2), project(du + 0.01, 0.55, 24), project(du + 0.01, -0.75, 24)], '#4a4b42');
    for (let i = 1; i < 6; i++) {
      const v = -0.75 + i * 0.22;
      const [x0, y0] = project(du + 0.02, v, 2);
      const [x1, y1] = project(du + 0.02, v, 24);
      c.strokeStyle = '#5e5f54'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    flat(c, du + 0.25, -0.1, 0, 2.3, [[-0.22, -0.7], [0.22, -0.7], [0.22, 0.6], [-0.22, 0.6]], faction?.team ?? '#888');
    mark(c, faction, -0.4, -0.1, 38.3, 9);
    box(c, -1.2, 1.1, 0, 0.3, 0.3, 2, 44, { color: '#6d6b5c' });
  },
  airfield(c, w, h, faction) {
    flat(c, 0, 0, 0, 0.5, [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], '#7f7d66');
    flat(c, 0.2, 0, 0, 0.8, [[-w / 2 + 0.1, -0.35], [w / 2 - 0.1, -0.35], [w / 2 - 0.1, 0.35], [-w / 2 + 0.1, 0.35]], '#6d6c5f');
    for (let i = 0; i < 6; i++) {
      const u = -w / 2 + 0.4 + i * (w - 0.6) / 6;
      flat(c, u, 0, 0, 1, [[-0.1, -0.03], [0.1, -0.03], [0.1, 0.03], [-0.1, 0.03]], '#d7d2b2');
    }
    box(c, -0.9, -1.0, 0, 0.9, 0.7, 0, 18, { color: '#868372' });
    box(c, -0.9, -1.0, 0, 0.95, 0.75, 18, 22, { color: ROOF, taper: 0.12 });
    box(c, 1.0, -1.05, 0, 0.32, 0.32, 0, 30, { color: '#8b8774' });
    box(c, 1.0, -1.05, 0, 0.42, 0.42, 30, 36, { color: '#5b6b6b', top: '#9fb4b0' });
    mark(c, faction, -0.9, -1.0, 22.3, 7);
    // Windsock.
    const [x, y] = project(1.3, 1.2, 0);
    c.strokeStyle = '#3d3a30'; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 22); c.stroke();
    c.fillStyle = '#d8763a'; c.beginPath(); c.moveTo(x, y - 22); c.lineTo(x + 10, y - 19); c.lineTo(x, y - 17); c.fill();
  },
  depot(c, w, h, faction) {
    flat(c, 0, 0, 0, 0.5, [[-w / 2 + 0.05, -h / 2 + 0.05], [w / 2 - 0.05, -h / 2 + 0.05], [w / 2 - 0.05, h / 2 - 0.05], [-w / 2 + 0.05, h / 2 - 0.05]], '#8d8664');
    box(c, -0.3, -0.3, 0, 0.7, 0.7, 0, 14, { color: faction?.hull ?? NEUTRAL });
    box(c, -0.3, -0.3, 0, 0.78, 0.78, 14, 17, { color: ROOF });
    for (const [u, v] of [[0.45, -0.1], [0.45, 0.4], [0.0, 0.45]] as Array<[number, number]>) box(c, u, v, 0, 0.3, 0.3, 0, 10, { color: '#9c8456', top: '#b39a68' });
    mark(c, faction, -0.3, -0.3, 17.3, 5);
  },
  pillbox(c, _w, _h, faction) {
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) points.push([Math.cos(i * Math.PI / 3) * 0.4, Math.sin(i * Math.PI / 3) * 0.4]);
    for (let i = 0; i < 6; i++) {
      const a = points[i];
      const b = points[(i + 1) % 6];
      if (a[0] + a[1] + b[0] + b[1] < -0.1) continue;
      poly(c, [project(a[0], a[1], 0), project(b[0], b[1], 0), project(b[0], b[1], 13), project(a[0], a[1], 13)], shade(CONCRETE, 0.75 + 0.06 * i));
    }
    poly(c, points.map(([u, v]) => project(u, v, 13)), shade(CONCRETE, 1.05));
    const [x, y] = project(0.38, 0.1, 8);
    c.fillStyle = '#2b2c27'; c.fillRect(x - 6, y - 1.5, 9, 3);
    mark(c, faction, 0, 0, 13.3, 4);
  },
  atpillbox(c, w, h, faction) {
    painters.pillbox(c, w, h, faction, {});
    const [x0, y0] = project(0.1, 0.1, 9);
    const [x1, y1] = project(0.75, 0.55, 10);
    c.strokeStyle = '#3e3f37'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  },
};

/** Bake one building sprite. Runs at load time, never per frame. */
export function bakeBuilding(def: BuildingDef, faction: FactionDef | null): BuildingSprite {
  const { w, h } = def.footprint;
  const halfWidth = (w + h) * 16;
  const halfHeight = (w + h) * 8;
  const top = 72;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(halfWidth * 2 + 24);
  canvas.height = Math.ceil(halfHeight * 2 + top + 12);
  const context = canvas.getContext('2d')!;
  const anchorX = canvas.width / 2;
  const anchorY = top + halfHeight + 4;
  context.translate(anchorX, anchorY);
  context.lineJoin = 'round';
  // Soft footprint shadow.
  context.fillStyle = 'rgba(20,28,20,.18)';
  poly(context, [project(-w / 2 - 0.08, -h / 2 + 0.1, 0), project(w / 2 + 0.12, -h / 2 + 0.1, 0), project(w / 2 + 0.12, h / 2 + 0.14, 0), project(-w / 2 - 0.08, h / 2 + 0.14, 0)], 'rgba(20,28,20,.18)');
  (painters[def.visual.archetype] ?? painters.depot)(context, w, h, faction, def.visual.params);
  return { canvas, anchorX, anchorY, halfWidth, halfHeight, top };
}

