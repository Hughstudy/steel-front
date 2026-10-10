/** Presentation-only order feedback drawn on the ground; never affects the simulation. */
export type MarkerKind = 'move' | 'nearest' | 'invalid' | 'attack' | 'rally';

interface Marker { x: number; y: number; kind: MarkerKind; born: number }

const COLORS: Record<MarkerKind, string> = {
  move: '#b9e27c', nearest: '#e6c75a', invalid: '#e2604b', attack: '#ef6a4f', rally: '#e9d79a',
};
const LIFETIME = 0.9;

export class OrderMarkers {
  private readonly markers: Marker[] = [];

  /** Tile-space centre coordinates. */
  add(x: number, y: number, kind: MarkerKind, now: number): void {
    if (this.markers.length > 24) this.markers.shift();
    this.markers.push({ x, y, kind, born: now });
  }

  draw(context: CanvasRenderingContext2D, now: number): void {
    let write = 0;
    for (const marker of this.markers) {
      const age = (now - marker.born) / LIFETIME;
      if (age >= 1 || age < 0) continue;
      this.markers[write++] = marker;
      const px = (marker.x - marker.y) * 32;
      const py = (marker.x + marker.y) * 16;
      const scale = 1 - age * 0.55;
      context.globalAlpha = 1 - age;
      context.strokeStyle = COLORS[marker.kind];
      context.lineWidth = 2;
      context.beginPath();
      context.ellipse(px, py, 22 * scale, 11 * scale, 0, 0, Math.PI * 2);
      context.stroke();
      if (marker.kind === 'invalid') {
        context.beginPath();
        context.moveTo(px - 8, py - 4); context.lineTo(px + 8, py + 4);
        context.moveTo(px + 8, py - 4); context.lineTo(px - 8, py + 4);
        context.stroke();
      } else {
        context.beginPath();
        context.moveTo(px, py - 4 * scale); context.lineTo(px, py - 26 * scale);
        context.stroke();
      }
      context.globalAlpha = 1;
    }
    this.markers.length = write;
  }
}
