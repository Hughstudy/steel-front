import type { World, WorldEvent } from '../sim/world.ts';
import type { ProjectilePool } from '../sim/projectiles.ts';

const CAPACITY = 384;

/**
 * Cosmetic particles (muzzle flashes, impacts, explosions, smoke) fed from the
 * simulation's per-tick events. Bounded pool: when full, new effects are simply
 * dropped; damage never depends on this.
 */
export class Effects {
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly born = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly size = new Float32Array(CAPACITY);
  private readonly kind = new Uint8Array(CAPACITY); // 0 flash, 1 impact, 2 explosion, 3 smoke, 4 promote
  private readonly angle = new Float32Array(CAPACITY);
  private readonly alive = new Uint8Array(CAPACITY);
  private cursor = 0;
  now = 0;

  private add(kind: number, x: number, y: number, size: number, life: number, angle = 0): void {
    for (let n = 0; n < CAPACITY; n++) {
      const i = (this.cursor + n) % CAPACITY;
      if (this.alive[i]) continue;
      this.alive[i] = 1;
      this.kind[i] = kind;
      this.x[i] = x;
      this.y[i] = y;
      this.size[i] = size;
      this.life[i] = life;
      this.born[i] = this.now;
      this.angle[i] = angle;
      this.cursor = (i + 1) % CAPACITY;
      return;
    }
  }

  /** Convert simulation events (fixed-point tile units) to world-pixel effects. */
  consume(world: World, events: readonly WorldEvent[], visible: (x: number, y: number) => boolean): void {
    const s = world.subTile;
    for (const event of events) {
      const tx = event.x / s;
      const ty = event.y / s;
      if (!visible(tx, ty)) continue;
      const px = (tx - ty) * 32;
      const py = (tx + ty) * 16;
      const weapon = event.weapon ? world.rules.weapons.get(event.weapon) : undefined;
      if (event.kind === 'fire') {
        const heavy = weapon && weapon.damageType !== 'small';
        this.add(0, px, py - (heavy ? 12 : 8), heavy ? 9 : 4, heavy ? 0.12 : 0.07, event.a / 256 * Math.PI * 2);
      } else if (event.kind === 'impact') {
        if (!weapon || weapon.damageType === 'small') this.add(1, px, py - 4, 3, 0.18);
        else {
          const big = weapon.splashRadius > 0 ? 26 : 14;
          this.add(2, px, py - 4, big, 0.45);
          this.add(3, px, py - 10, big * 0.8, 1.4);
        }
      } else if (event.kind === 'death') {
        const size = event.a === 2 ? 48 : event.a === 1 ? 22 : world.rules.units.get(event.weapon)?.armor === 'infantry' ? 0 : 26;
        if (size > 0) {
          this.add(2, px, py - 8, size, 0.6);
          this.add(3, px, py - 16, size, 2.4);
        }
      } else if (event.kind === 'promote') {
        this.add(4, px, py - 36, 10, 1.2);
      }
    }
  }

  draw(context: CanvasRenderingContext2D): void {
    for (let i = 0; i < CAPACITY; i++) {
      if (!this.alive[i]) continue;
      const t = (this.now - this.born[i]) / this.life[i];
      if (t >= 1 || t < 0) { this.alive[i] = 0; continue; }
      const x = this.x[i];
      const y = this.y[i];
      const size = this.size[i];
      switch (this.kind[i]) {
        case 0: {
          const dx = Math.cos(this.angle[i]) - Math.sin(this.angle[i]);
          const dy = (Math.cos(this.angle[i]) + Math.sin(this.angle[i])) * 0.5;
          context.globalAlpha = 1 - t;
          context.fillStyle = '#ffe9a0';
          context.beginPath();
          context.ellipse(x + dx * size * 1.2, y + dy * size * 1.2, size, size * 0.6, 0, 0, Math.PI * 2);
          context.fill();
          break;
        }
        case 1:
          context.globalAlpha = 1 - t;
          context.fillStyle = '#e8dcae';
          context.fillRect(x - size / 2, y - size / 2 - t * 6, size, size);
          break;
        case 2: {
          context.globalAlpha = 1 - t;
          const r = size * (0.4 + t * 0.8);
          context.fillStyle = t < 0.3 ? '#ffe6a0' : '#f08a3c';
          context.beginPath(); context.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2); context.fill();
          context.fillStyle = '#c4462a';
          context.beginPath(); context.ellipse(x, y - r * 0.2, r * 0.55, r * 0.35, 0, 0, Math.PI * 2); context.fill();
          break;
        }
        case 3: {
          context.globalAlpha = 0.45 * (1 - t);
          const r = size * (0.5 + t);
          context.fillStyle = '#4b4a44';
          context.beginPath(); context.ellipse(x + t * 8, y - t * 30, r, r * 0.7, 0, 0, Math.PI * 2); context.fill();
          break;
        }
        case 4:
          context.globalAlpha = 1 - t;
          context.fillStyle = '#f2d36b';
          context.font = 'bold 10px Arial';
          context.textAlign = 'center';
          context.fillText('▲ PROMOTED', x, y - t * 14);
          break;
      }
    }
    context.globalAlpha = 1;
  }

  /** Projectiles in flight, interpolated between ticks; only those the player can see. */
  drawProjectiles(context: CanvasRenderingContext2D, world: World, pool: ProjectilePool, alpha: number, visible: (x: number, y: number) => boolean): void {
    const s = world.subTile;
    for (let i = 0; i < pool.capacity; i++) {
      if (!pool.active[i]) continue;
      const tx = (pool.prevX[i] + (pool.x[i] - pool.prevX[i]) * alpha) / s;
      const ty = (pool.prevY[i] + (pool.y[i] - pool.prevY[i]) * alpha) / s;
      if (!visible(tx, ty)) continue;
      const weapon = world.weaponList[pool.weapon[i]];
      const px = (tx - ty) * 32;
      const py = (tx + ty) * 16;
      if (weapon.projectile === 'arc') {
        const t = Math.min(1, (pool.travelled[i] + weapon.projectileSpeed * alpha) / pool.total[i]);
        const height = 4 * t * (1 - t) * Math.min(160, pool.total[i] / s * 9);
        context.fillStyle = 'rgba(20,28,20,.3)';
        context.beginPath(); context.ellipse(px, py, 3, 1.5, 0, 0, Math.PI * 2); context.fill();
        context.fillStyle = '#2d2c27';
        context.beginPath(); context.arc(px, py - 10 - height, 2.6, 0, Math.PI * 2); context.fill();
      } else {
        const ox = (pool.prevX[i] / s - pool.prevY[i] / s) * 32;
        const oy = (pool.prevX[i] / s + pool.prevY[i] / s) * 16;
        context.strokeStyle = weapon.projectile === 'shell' ? '#ffd27a' : 'rgba(255,240,180,.85)';
        context.lineWidth = weapon.projectile === 'shell' ? 2.2 : 1;
        context.beginPath();
        context.moveTo(ox, oy - 10);
        context.lineTo(px, py - 10);
        context.stroke();
      }
    }
  }
}
