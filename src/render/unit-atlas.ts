import type { FactionDef, UnitVisual } from '../sim/rules.ts';
import { box, cross, ellipseShadow, flat, local, project, shade, star, wheel } from './iso-shapes.ts';

export const DIRECTIONS = 16;

/** One baked sheet: DIRECTIONS rows × frames columns. Anchor = ground centre. */
export interface SpriteSheet {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  frames: number;
}

export interface UnitSprites {
  body: SpriteSheet;
  /** Present for turreted vehicles; drawn at `turretOffset` along the hull heading. */
  turret: SpriteSheet | null;
  turretOffset: number;
  infantry: boolean;
  /** Selection ellipse radius in projected pixels. */
  radius: number;
  /** Height of the sprite above ground (health bar placement). */
  top: number;
  air: boolean;
}

type Painter = (context: CanvasRenderingContext2D, heading: number, frame: number) => void;

function sheet(width: number, height: number, anchorX: number, anchorY: number, frames: number, paint: Painter): SpriteSheet {
  const canvas = document.createElement('canvas');
  canvas.width = width * frames;
  canvas.height = height * DIRECTIONS;
  const context = canvas.getContext('2d')!;
  for (let dir = 0; dir < DIRECTIONS; dir++) {
    for (let frame = 0; frame < frames; frame++) {
      context.save();
      context.beginPath();
      context.rect(frame * width, dir * height, width, height);
      context.clip();
      context.translate(frame * width + anchorX, dir * height + anchorY);
      context.lineJoin = 'round';
      context.lineCap = 'round';
      paint(context, dir / DIRECTIONS * Math.PI * 2, frame);
      context.restore();
    }
  }
  return { canvas, width, height, anchorX, anchorY, frames };
}

const TRACK = '#3b3a31';
const RUBBER = '#2c2d29';

function insignia(context: CanvasRenderingContext2D, faction: FactionDef, cu: number, cv: number, heading: number, z: number, size: number): void {
  if (faction.insignia === 'star') star(context, cu, cv, heading, z, size, faction.trim);
  else cross(context, cu, cv, heading, z, size * 0.8, '#1c1d1d', '#e8e6dc');
}

/** Draw parts back-to-front by their depth (u + v) toward the viewer. */
function ordered(parts: Array<{ depth: number; draw: () => void }>): void {
  parts.sort((a, b) => a.depth - b.depth);
  for (const part of parts) part.draw();
}

function tracks(context: CanvasRenderingContext2D, heading: number, length: number, width: number, trackWidth: number, height: number, frame: number): Array<{ depth: number; draw: () => void }> {
  const parts = [];
  for (const side of [-1, 1]) {
    const [u, v] = local(0, 0, heading, 0, side * (width / 2 - trackWidth / 2));
    parts.push({
      depth: u + v,
      draw: () => {
        box(context, u, v, heading, length, trackWidth, 0, height, { color: TRACK, top: '#4a483c' });
        // Road wheels / tread marks along the outer face.
        for (let i = 0; i < 5; i++) {
          const f = -length / 2 + (i + 0.5 + (frame % 2) * 0.5) * length / 5.5;
          const [wu, wv] = local(u, v, heading, f, side * trackWidth / 2);
          const [x, y] = project(wu, wv, height * 0.45);
          context.fillStyle = '#25261f';
          context.fillRect(x - 1, y - 1, 2, 2);
        }
      },
    });
  }
  return parts;
}

function tankHull(context: CanvasRenderingContext2D, faction: FactionDef, p: Record<string, number>, heading: number, frame: number): void {
  const s = p.scale ?? 1;
  const length = (p.length ?? 0.72) * s;
  const width = (p.width ?? 0.46) * s;
  const height = (p.height ?? 9) * s;
  const trackWidth = width * 0.24;
  ellipseShadow(context, 26 * s, 13 * s);
  const parts = tracks(context, heading, length, width, trackWidth, height * 0.55, frame);
  parts.push({
    depth: 0,
    draw: () => {
      box(context, 0, 0, heading, length * 0.96, width * 0.7, height * 0.35, height, { color: faction.hull, taper: p.slope ?? 0.12 });
      // Engine deck grille and team-colour trim on the rear deck.
      flat(context, 0, 0, heading, height + 0.2, [[-length * 0.42, -width * 0.2], [-length * 0.26, -width * 0.2], [-length * 0.26, width * 0.2], [-length * 0.42, width * 0.2]], shade(faction.hull, 0.78));
      flat(context, 0, 0, heading, height + 0.25, [[-length * 0.46, -width * 0.3], [-length * 0.42, -width * 0.3], [-length * 0.42, width * 0.3], [-length * 0.46, width * 0.3]], faction.team);
    },
  });
  ordered(parts);
}

