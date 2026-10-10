import { tileHash } from '../sim/terrain';

function polygon(context: CanvasRenderingContext2D, color: string, points: number[]): void {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) context.lineTo(points[i], points[i + 1]);
  context.closePath();
  context.fill();
}

function tree(context: CanvasRenderingContext2D, pine: boolean, variant: number): void {
  const height = 37 + variant * 2;
  context.fillStyle = '#655d43';
  context.fillRect(-2, -height + 12, 4, height - 9);
  context.fillStyle = '#9c8e65';
  context.fillRect(-1, -16, 1, 15);
  if (pine) {
    for (let layer = 0; layer < 4; layer++) {
      const width = 17 - layer * 3;
      const y = -8 - layer * 8;
      polygon(context, layer % 2 ? '#42543d' : '#394f3b', [-width, y, 0, y - 19, width, y, 2, y + 6]);
      polygon(context, layer % 2 ? '#64744b' : '#778053', [-width, y, 0, y - 19, -1, y + 3]);
    }
  } else {
    for (let blob = 0; blob < 13; blob++) {
      const x = (tileHash(blob, variant, 677) - .5) * 28;
      const y = -17 - tileHash(blob, variant, 412) * 24;
      const radius = 8 + tileHash(blob, variant, 944) * 5;
      context.beginPath();
      context.ellipse(x, y, radius, radius * .8, 0, 0, Math.PI * 2);
      context.fillStyle = ['#4e6240', '#657246', '#76824e', '#838956', '#596c43'][blob % 5];
      context.fill();
      context.fillStyle = 'rgba(186,184,104,.12)';
      context.beginPath(); context.ellipse(x - 3, y - 3, radius * .6, radius * .3, -.2, 0, Math.PI * 2); context.fill();
    }
  }
}

function rock(context: CanvasRenderingContext2D, variant: number): void {
  polygon(context, '#6f7569', [-18, -1, -15, -14, -5, -21, 12, -15, 19, -2, 4, 5]);
  polygon(context, '#acae96', [-18, -1, -15, -14, -5, -21, 2, -8, -2, 3]);
  polygon(context, '#8f9784', [-5, -21, 12, -15, 19, -2, 2, -8]);
  polygon(context, '#c0bda1', [-15, -14, -5, -21, 4, -17, -2, -15]);
  if (variant % 2) polygon(context, '#78875e', [-12, -2, -7, -6, 3, -3, 4, 2, -4, 4]);
}

function cottage(context: CanvasRenderingContext2D, ruined: boolean, variant: number): void {
  polygon(context, '#6e6a59', [-23, -3, 4, -16, 27, -4, 1, 11]);
  polygon(context, '#b0a98b', [-23, -6, -23, -23, 1, -10, 1, 7]);
  polygon(context, '#8a8976', [1, 7, 1, -10, 27, -23, 27, -6]);
  if (ruined) {
    polygon(context, '#c0b599', [-23, -23, -23, -28, -17, -25, -17, -19, -10, -18, -9, -12, 1, -10]);
    polygon(context, '#555952', [-20, -20, 3, -8, 24, -19, 1, -30]);
    polygon(context, '#a4a18a', [14, -21, 14, -32, 20, -33, 20, -30, 27, -34, 27, -23, 1, -10]);
    polygon(context, '#716b57', [-9, -14, 3, -30, 14, -23, 2, -10]);
    for (let i = 0; i < 8; i++) {
      const x = (tileHash(i, variant, 701) - .5) * 52;
      const y = tileHash(i, variant, 197) * 9;
      polygon(context, i % 2 ? '#aaa28a' : '#6c6e60', [x, y, x + 4, y - 2, x + 7, y, x + 3, y + 2]);
    }
  } else {
    polygon(context, '#62695e', [-28, -25, -4, -40, 28, -26, 3, -10]);
    polygon(context, variant % 2 ? '#8a705d' : '#77796a', [-28, -25, -4, -40, 1, -27, 3, -10]);
    polygon(context, '#a28d6d', [-28, -25, -4, -40, -4, -38, -26, -24]);
    context.strokeStyle = 'rgba(41,44,38,.25)';
    context.lineWidth = 1;
    for (let row = 0; row < 3; row++) {
      context.beginPath(); context.moveTo(0, -35 + row * 6); context.lineTo(23 - row * 6, -26 + row * 3); context.stroke();
    }
    polygon(context, '#b4aa91', [12, -31, 12, -43, 17, -46, 17, -33]);
    polygon(context, '#868573', [17, -33, 17, -46, 21, -44, 21, -31]);
    polygon(context, '#4c5148', [12, -43, 17, -46, 21, -44, 17, -41]);
  }
  polygon(context, '#494f45', [-17, -15, -17, -8, -12, -5, -12, -12]);
  polygon(context, '#494f45', [12, -12, 12, -6, 18, -9, 18, -15]);
  polygon(context, '#626251', [-6, -10, -6, 3, -1, 6, -1, -7]);
}

function tower(context: CanvasRenderingContext2D): void {
  polygon(context, '#8b8b77', [-12, 0, -12, -39, 1, -32, 1, 6]);
  polygon(context, '#696f63', [1, 6, 1, -32, 15, -39, 15, -1]);
  polygon(context, '#b7b199', [-12, -39, -12, -46, -7, -44, -7, -40, -2, -38, -2, -45, 1, -42, 1, -32]);
  polygon(context, '#878c78', [1, -32, 1, -42, 6, -44, 6, -39, 11, -42, 11, -48, 15, -46, 15, -39]);
  polygon(context, '#414b43', [-8, -28, -8, -19, -4, -17, -4, -26]);
  polygon(context, '#414b43', [6, -26, 6, -17, 11, -20, 11, -29]);
  context.strokeStyle = 'rgba(39,48,40,.25)';
  for (let line = 0; line < 5; line++) {
    context.beginPath(); context.moveTo(-12, -line * 6); context.lineTo(1, 6 - line * 6); context.lineTo(15, -1 - line * 6); context.stroke();
  }
}

export function createPropAtlas(): HTMLCanvasElement[] {
  const sprites: HTMLCanvasElement[] = [];
  for (let kind = 1; kind <= 7; kind++) {
    for (let variant = 0; variant < 4; variant++) {
      const canvas = document.createElement('canvas');
      canvas.width = 88;
      canvas.height = 88;
      const context = canvas.getContext('2d')!;
      context.translate(44, 68);
      context.fillStyle = 'rgba(29,43,32,.24)';
      context.beginPath(); context.ellipse(9, 4, kind < 3 ? 23 : 29, 7, -.15, 0, Math.PI * 2); context.fill();
      if (kind < 3) tree(context, kind === 2, variant);
      else if (kind === 3) rock(context, variant);
      else if (kind === 4 || kind === 5) cottage(context, kind === 5, variant);
      else if (kind === 6) tower(context);
      else {
        for (let bush = 0; bush < 4; bush++) {
          context.fillStyle = bush % 2 ? '#5d6c42' : '#747b4e';
          context.beginPath(); context.ellipse(-12 + bush * 8, -6 + bush % 2, 8, 6, .2, 0, Math.PI * 2); context.fill();
        }
      }
      sprites.push(canvas);
    }
  }
  return sprites;
}
