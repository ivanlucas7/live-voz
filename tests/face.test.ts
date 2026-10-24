import { describe, expect, it } from 'vitest';
import { approach, FaceAnimator, levelToMouth } from '../src/face/animator';
import type { ConversationState } from '../src/live/conversation';

function run(animator: FaceAnimator, state: ConversationState, seconds: number, level = 0, start = 0) {
  let pose = animator.update(state, start, 0, level);
  for (let t = 1 / 60; t <= seconds; t += 1 / 60) pose = animator.update(state, start + t, 1 / 60, level);
  return pose;
}

describe('levelToMouth', () => {
  it('fica fechada no silêncio e aberta com voz alta', () => {
    expect(levelToMouth(0)).toBe(0);
    expect(levelToMouth(0.004)).toBe(0);
    expect(levelToMouth(0.3)).toBe(1);
  });

  it('abre mais conforme o volume sobe', () => {
    const values = [0.01, 0.03, 0.06, 0.1].map(levelToMouth);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values[0]).toBeGreaterThan(0);
    expect(values[3]).toBeLessThan(1);
  });
});

describe('FaceAnimator', () => {
  const fixed = () => 0.5;

  it('abre a boca enquanto fala e fecha quando volta a ouvir', () => {
    const animator = new FaceAnimator(fixed);
    expect(run(animator, 'speaking', 0.3, 0.15).mouthOpen).toBeGreaterThan(0.6);
    expect(run(animator, 'listening', 0.6, 0.15, 0.3).mouthOpen).toBeLessThan(0.02);
  });

  it('ignora o volume quando não está falando', () => {
    expect(run(new FaceAnimator(fixed), 'listening', 0.5, 0.2).mouthOpen).toBe(0);
  });

  it('pisca de tempos em tempos', () => {
    const animator = new FaceAnimator(fixed);
    let minEye = 1;
    for (let t = 0; t < 5; t += 1 / 60) minEye = Math.min(minEye, animator.update('listening', t, 1 / 60, 0).eyeOpen);
    expect(minEye).toBeLessThan(0.2);
  });

  it('olha para cima quando está pensando', () => {
    const pose = run(new FaceAnimator(fixed), 'thinking', 1);
    expect(pose.pupilY).toBeLessThan(-0.4);
    expect(pose.color[0]).toBeGreaterThan(120); // roxo
  });

  it('fica triste no erro', () => {
    expect(run(new FaceAnimator(fixed), 'error', 1.5).mouthCurve).toBeLessThan(-0.3);
  });

  it('approach converge sem passar do alvo', () => {
    expect(approach(0, 1, 10, 0.1)).toBeCloseTo(1);
    expect(approach(0, 1, 0.01, 0.1)).toBeLessThan(1);
    expect(approach(0, 1, 0.01, 0)).toBe(1);
  });
});