function tankTurret(context: CanvasRenderingContext2D, faction: FactionDef, p: Record<string, number>, heading: number): void {
  const s = p.scale ?? 1;
  const z = (p.height ?? 9) * s;
  const tl = (p.turretLength ?? 0.34) * s;
  const tw = (p.turretWidth ?? 0.29) * s;
  const th = (p.turretHeight ?? 7) * s;
  const barrel = (p.barrel ?? 0.4) * s;
  const bw = (p.barrelWidth ?? 0.045) * s;
  const [bu, bv] = local(0, 0, heading, tl / 2 + barrel / 2 - 0.02, 0);
  const drawBarrel = (): void => {
    box(context, bu, bv, heading, barrel, bw, z + th * 0.35, z + th * 0.35 + bw * 26, { color: shade(faction.hull, 0.82) });
    if (p.muzzleBrake) {
      const [mu, mv] = local(0, 0, heading, tl / 2 + barrel - 0.02, 0);
      box(context, mu, mv, heading, 0.05 * s, bw * 1.8, z + th * 0.3, z + th * 0.35 + bw * 30, { color: shade(faction.hull, 0.7) });
    }
  };
  const drawTurret = (): void => {
    box(context, 0, 0, heading, tl, tw, z, z + th, { color: faction.hullLight, taper: p.turretTaper ?? 0.22 });
    insignia(context, faction, 0, 0, heading, z + th + 0.3, 3.4 * s);
    // Commander hatch.
    const [hu, hv] = local(0, 0, heading, -tl * 0.18, -tw * 0.18);
    const [hx, hy] = project(hu, hv, z + th + 0.4);
    context.fillStyle = shade(faction.hull, 0.6);
    context.beginPath(); context.ellipse(hx, hy, 2.4 * s, 1.3 * s, 0, 0, Math.PI * 2); context.fill();
  };
  ordered([{ depth: 0, draw: drawTurret }, { depth: bu + bv, draw: drawBarrel }]);
}

function halftrack(context: CanvasRenderingContext2D, faction: FactionDef, p: Record<string, number>, heading: number): void {
  const s = p.scale ?? 1;
  const length = 0.74 * s;
  const width = 0.4 * s;
  ellipseShadow(context, 25 * s, 12 * s);
  const parts: Array<{ depth: number; draw: () => void }> = [];
  for (const side of [-1, 1]) {
    const [ru, rv] = local(0, 0, heading, -length * 0.18, side * width * 0.38);
    parts.push({ depth: ru + rv, draw: () => box(context, ru, rv, heading, length * 0.55, width * 0.22, 0, 5 * s, { color: TRACK }) });
    const [wu, wv] = local(0, 0, heading, length * 0.36, side * width * 0.42);
    parts.push({ depth: wu + wv, draw: () => wheel(context, wu, wv, heading, 3.4 * s, RUBBER, '#6d6a58') });
  }
  parts.push({
    depth: 0,
    draw: () => {
      const [cu, cv] = local(0, 0, heading, -length * 0.1, 0);
      box(context, cu, cv, heading, length * 0.66, width * 0.78, 4 * s, 11 * s, { color: faction.hull, taper: 0.04 });
      flat(context, cu, cv, heading, 11.1 * s, [[-length * 0.3, -width * 0.3], [length * 0.3, -width * 0.3], [length * 0.3, width * 0.3], [-length * 0.3, width * 0.3]], shade(faction.hull, 0.55));
      const [hu, hv] = local(0, 0, heading, length * 0.34, 0);
      box(context, hu, hv, heading, length * 0.28, width * 0.6, 4 * s, 9 * s, { color: faction.hullLight, taper: 0.2 });
      insignia(context, faction, hu, hv, heading, 9.3 * s, 2.6 * s);
      // Pintle machine gun.
      const [mu, mv] = local(0, 0, heading, length * 0.1, 0);
      const [x0, y0] = project(mu, mv, 12 * s);
      const [m2u, m2v] = local(0, 0, heading, length * 0.3, 0);
      const [x1, y1] = project(m2u, m2v, 13 * s);
      context.strokeStyle = '#2a2b26'; context.lineWidth = 1.4;
      context.beginPath(); context.moveTo(x0, y0); context.lineTo(x1, y1); context.stroke();
      flat(context, cu, cv, heading, 11.2 * s, [[-length * 0.33, -width * 0.39], [-length * 0.3, -width * 0.39], [-length * 0.3, width * 0.39], [-length * 0.33, width * 0.39]], faction.team);
    },
  });
  ordered(parts);
}

