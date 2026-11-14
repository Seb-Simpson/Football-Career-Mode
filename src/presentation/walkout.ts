/**
 * Synthetic frames for the pre-match walkout. Nothing here touches the match
 * engine: players are simply marched from the tunnel to a line-up on halfway.
 */
import type { Frame } from '../simulation/match/engine';
import { MAX_PER_TEAM } from '../simulation/match/engine';

export const WALKOUT_SECONDS = 9;

const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function walkoutFrame(time: number): Frame {
  const pos = new Float32Array(MAX_PER_TEAM * 2 * 2);
  const present = new Uint8Array(MAX_PER_TEAM * 2);
  const cx = 52.5;
  for (const team of [0, 1]) {
    const side = team === 0 ? -1 : 1;
    for (let i = 0; i < 11; i++) {
      const k = team * MAX_PER_TEAM + i;
      present[k] = 1;
      // Phase 1: two files walk out of the tunnel (near touchline) up the pitch.
      const startY = -6 - i * 1.7;
      const fileY = 38 - i * 1.7;
      const walk = ease(time / 5.2);
      const fx = cx + side * 2.2;
      const fy = lerp(startY, fileY, walk);
      // Phase 2: peel off into a line across the pitch facing the main stand.
      const peel = ease((time - 5.2 - i * 0.05) / 2.6);
      const lx = cx + side * (3 + i * 2.1);
      const ly = 36;
      pos[k * 2] = lerp(fx, lx, peel);
      pos[k * 2 + 1] = lerp(fy, ly, peel);
    }
  }
  return { clock: 0, half: 1, ball: [cx, 34, 0], owner: -1, pos, present };
}
