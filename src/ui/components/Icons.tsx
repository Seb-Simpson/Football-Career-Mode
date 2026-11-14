import type { ReactNode } from 'react';

function I({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icon = {
  home: () => (
    <I>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h5v-6h4v6h5V10" />
    </I>
  ),
  squad: () => (
    <I>
      <path d="M8 3 5 5 2 9l3 2 1-1v11h12V10l1 1 3-2-3-4-3-2c-1 2-2.5 3-4 3S9 5 8 3Z" />
    </I>
  ),
  tactics: () => (
    <I>
      <rect x="3" y="3" width="18" height="18" />
      <circle cx="8" cy="8" r="1.6" />
      <path d="m14 7 3 3m0-3-3 3" />
      <path d="M8 12c0 4 3 6 8 6" strokeDasharray="1.5 2.5" />
      <path d="m14 16 2 2-2 2" />
    </I>
  ),
  table: () => (
    <I>
      <path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H4c0 3 2 4 4 4M16 6h4c0 3-2 4-4 4" />
      <path d="M12 12v4M8 20h8M9 16h6v4H9z" />
    </I>
  ),
  transfers: () => (
    <I>
      <path d="M4 8h14l-3-3M20 16H6l3 3" />
    </I>
  ),
  club: () => (
    <I>
      <path d="M3 21h18M5 21V9l7-5 7 5v12" />
      <path d="M9 21v-6h6v6M9 11h.01M15 11h.01" />
    </I>
  ),
  inbox: () => (
    <I>
      <rect x="3" y="5" width="18" height="14" />
      <path d="m3 7 9 6 9-6" />
    </I>
  ),
  settings: () => (
    <I>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </I>
  ),
  arrow: () => (
    <I>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </I>
  ),
  close: () => (
    <I>
      <path d="M6 6l12 12M18 6 6 18" />
    </I>
  ),
  play: () => (
    <I>
      <path d="M7 4v16l13-8z" fill="currentColor" stroke="none" />
    </I>
  ),
  pause: () => (
    <I>
      <path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor" stroke="none" />
    </I>
  ),
  forward: () => (
    <I>
      <path d="M4 5v14l8-7zM12 5v14l8-7z" fill="currentColor" stroke="none" />
    </I>
  ),
  camera: () => (
    <I>
      <path d="M3 7h4l2-2h6l2 2h4v12H3z" />
      <circle cx="12" cy="13" r="3.5" />
    </I>
  ),
  board: () => (
    <I>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M12 5v14" />
      <circle cx="12" cy="12" r="2.5" />
    </I>
  ),
  sound: () => (
    <I>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
    </I>
  ),
  mute: () => (
    <I>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="m17 9 5 6M22 9l-5 6" />
    </I>
  ),
  more: () => (
    <I>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </I>
  ),
  swap: () => (
    <I>
      <path d="M7 4v14l-3-3M17 20V6l3 3" />
    </I>
  ),
  wand: () => (
    <I>
      <path d="m4 20 11-11M14 4v3M19 9h-3M17.5 5.5l-2 2M6 6l1 2M3 9h2" />
    </I>
  ),
};
