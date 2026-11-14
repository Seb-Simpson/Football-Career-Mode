import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { World } from '../domain/types';
import { validateLineup } from '../domain/lineup';
import { saveWorld } from '../persistence/save';
import { endSeason, finishWeek, simulateOtherMatches, userClub, userFixtureThisWeek, type SeasonSummary } from '../simulation/world/season';

export type Screen =
  | 'home'
  | 'squad'
  | 'tactics'
  | 'competition'
  | 'transfers'
  | 'club'
  | 'inbox'
  | 'settings'
  | 'prematch'
  | 'match'
  | 'report'
  | 'season';

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

interface Store {
  world: World | null;
  slot: string;
  screen: Screen;
  params: Record<string, string>;
  version: number;
  busy: { label: string; progress: number } | null;
  toasts: Toast[];
  playerId: string | null;
  seasonSummary: SeasonSummary | null;
  go: (s: Screen, params?: Record<string, string>) => void;
  mutate: (fn: (w: World) => void, save?: boolean) => void;
  setWorld: (w: World | null, slot?: string) => void;
  toast: (text: string, kind?: 'ok' | 'error') => void;
  openPlayer: (id: string | null) => void;
  advance: () => Promise<void>;
  save: () => boolean;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('Store missing');
  return s;
}

export function useWorld(): World {
  const s = useStore();
  if (!s.world) throw new Error('No career loaded');
  return s.world;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [world, setW] = useState<World | null>(null);
  const [slot, setSlot] = useState('career');
  const [screen, setScreen] = useState<Screen>('home');
  const [params, setParams] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<Store['busy']>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [seasonSummary, setSeasonSummary] = useState<SeasonSummary | null>(null);
  const toastId = useRef(0);
  const advancing = useRef(false);

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const save = useCallback((): boolean => {
    if (!world) return false;
    const club = userClub(world);
    const r = saveWorld(world, slot, club?.name ?? 'Unemployed');
    if (!r.ok) toast(r.error, 'error');
    return r.ok;
  }, [world, slot, toast]);

  const mutate = useCallback(
    (fn: (w: World) => void, doSave = false) => {
      if (!world) return;
      fn(world);
      setVersion((v) => v + 1);
      if (doSave) {
        const club = userClub(world);
        const r = saveWorld(world, slot, club?.name ?? 'Unemployed');
        if (!r.ok) toast(r.error, 'error');
      }
    },
    [world, slot, toast],
  );

  const go = useCallback((s: Screen, p: Record<string, string> = {}) => {
    setScreen(s);
    setParams(p);
    setPlayerId(null);
    window.scrollTo({ top: 0 });
  }, []);

  const setWorld = useCallback((w: World | null, s?: string) => {
    setW(w);
    if (s) setSlot(s);
    setScreen('home');
    setVersion((v) => v + 1);
    window.scrollTo({ top: 0 });
  }, []);

  const advance = useCallback(async () => {
    if (!world || advancing.current) return;
    const club = userClub(world);
    const uf = userFixtureThisWeek(world);
    if (club && uf) {
      const errors = validateLineup(world, club).filter((i) => i.severity === 'error');
      if (errors.length) {
        toast(`Fix your team before kick-off: ${errors[0].message}`, 'error');
        go('squad');
        return;
      }
      go('prematch', { fixture: uf.id });
      return;
    }
    advancing.current = true;
    try {
      setBusy({ label: world.week === 0 ? 'Pre-season ends' : 'Around the grounds', progress: 0 });
      await simulateOtherMatches(world, null, (d, t) => setBusy({ label: 'Around the grounds', progress: d / t }));
      const r = finishWeek(world);
      if (r.seasonEnded) {
        setBusy({ label: 'The season is over', progress: 1 });
        await new Promise((res) => setTimeout(res, 30));
        const summary = endSeason(world);
        setSeasonSummary(summary);
        setScreen('season');
      } else if (screen === 'report' || screen === 'prematch' || screen === 'match' || screen === 'season') {
        setScreen('home');
      }
      setVersion((v) => v + 1);
      const c = userClub(world);
      const res = saveWorld(world, slot, c?.name ?? 'Unemployed');
      if (!res.ok) toast(res.error, 'error');
    } finally {
      setBusy(null);
      advancing.current = false;
    }
  }, [world, slot, screen, toast, go]);

  const value = useMemo<Store>(
    () => ({
      world,
      slot,
      screen,
      params,
      version,
      busy,
      toasts,
      playerId,
      seasonSummary,
      go,
      mutate,
      setWorld,
      toast,
      openPlayer: setPlayerId,
      advance,
      save,
    }),
    [world, slot, screen, params, version, busy, toasts, playerId, seasonSummary, go, mutate, setWorld, toast, advance, save],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