function truck(context: CanvasRenderingContext2D, faction: FactionDef, p: Record<string, number>, heading: number, frame: number): void {
  const s = p.scale ?? 1;
  const length = (p.length ?? 0.76) * s;
  const width = 0.38 * s;
  const loaded = frame === 1;
  ellipseShadow(context, 24 * s, 12 * s);
  const parts: Array<{ depth: number; draw: () => void }> = [];
  for (const side of [-1, 1]) {
    for (const f of [0.3, -0.12, -0.3]) {
      const [wu, wv] = local(0, 0, heading, length * f, side * width * 0.45);
      parts.push({ depth: wu + wv, draw: () => wheel(context, wu, wv, heading, 3.2 * s, RUBBER, '#6d6a58') });
    }
  }
  parts.push({
    depth: 0,
    draw: () => {
      const [bu, bv] = local(0, 0, heading, -length * 0.14, 0);
      box(context, bu, bv, heading, length * 0.64, width * 0.9, 4 * s, 8 * s, { color: shade(faction.hull, 0.9) });
      if (loaded) {
        for (let i = 0; i < 3; i++) {
          const [cu, cv] = local(bu, bv, heading, (i - 1) * length * 0.18, 0);
          box(context, cu, cv, heading, length * 0.15, width * 0.62, 8 * s, 13 * s, { color: '#9c8456', top: '#b39a68' });
        }
      }
      const [cu, cv] = local(0, 0, heading, length * 0.32, 0);
      box(context, cu, cv, heading, length * 0.26, width * 0.86, 4 * s, 13 * s, { color: faction.hullLight, taper: 0.12 });
      insignia(context, faction, cu, cv, heading, 13.2 * s, 2.4 * s);
      flat(context, bu, bv, heading, 8.1 * s, [[-length * 0.33, -width * 0.46], [-length * 0.27, -width * 0.46], [-length * 0.27, width * 0.46], [-length * 0.33, width * 0.46]], faction.team);
    },
  });
  ordered(parts);
}

function mcv(context: CanvasRenderingContext2D, faction: FactionDef, p: Record<string, number>, heading: number, frame: number): void {
  const s = p.scale ?? 1;
  const length = 0.95 * s;
  const width = 0.52 * s;
  ellipseShadow(context, 32 * s, 16 * s);
  const parts = tracks(context, heading, length, width, width * 0.22, 6 * s, frame);
  parts.push({
    depth: 0,
    draw: () => {
      box(context, 0, 0, heading, length * 0.95, width * 0.74, 4 * s, 13 * s, { color: faction.hull });
      const [ru, rv] = local(0, 0, heading, -length * 0.12, 0);
      box(context, ru, rv, heading, length * 0.5, width * 0.6, 13 * s, 21 * s, { color: faction.hullLight, taper: 0.08 });
      flat(context, ru, rv, heading, 21.2 * s, [[-length * 0.2, -width * 0.31], [length * 0.2, -width * 0.31], [length * 0.2, -width * 0.24], [-length * 0.2, -width * 0.24]], faction.team);
      flat(context, ru, rv, heading, 21.2 * s, [[-length * 0.2, width * 0.24], [length * 0.2, width * 0.24], [length * 0.2, width * 0.31], [-length * 0.2, width * 0.31]], faction.team);
      insignia(context, faction, ru, rv, heading, 21.4 * s, 4 * s);
      const [cu, cv] = local(0, 0, heading, length * 0.36, 0);
      box(context, cu, cv, heading, length * 0.18, width * 0.66, 13 * s, 18 * s, { color: shade(faction.hull, 0.9), taper: 0.25 });
      // Folded crane boom.
      const [a0, a1] = project(...local(0, 0, heading, -length * 0.3, width * 0.2), 22 * s);
      const [b0, b1] = project(...local(0, 0, heading, length * 0.3, width * 0.2), 26 * s);
      context.strokeStyle = shade(faction.hull, 0.6); context.lineWidth = 2.2 * s;
      context.beginPath(); context.moveTo(a0, a1); context.lineTo(b0, b1); context.stroke();
    },
  });
  ordered(parts);
}

