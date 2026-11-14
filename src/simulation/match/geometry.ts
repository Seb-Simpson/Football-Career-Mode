export const PITCH_L = 105;
export const PITCH_W = 68;
export const GOAL_HALF = 3.66;
export const GOAL_H = 2.44;
export const BOX_DEPTH = 16.5;
export const BOX_HALF = 20.16;

export function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

export function dist(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance from point P to segment AB, plus the projection parameter t (0..1). */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return [dist(px, py, cx, cy), t];
}

/**
 * Shot-quality estimate from location only (distance and visible goal angle).
 * Logistic fit chosen to land near widely published open-play shot conversion
 * curves: ~0.4 at six yards central, ~0.15-0.2 at the penalty spot, ~0.04 at 20m.
 */
export function locationXg(distToLine: number, lateral: number): number {
  const x = Math.max(0.5, distToLine);
  const y = Math.abs(lateral);
  const d = Math.sqrt(x * x + y * y);
  let angle = Math.atan2(2 * GOAL_HALF * x, x * x + y * y - GOAL_HALF * GOAL_HALF);
  if (angle < 0) angle += Math.PI;
  return 1 / (1 + Math.exp(1.45 + 0.115 * d - 1.65 * angle));
}
