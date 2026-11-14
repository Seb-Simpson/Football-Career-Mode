/**
 * Shared ball physics. The simulation integrates the ball with `ballStep`, and
 * players predict where a pass will go with `predictPath`, which uses exactly the
 * same function. Decisions and outcomes therefore agree about the ball.
 */
export const GRAVITY = 9.81;
/** Rolling deceleration on grass, m/s². */
export const ROLL_DECEL = 2.8;
/** Per-second multiplier on horizontal speed while airborne (air drag). */
export const AIR_DRAG = 0.9;

export interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export function ballStep(b: BallState, dt: number) {
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.z > 0 || b.vz > 0) {
    b.z += b.vz * dt;
    b.vz -= GRAVITY * dt;
    const drag = Math.pow(AIR_DRAG, dt);
    b.vx *= drag;
    b.vy *= drag;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -2.5) {
        b.vz = -b.vz * 0.38;
        b.vx *= 0.62;
        b.vy *= 0.62;
      } else b.vz = 0;
    }
  }
  if (b.z <= 0.02) {
    const s = Math.hypot(b.vx, b.vy);
    if (s > 0) {
      const ns = Math.max(0, s - ROLL_DECEL * dt);
      b.vx *= ns / s;
      b.vy *= ns / s;
    }
  }
}

export interface PathPoint {
  x: number;
  y: number;
  z: number;
  t: number;
  speed: number;
}

/** Predicted ball positions every `dt` seconds until it stops or `maxT` passes. */
export function predictPath(start: BallState, dt: number, maxT: number): PathPoint[] {
  const b = { ...start };
  const out: PathPoint[] = [];
  for (let t = dt; t <= maxT + 1e-6; t += dt) {
    ballStep(b, dt);
    const speed = Math.hypot(b.vx, b.vy);
    out.push({ x: b.x, y: b.y, z: b.z, t, speed });
    if (speed < 0.3 && b.z <= 0.02) break;
  }
  return out;
}

/** Launch speed for a ground pass that still has `endSpeed` after `d` metres. */
export function groundPassSpeed(d: number, endSpeed: number): number {
  return Math.sqrt(endSpeed * endSpeed + 2 * ROLL_DECEL * d);
}

/** Launch velocity for a lofted ball landing `d` metres away after roughly `flight` seconds. */
export function loftedLaunch(d: number, flight: number): { speed: number; vz: number } {
  // Horizontal speed decays with drag in the air; compensate on average.
  const dragComp = 1 / Math.pow(AIR_DRAG, flight / 2);
  return { speed: (d / flight) * dragComp, vz: (GRAVITY * flight) / 2 };
}