function towedGun(context: CanvasRenderingContext2D, faction: FactionDef, p: Record<string, number>, heading: number, frame: number, artillery: boolean): void {
  const s = p.scale ?? 1;
  ellipseShadow(context, 22 * s, 11 * s, 0.22);
  const parts: Array<{ depth: number; draw: () => void }> = [];
  const barrel = (p.barrel ?? (artillery ? 0.62 : 0.5)) * s;
  for (const side of [-1, 1]) {
    const [wu, wv] = local(0, 0, heading, 0, side * 0.17 * s);
    parts.push({ depth: wu + wv, draw: () => wheel(context, wu, wv, heading, 4 * s, RUBBER, '#6d6a58') });
    const [tu, tv] = local(0, 0, heading, -0.24 * s, side * 0.07 * s);
    parts.push({ depth: tu + tv - 0.1, draw: () => box(context, tu, tv, heading + side * 0.25, 0.4 * s, 0.035 * s, 1, 3 * s, { color: shade(faction.hull, 0.75) }) });
  }
  const [bu, bv] = local(0, 0, heading, barrel * 0.42, 0);
  parts.push({
    depth: 0.01,
    draw: () => {
      box(context, 0, 0, heading, 0.2 * s, 0.16 * s, 5 * s, 10 * s, { color: faction.hull });
      const lift = artillery ? 7 * s : 0;
      const [x0, y0] = project(...local(0, 0, heading, -0.05 * s, 0), 9 * s);
      const [x1, y1] = project(bu + (bu - 0) * 0.9, bv + (bv - 0) * 0.9, 9 * s + lift);
      context.strokeStyle = shade(faction.hull, 0.6); context.lineWidth = (artillery ? 3.4 : 2.6) * s;
      context.beginPath(); context.moveTo(x0, y0); context.lineTo(x1, y1); context.stroke();
      context.strokeStyle = shade(faction.hull, 0.95); context.lineWidth = 1.1 * s;
      context.beginPath(); context.moveTo(x0, y0 - 0.8); context.lineTo(x1, y1 - 0.8); context.stroke();
      if (!artillery) {
        const [su, sv] = local(0, 0, heading, 0.1 * s, 0);
        box(context, su, sv, heading, 0.02 * s, 0.34 * s, 4 * s, 14 * s, { color: faction.hullLight });
      }
    },
  });
  for (const [f, side] of [[-0.3, -0.18], [-0.34, 0.16]] as Array<[number, number]>) {
    const [cu, cv] = local(0, 0, heading, f * s, side * s);
    parts.push({ depth: cu + cv, draw: () => soldier(context, faction, cu, cv, heading, frame, 'crew', 0.9) });
  }
  ordered(parts);
}

