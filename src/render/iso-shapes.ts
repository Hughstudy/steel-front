/**
 * Tiny isometric 3D drawing kit for baking sprites. Local coordinates are tile
 * units (u along the +x tile axis, v along +y) and z in pixels upward; the
 * sprite origin is the unit's ground centre. One tile is 64×32 projected pixels.
 */

/** Scale a `#rrggbb` or `rgb(r,g,b)` colour's brightness. */
export function shade(color: string, factor: number): string {
  let r: number;
  let g: number;
  let b: number;
  if (color.startsWith('#')) {
    const value = parseInt(color.slice(1, 7), 16);
    r = value >> 16; g = (value >> 8) & 255; b = value & 255;
  } else {
    [r, g, b] = color.replace(/[^\d,.]/g, '').split(',').map(Number);
  }
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n * factor)));
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

export function project(u: number, v: number, z: number): [number, number] {
  return [(u - v) * 32, (u + v) * 16 - z];
}

/** Rotate a local (forward, side) offset by heading (radians) around (cu, cv). */
export function local(cu: number, cv: number, heading: number, forward: number, side: number): [number, number] {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [cu + c * forward - s * side, cv + s * forward + c * side];
}

export function poly(context: CanvasRenderingContext2D, points: Array<[number, number]>, fill: string, stroke?: string): void {
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) context.lineTo(points[i][0], points[i][1]);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 0.6;
    context.stroke();
  }
}

/** A flat polygon on the plane z, from local (forward, side) points. */
export function flat(context: CanvasRenderingContext2D, cu: number, cv: number, heading: number, z: number,
  points: Array<[number, number]>, fill: string): void {
  poly(context, points.map(([f, s]) => {
    const [u, v] = local(cu, cv, heading, f, s);
    return project(u, v, z);
  }), fill);
}

export interface BoxStyle { color: string; top?: string; taper?: number; outline?: string }

/**
 * Oriented box with optional top taper (0..1 shrinks the top face, for sloped
 * armour and turrets). Only faces turned toward the viewer are drawn.
 */
export function box(context: CanvasRenderingContext2D, cu: number, cv: number, heading: number,
  length: number, width: number, z0: number, z1: number, style: BoxStyle): void {
  const taper = style.taper ?? 0;
  const hl = length / 2;
  const hw = width / 2;
  const tl = hl * (1 - taper);
  const tw = hw * (1 - taper * 0.7);
  const base: Array<[number, number]> = [[hl, -hw], [hl, hw], [-hl, hw], [-hl, -hw]];
  const top: Array<[number, number]> = [[tl, -tw], [tl, tw], [-tl, tw], [-tl, -tw]];
  const b = base.map(([f, s]) => local(cu, cv, heading, f, s));
  const t = top.map(([f, s]) => local(cu, cv, heading, f, s));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // Outward normal of edge i→j in tile space; visible if it points toward +u+v (the viewer).
    const eu = b[j][0] - b[i][0];
    const ev = b[j][1] - b[i][1];
    const nu = ev;
    const nv = -eu;
    if (nu + nv <= 0.0001) continue;
    const len = Math.hypot(nu, nv) || 1;
    const light = 0.66 + 0.2 * ((-0.25 * nu + 0.97 * nv) / len);
    poly(context, [project(b[i][0], b[i][1], z0), project(b[j][0], b[j][1], z0), project(t[j][0], t[j][1], z1), project(t[i][0], t[i][1], z1)],
      shade(style.color, light), style.outline);
  }
  poly(context, t.map(([u, v]) => project(u, v, z1)), style.top ?? shade(style.color, 1.08), style.outline);
}

export function ellipseShadow(context: CanvasRenderingContext2D, rx: number, ry: number, alpha = 0.2): void {
  context.fillStyle = `rgba(20,28,20,${alpha})`;
  context.beginPath();
  context.ellipse(2, 2, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2);
  context.fill();
}

/** Approximate projected pixels per local tile unit, for sizing decals given in pixels. */
const PIXELS_PER_UNIT = 40;

export function star(context: CanvasRenderingContext2D, cu: number, cv: number, heading: number, z: number, radiusPx: number, color: string): void {
  const radius = radiusPx / PIXELS_PER_UNIT;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 ? radius * 0.42 : radius;
    points.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }
  flat(context, cu, cv, heading, z, points, color);
}

export function cross(context: CanvasRenderingContext2D, cu: number, cv: number, heading: number, z: number, radiusPx: number, color: string, edge: string): void {
  const a = radiusPx / PIXELS_PER_UNIT;
  const radius = a;
  const b = radius * 0.32;
  const shape: Array<[number, number]> = [[-b, -a], [b, -a], [b, -b], [a, -b], [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b], [-a, -b], [-b, -b]];
  flat(context, cu, cv, heading, z, shape.map(([f, s]) => [f * 1.25, s * 1.25]), edge);
  flat(context, cu, cv, heading, z + 0.1, shape, color);
}

/** A wheel disc standing upright in the vehicle's forward/up plane. Radius in pixels. */
export function wheel(context: CanvasRenderingContext2D, cu: number, cv: number, heading: number, radiusPx: number, color: string, hub: string): void {
  const points: Array<[number, number]> = [];
  const r = radiusPx / PIXELS_PER_UNIT;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const [u, v] = local(cu, cv, heading, Math.cos(a) * r, 0);
    points.push(project(u, v, radiusPx + Math.sin(a) * radiusPx));
  }
  poly(context, points, color);
  const [hx, hy] = project(cu, cv, radiusPx);
  context.fillStyle = hub;
  context.beginPath();
  context.ellipse(hx, hy, radiusPx * 0.35, radiusPx * 0.35, 0, 0, Math.PI * 2);
  context.fill();
}
