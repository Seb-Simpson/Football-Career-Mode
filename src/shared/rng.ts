/**
 * Seeded, serialisable PRNG (sfc32). The simulation owns its own instances so
 * football outcomes never depend on Math.random, frame rate or presentation.
 */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | RngState) {
    if (typeof seed === 'number') {
      this.a = 0x9e3779b9;
      this.b = 0x243f6a88;
      this.c = 0xb7e15162;
      this.d = seed >>> 0;
      for (let i = 0; i < 15; i++) this.nextU32();
    } else {
      this.a = seed.a;
      this.b = seed.b;
      this.c = seed.c;
      this.d = seed.d;
    }
  }

  nextU32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Approximately normal via sum of uniforms (cheap and deterministic). */
  gauss(mean = 0, sd = 1): number {
    const s = this.next() + this.next() + this.next() + this.next() - 2;
    return mean + sd * s * 1.732;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  state(): RngState {
    return { a: this.a >>> 0, b: this.b >>> 0, c: this.c >>> 0, d: this.d >>> 0 };
  }

  /** Derive an independent child stream (e.g. one per match). */
  fork(): Rng {
    return new Rng(this.nextU32() ^ 0x5bd1e995);
  }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