/** A single soldier drawn as a projected figure; `frame` drives the walk cycle. */
function soldier(context: CanvasRenderingContext2D, faction: FactionDef, u: number, v: number, heading: number, frame: number,
  kit: 'rifle' | 'mg' | 'sniper' | 'engineer' | 'crew', scale = 1): void {
  const [x, y] = project(u, v, 0);
  const k = scale;
  const fx = Math.cos(heading) - Math.sin(heading);
  const fy = (Math.cos(heading) + Math.sin(heading)) * 0.5;
  const stride = frame === 0 ? 0 : [0, 1.6, 0, -1.6][frame % 4];
  context.fillStyle = 'rgba(20,28,20,.25)';
  context.beginPath(); context.ellipse(x + 1, y + 0.5, 3.4 * k, 1.6 * k, 0, 0, Math.PI * 2); context.fill();
  // Legs.
  context.strokeStyle = shade(faction.cloth, 0.7);
  context.lineWidth = 1.7 * k;
  context.beginPath();
  context.moveTo(x - 0.8 * k, y - 5 * k); context.lineTo(x - 0.9 * k + fx * stride * k, y + fy * stride * k);
  context.moveTo(x + 0.8 * k, y - 5 * k); context.lineTo(x + 0.9 * k - fx * stride * k, y - fy * stride * k);
  context.stroke();
  // Torso.
  context.fillStyle = kit === 'sniper' ? '#69704f' : faction.cloth;
  context.beginPath(); context.ellipse(x, y - 8 * k, 2.4 * k, 3.6 * k, 0, 0, Math.PI * 2); context.fill();
  if (kit === 'engineer' || kit === 'mg') {
    context.fillStyle = shade(faction.cloth, 0.72);
    context.fillRect(x - fx * 2 * k - 1.8 * k, y - 10 * k, 3.6 * k, 4 * k);
  }
  // Weapon pointing along the heading.
  const length = (kit === 'sniper' ? 9 : kit === 'mg' ? 8 : kit === 'engineer' ? 0 : 6.5) * k;
  if (length > 0) {
    context.strokeStyle = kit === 'mg' ? '#2a2b26' : '#4a3d2c';
    context.lineWidth = (kit === 'mg' ? 1.8 : 1.1) * k;
    context.beginPath();
    context.moveTo(x - fx * 1.5 * k, y - 8 * k - fy * 1.5 * k);
    context.lineTo(x + fx * length * 0.7, y - 8.5 * k + fy * length * 0.7);
    context.stroke();
  }
  // Head and helmet.
  context.fillStyle = faction.skin;
  context.beginPath(); context.arc(x, y - 12.6 * k, 1.8 * k, 0, Math.PI * 2); context.fill();
  context.fillStyle = shade(faction.hull, 0.85);
  context.beginPath();
  if (faction.insignia === 'cross') {
    context.ellipse(x, y - 13.4 * k, 2.5 * k, 1.9 * k, 0, Math.PI, 0);
    context.fillRect(x - 2.6 * k, y - 13.5 * k, 5.2 * k, 1.1 * k);
  } else {
    context.ellipse(x, y - 13.3 * k, 2.9 * k, 1.5 * k, 0, Math.PI, 0);
    context.ellipse(x, y - 13 * k, 3.2 * k, 0.6 * k, 0, 0, Math.PI * 2);
  }
  context.fill();
}

const SQUADS: Record<string, { kit: 'rifle' | 'mg' | 'sniper' | 'engineer'; offsets: Array<[number, number]> }> = {
  squad: { kit: 'rifle', offsets: [[0.12, -0.12], [-0.1, -0.16], [0.08, 0.14], [-0.14, 0.1]] },
  mg: { kit: 'mg', offsets: [[0.06, -0.06], [-0.12, 0.1]] },
  sniper: { kit: 'sniper', offsets: [[0, 0]] },
  engineer: { kit: 'engineer', offsets: [[0.04, -0.04], [-0.1, 0.1]] },
};

function infantry(context: CanvasRenderingContext2D, faction: FactionDef, archetype: string, heading: number, frame: number): void {
  const squad = SQUADS[archetype] ?? SQUADS.squad;
  const figures = squad.offsets.map(([a, b], index) => {
    const [u, v] = local(0, 0, heading, a, b);
    return { u, v, index };
  }).sort((a, b) => (a.u + a.v) - (b.u + b.v));
  for (const figure of figures) {
    const step = frame === 0 ? 0 : 1 + ((frame - 1 + figure.index) % 4);
    soldier(context, faction, figure.u, figure.v, heading, step, squad.kit);
  }
}

