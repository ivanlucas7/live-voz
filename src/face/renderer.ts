// Desenha o rosto no <canvas>: tela preta, olhos azuis redondos e boca em traço.

import type { FacePose } from './animator';

export class FaceRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível');
    this.ctx = ctx;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(pose: FacePose): void {
    const { ctx, width: w, height: h } = this;
    ctx.clearRect(0, 0, w, h);
    if (w === 0 || h === 0) return;

    // O rosto cabe num quadro ~3,4:3 centralizado, seja retrato ou paisagem.
    const unit = Math.min(w / 3.4, h / 3);
    const cx = w / 2;
    const cy = h / 2;
    const [r, g, b] = pose.color.map(Math.round);
    const color = `rgb(${r}, ${g}, ${b})`;
    const light = `rgb(${Math.min(255, r + 60)}, ${Math.min(255, g + 50)}, ${Math.min(255, b + 20)})`;

    const eyeRadius = unit * 0.62 * pose.eyeScale;
    const eyeOffsetX = unit * 0.82;
    const eyeY = cy - unit * 0.28;
    for (const side of [-1, 1]) {
      this.drawEye(cx + side * eyeOffsetX, eyeY, eyeRadius, pose, color, light);
    }
    this.drawMouth(cx + pose.mouthShift * unit * 0.35, cy + unit * 0.78, unit, pose, color);
  }

  private drawEye(x: number, y: number, radius: number, pose: FacePose, color: string, light: string): void {
    const { ctx } = this;
    const open = Math.max(0, Math.min(1, pose.eyeOpen));

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = radius * 0.45 * pose.glow;

    if (open < 0.12) {
      // Olho fechado: um traço curvo.
      ctx.strokeStyle = color;
      ctx.lineWidth = radius * 0.14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.8, y);
      ctx.quadraticCurveTo(x, y + radius * 0.18, x + radius * 0.8, y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Pálpebra: achata o olho verticalmente ao piscar.
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * open, 0, 0, Math.PI * 2);
    ctx.clip();

    const iris = ctx.createRadialGradient(x, y - radius * 0.2, radius * 0.1, x, y, radius);
    iris.addColorStop(0, light);
    iris.addColorStop(1, color);
    ctx.fillStyle = iris;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.shadowBlur = 0;

    const pupilRadius = radius * 0.5;
    const px = x + pose.pupilX * radius * 0.22;
    const py = y + pose.pupilY * radius * 0.22;
    ctx.fillStyle = '#05080d';
    ctx.beginPath();
    ctx.arc(px, py, pupilRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#5ee6f0';
    ctx.beginPath();
    ctx.arc(px + pupilRadius * 0.28, py - pupilRadius * 0.38, pupilRadius * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawMouth(x: number, y: number, unit: number, pose: FacePose, color: string): void {
    const { ctx } = this;
    const width = unit * 0.85 * pose.mouthWidth;
    const thickness = unit * 0.075;
    const open = pose.mouthOpen;

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = unit * 0.2 * pose.glow;

    if (open < 0.04) {
      // Boca fechada: traço com leve curva (sorriso ou tristeza).
      ctx.strokeStyle = color;
      ctx.lineWidth = thickness;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - width / 2, y);
      ctx.quadraticCurveTo(x, y + pose.mouthCurve * unit * 0.35, x + width / 2, y);
      ctx.stroke();
    } else {
      // Boca aberta: contorno arredondado com o interior escuro.
      const height = thickness + open * unit * 0.85;
      roundedRect(ctx, x - width / 2, y - height / 2, width, height, Math.min(height, width) / 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowBlur = 0;
      const inset = thickness * 0.75;
      if (height > inset * 2.2) {
        const iw = width - inset * 2;
        const ih = height - inset * 2;
        roundedRect(ctx, x - iw / 2, y - ih / 2, iw, ih, Math.min(ih, iw) / 2);
        ctx.fillStyle = '#05080d';
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
