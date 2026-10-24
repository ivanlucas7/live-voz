// "Cérebro" do rosto: transforma o estado da conversa e o volume da voz numa
// pose (olhos, pupilas, boca, cor). Não desenha nada, então dá para testar.

import type { ConversationState } from '../live/conversation';

export interface FacePose {
  /** 1 = olhos abertos, 0 = fechados (piscada). */
  eyeOpen: number;
  /** Tamanho relativo dos olhos (arregala quando a pessoa fala). */
  eyeScale: number;
  /** Direção do olhar, de -1 a 1. */
  pupilX: number;
  pupilY: number;
  /** Abertura da boca, de 0 a 1. */
  mouthOpen: number;
  /** Largura relativa da boca (estreita quando abre, formando um "o"). */
  mouthWidth: number;
  /** Curvatura: positivo sorri, negativo fica triste. */
  mouthCurve: number;
  /** Deslocamento lateral da boca (cara de "hmm" quando pensa). */
  mouthShift: number;
  /** Cor principal em RGB. */
  color: [number, number, number];
  /** Intensidade do brilho, de 0 a 1. */
  glow: number;
}

interface Target {
  eyeOpen: number;
  eyeScale: number;
  gazeX: number;
  gazeY: number;
  mouthCurve: number;
  mouthShift: number;
  color: [number, number, number];
  glow: number;
  pulse: number;
}

const BLUE: [number, number, number] = [59, 165, 255];

const TARGETS: Record<ConversationState, Target> = {
  idle: { eyeOpen: 1, eyeScale: 1, gazeX: 0, gazeY: 0, mouthCurve: 0.15, mouthShift: 0, color: [44, 118, 196], glow: 0.35, pulse: 0 },
  connecting: { eyeOpen: 1, eyeScale: 0.96, gazeX: 0, gazeY: -0.2, mouthCurve: 0, mouthShift: 0, color: BLUE, glow: 0.5, pulse: 1 },
  listening: { eyeOpen: 1, eyeScale: 1, gazeX: 0, gazeY: 0, mouthCurve: 0.2, mouthShift: 0, color: BLUE, glow: 0.7, pulse: 0 },
  user_speaking: { eyeOpen: 1, eyeScale: 1.08, gazeX: 0, gazeY: 0.05, mouthCurve: 0.3, mouthShift: 0, color: [76, 201, 255], glow: 0.9, pulse: 0 },
  thinking: { eyeOpen: 0.78, eyeScale: 0.97, gazeX: 0.55, gazeY: -0.6, mouthCurve: -0.05, mouthShift: 0.35, color: [143, 123, 255], glow: 0.75, pulse: 0.6 },
  speaking: { eyeOpen: 1, eyeScale: 1, gazeX: 0, gazeY: 0, mouthCurve: 0, mouthShift: 0, color: BLUE, glow: 0.9, pulse: 0 },
  reconnecting: { eyeOpen: 0.85, eyeScale: 0.96, gazeX: 0, gazeY: -0.3, mouthCurve: 0, mouthShift: 0, color: [107, 143, 179], glow: 0.45, pulse: 1 },
  error: { eyeOpen: 0.7, eyeScale: 0.95, gazeX: 0, gazeY: 0.45, mouthCurve: -0.45, mouthShift: 0, color: [255, 90, 106], glow: 0.6, pulse: 0 },
};

/**
 * Converte o volume RMS da voz em abertura da boca (0 a 1), em escala de
 * decibéis: abaixo de ~-42 dB fica fechada, perto de -16 dB fica toda aberta.
 */
export function levelToMouth(level: number): number {
  if (level <= 0.006) return 0;
  const db = 20 * Math.log10(level);
  return Math.min(1, Math.max(0, (db + 42) / 26));
}

/** Suavização exponencial independente da taxa de quadros. */
export function approach(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export class FaceAnimator {
  private pose: FacePose = {
    eyeOpen: 1,
    eyeScale: 1,
    pupilX: 0,
    pupilY: 0,
    mouthOpen: 0,
    mouthWidth: 1,
    mouthCurve: 0.15,
    mouthShift: 0,
    color: [...TARGETS.idle.color],
    glow: TARGETS.idle.glow,
  };
  private nextBlinkAt: number;
  private blinkStart = -1;
  private wanderX = 0;
  private wanderY = 0;
  private nextWanderAt = 0;
  private baseEyeOpen = 1;

  constructor(private readonly random: () => number = Math.random) {
    this.nextBlinkAt = 1.5 + random() * 2;
  }

  /**
   * @param time segundos desde o início
   * @param dt segundos desde o quadro anterior
   * @param speechLevel volume RMS do que o alto-falante está tocando
   */
  update(state: ConversationState, time: number, dt: number, speechLevel: number): FacePose {
    const target = TARGETS[state];
    const p = this.pose;
    dt = Math.min(dt, 0.1);

    // Boca: abre rápido e fecha um pouco mais devagar, como fala de verdade.
    const mouthTarget = state === 'speaking' ? levelToMouth(speechLevel) : 0;
    p.mouthOpen = approach(p.mouthOpen, mouthTarget, dt, mouthTarget > p.mouthOpen ? 0.035 : 0.08);
    p.mouthWidth = 1 - p.mouthOpen * 0.35;
    p.mouthCurve = approach(p.mouthCurve, target.mouthCurve, dt, 0.25);
    p.mouthShift = approach(p.mouthShift, target.mouthShift, dt, 0.3);

    // Olhar: segue o alvo do estado e dá umas olhadinhas aleatórias quando está ouvindo.
    if (time >= this.nextWanderAt) {
      const calm = state === 'listening' || state === 'idle' || state === 'speaking';
      this.wanderX = calm ? (this.random() - 0.5) * 0.5 : 0;
      this.wanderY = calm ? (this.random() - 0.5) * 0.3 : 0;
      this.nextWanderAt = time + 1.2 + this.random() * 2.5;
    }
    p.pupilX = approach(p.pupilX, target.gazeX + this.wanderX, dt, 0.12);
    p.pupilY = approach(p.pupilY, target.gazeY + this.wanderY, dt, 0.12);

    // Piscada: fecha e abre em ~0,16 s, a cada 2 a 6 s.
    let blink = 1;
    if (this.blinkStart < 0 && time >= this.nextBlinkAt) this.blinkStart = time;
    if (this.blinkStart >= 0) {
      const phase = (time - this.blinkStart) / 0.16;
      if (phase >= 1) {
        this.blinkStart = -1;
        this.nextBlinkAt = time + 2 + this.random() * 4;
      } else {
        blink = Math.abs(1 - phase * 2);
      }
    }
    this.baseEyeOpen = approach(this.baseEyeOpen, target.eyeOpen, dt, 0.15);
    p.eyeOpen = this.baseEyeOpen * blink;
    p.eyeScale = approach(p.eyeScale, target.eyeScale, dt, 0.12);

    // Cor e brilho, com pulsação lenta nos estados de espera.
    for (let i = 0; i < 3; i++) p.color[i] = approach(p.color[i], target.color[i], dt, 0.25);
    const pulse = target.pulse * (0.5 + 0.5 * Math.sin(time * 4)) * 0.35;
    p.glow = approach(p.glow, target.glow - pulse + p.mouthOpen * 0.15, dt, 0.1);

    return { ...p, color: [...p.color] as [number, number, number] };
  }
}