function fighter(context: CanvasRenderingContext2D, faction: FactionDef, p: Record<string, number>, heading: number, frame: number): void {
  const s = p.scale ?? 1;
  const z = 0;
  const body = faction.insignia === 'star' ? '#8d8f6c' : '#7f8681';
  flat(context, 0, 0, heading, z, [[0.36 * s, -0.02 * s], [0.4 * s, 0], [0.36 * s, 0.02 * s], [-0.34 * s, 0.03 * s], [-0.36 * s, 0], [-0.34 * s, -0.03 * s]], shade(body, 0.85));
  flat(context, 0, 0, heading, z + 1, [[0.08 * s, -0.42 * s], [0.14 * s, -0.42 * s], [0.18 * s, 0], [0.14 * s, 0.42 * s], [0.08 * s, 0.42 * s], [-0.02 * s, 0]], body);
  flat(context, 0, 0, heading, z + 1, [[-0.26 * s, -0.15 * s], [-0.22 * s, -0.15 * s], [-0.2 * s, 0], [-0.22 * s, 0.15 * s], [-0.26 * s, 0.15 * s], [-0.3 * s, 0]], body);
  box(context, 0.02 * s, 0, heading, 0.62 * s, 0.07 * s, z, z + 4 * s, { color: body, taper: 0.3 });
  const [cu, cv] = local(0, 0, heading, 0.06 * s, 0);
  box(context, cu, cv, heading, 0.12 * s, 0.05 * s, z + 4 * s, z + 6 * s, { color: '#a9b8b4', taper: 0.4 });
  for (const side of [-1, 1]) insignia(context, faction, ...local(0, 0, heading, 0.11 * s, side * 0.28 * s), heading, z + 1.2, 2.6 * s);
  // Spinning propeller disc alternates between frames.
  const [pu, pv] = local(0, 0, heading, 0.41 * s, 0);
  const [x, y] = project(pu, pv, z + 2 * s);
  context.strokeStyle = frame % 2 ? 'rgba(40,40,36,.55)' : 'rgba(40,40,36,.3)';
  context.lineWidth = 1;
  context.beginPath(); context.ellipse(x, y, 5 * s, 2.4 * s, frame * 0.8, 0, Math.PI * 2); context.stroke();
  flat(context, 0, 0, heading, z + 4.2 * s, [[-0.3 * s, -0.012 * s], [-0.18 * s, -0.012 * s], [-0.18 * s, 0.012 * s], [-0.3 * s, 0.012 * s]], faction.team);
}

/** Bake every direction/frame for one unit visual and faction. Runs at load, never per frame. */
export function bakeUnit(visual: UnitVisual, faction: FactionDef): UnitSprites {
  const p = visual.params;
  const s = visual.scale ?? 1;
  switch (visual.archetype) {
    case 'tank':
      return {
        body: sheet(104, 76, 52, 50, 2, (c, h, f) => tankHull(c, faction, p, h, f)),
        turret: sheet(104, 76, 52, 50, 1, (c, h) => tankTurret(c, faction, p, h)),
        turretOffset: (p.turretOffset ?? -0.04) * s, infantry: false, radius: 25 * s, top: 26 * s, air: false,
      };
    case 'halftrack':
      return { body: sheet(96, 72, 48, 48, 1, (c, h) => halftrack(c, faction, p, h)), turret: null, turretOffset: 0, infantry: false, radius: 23 * s, top: 24 * s, air: false };
    case 'truck':
      return { body: sheet(96, 72, 48, 48, 2, (c, h, f) => truck(c, faction, p, h, f)), turret: null, turretOffset: 0, infantry: false, radius: 22 * s, top: 24 * s, air: false };
    case 'mcv':
      return { body: sheet(120, 92, 60, 62, 2, (c, h, f) => mcv(c, faction, p, h, f)), turret: null, turretOffset: 0, infantry: false, radius: 30 * s, top: 36 * s, air: false };
    case 'atgun':
    case 'artillery':
      return { body: sheet(100, 72, 50, 48, 5, (c, h, f) => towedGun(c, faction, p, h, f, visual.archetype === 'artillery')), turret: null, turretOffset: 0, infantry: false, radius: 21 * s, top: 24, air: false };
    case 'fighter':
      return { body: sheet(100, 64, 50, 34, 2, (c, h, f) => fighter(c, faction, p, h, f)), turret: null, turretOffset: 0, infantry: false, radius: 20 * s, top: 18, air: true };
    default:
      return { body: sheet(56, 46, 28, 34, 5, (c, h, f) => infantry(c, faction, visual.archetype, h, f)), turret: null, turretOffset: 0, infantry: true, radius: 14, top: 22, air: false };
  }
}

export function drawSheet(context: CanvasRenderingContext2D, sheet: SpriteSheet, direction: number, frame: number, x: number, y: number): void {
  context.drawImage(sheet.canvas, frame * sheet.width, direction * sheet.height, sheet.width, sheet.height,
    x - sheet.anchorX, y - sheet.anchorY, sheet.width, sheet.height);
}
