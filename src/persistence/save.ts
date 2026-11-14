import { SAVE_VERSION, type World } from '../domain/types';

const PREFIX = 'touchline.save.';
const INDEX = 'touchline.index';

export interface SaveMeta {
  slot: string;
  name: string;
  club: string;
  season: number;
  week: number;
  savedAt: number;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function listSaves(): SaveMeta[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(INDEX);
    const list = raw ? (JSON.parse(raw) as SaveMeta[]) : [];
    return list.filter((m) => s.getItem(PREFIX + m.slot)).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/**
 * Write a complete snapshot under a temporary key, then swap it in, keeping the
 * previous snapshot as a recovery copy.
 */
export function saveWorld(world: World, slot: string, clubName: string): SaveResult {
  const s = storage();
  if (!s) return { ok: false, error: 'Browser storage is unavailable (private mode or blocked). Export your career to keep it.' };
  const data = JSON.stringify(world);
  try {
    s.setItem(PREFIX + slot + '.tmp', data);
    const prev = s.getItem(PREFIX + slot);
    if (prev) s.setItem(PREFIX + slot + '.bak', prev);
    s.setItem(PREFIX + slot, data);
    s.removeItem(PREFIX + slot + '.tmp');
    const list = listSaves().filter((m) => m.slot !== slot);
    list.push({ slot, name: world.manager.name, club: clubName, season: world.season, week: world.week, savedAt: Date.now() });
    s.setItem(INDEX, JSON.stringify(list));
    return { ok: true };
  } catch (e) {
    try {
      s.removeItem(PREFIX + slot + '.tmp');
    } catch {
      /* ignore */
    }
    return { ok: false, error: 'Saving failed — storage may be full. Export your career as a file to keep progress safe.' };
  }
}

export function loadWorld(slot: string): World | { error: string } {
  const s = storage();
  if (!s) return { error: 'Browser storage is unavailable.' };
  const raw = s.getItem(PREFIX + slot);
  if (!raw) return { error: 'That save no longer exists.' };
  const parsed = parseWorld(raw);
  if ('error' in parsed) {
    const bak = s.getItem(PREFIX + slot + '.bak');
    if (bak) {
      const b = parseWorld(bak);
      if (!('error' in b)) return b;
    }
  }
  return parsed;
}

export function deleteSave(slot: string) {
  const s = storage();
  if (!s) return;
  for (const suffix of ['', '.bak', '.tmp']) s.removeItem(PREFIX + slot + suffix);
  s.setItem(INDEX, JSON.stringify(listSaves().filter((m) => m.slot !== slot)));
}

export function parseWorld(raw: string): World | { error: string } {
  let w: any;
  try {
    w = JSON.parse(raw);
  } catch {
    return { error: 'The file is not a valid career save.' };
  }
  if (!w || typeof w !== 'object') return { error: 'The file is not a valid career save.' };
  if (typeof w.version !== 'number') return { error: 'Missing save version.' };
  if (w.version > SAVE_VERSION) return { error: `This save comes from a newer version (v${w.version}). Update the game to load it.` };
  for (const k of ['clubs', 'players', 'fixtures', 'manager', 'rng', 'settings']) {
    if (!(k in w)) return { error: `The save is incomplete (missing ${k}).` };
  }
  if (typeof w.season !== 'number' || typeof w.week !== 'number') return { error: 'The save has an invalid calendar.' };
  // Referential checks
  for (const p of Object.values<any>(w.players)) {
    if (p.clubId && !w.clubs[p.clubId]) return { error: 'The save references a club that does not exist.' };
  }
  for (const f of w.fixtures) {
    if (!w.clubs[f.home] || !w.clubs[f.away]) return { error: 'The save has fixtures for unknown clubs.' };
  }
  return migrate(w as World);
}

function migrate(w: World): World {
  // v1 is the first format; future migrations go here in order.
  return w;
}

export function exportWorld(world: World): Blob {
  return new Blob([JSON.stringify(world)], { type: 'application/json' });
}
