import type { CSSProperties } from 'react';
import type { Club, Kit } from '../domain/types';

export function hexToRgb(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(c: string): number {
  const [r, g, b] = hexToRgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastText(bg: string): string {
  return luminance(bg) > 0.45 ? '#13203a' : '#ffffff';
}

/** Accent colour usable on light surfaces: prefer primary unless too pale. */
export function accent(kit: Kit): string {
  if (luminance(kit.primary) > 0.7) return luminance(kit.secondary) > 0.7 ? '#13203a' : kit.secondary;
  return kit.primary;
}

export function kitBand(kit: Kit, dir = '90deg'): string {
  const { primary: a, secondary: b } = kit;
  switch (kit.pattern) {
    case 'stripes':
      return `repeating-linear-gradient(${dir}, ${a} 0 14px, ${b} 14px 28px)`;
    case 'pinstripe':
      return `repeating-linear-gradient(${dir}, ${a} 0 10px, ${b} 10px 12px)`;
    case 'hoops':
      return `repeating-linear-gradient(0deg, ${a} 0 14px, ${b} 14px 28px)`;
    case 'halves':
      return `linear-gradient(${dir}, ${a} 0 50%, ${b} 50% 100%)`;
    case 'sash':
      return `linear-gradient(135deg, ${a} 0 42%, ${b} 42% 58%, ${a} 58% 100%)`;
    default:
      return `linear-gradient(${dir}, ${a} 0 80%, ${b} 80% 100%)`;
  }
}

export function clubTheme(club: Club | null | undefined): CSSProperties {
  if (!club) return {};
  const acc = accent(club.kit);
  return {
    '--club': acc,
    '--club-2': club.kit.secondary,
    '--club-ink': contrastText(acc),
    '--kit-band': kitBand(club.kit, '180deg'),
  } as CSSProperties;
}

export function ratingColor(r: number): string {
  if (r >= 80) return '#0f6e3a';
  if (r >= 70) return '#1f8a4c';
  if (r >= 60) return '#5b8a2a';
  if (r >= 50) return '#a8781a';
  return '#b24a2c';
}

export function matchRatingColor(r: number): string {
  if (r >= 8) return '#0f6e3a';
  if (r >= 7) return '#1f8a4c';
  if (r >= 6.3) return '#6d7a2a';
  if (r >= 5.5) return '#a8781a';
  return '#b24a2c';
}

export function attrColor(v: number): string {
  if (v >= 16) return '#0f6e3a';
  if (v >= 13) return '#1f8a4c';
  if (v >= 10) return '#6d7a2a';
  if (v >= 7) return '#a8781a';
  return '#b24a2c';
}
