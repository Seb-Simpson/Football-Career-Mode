import { useRef, useState } from 'react';
import { exportWorld, listSaves, parseWorld, saveWorld } from '../../persistence/save';
import { userClub } from '../../simulation/world/season';
import { PageHead, Panel, Segmented } from '../components/Bits';
import { useStore, useWorld } from '../store';

export function Settings() {
  const store = useStore();
  const world = useWorld();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const s = world.settings;
  const club = userClub(world);

  const download = () => {
    const blob = exportWorld(world);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `touchline-${(club?.short ?? 'career').toLowerCase()}-${world.season}-mw${world.week}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg({ text: 'Career exported. Keep the file somewhere safe.', ok: true });
  };

  return (
    <div className="page">
      <PageHead title="Saves & settings" sub="Your career autosaves after every matchday and every important decision." />
      <div className="grid cols-2">
        <Panel title="This career">
          <div style={{ display: 'grid', gap: 12 }}>
            <dl className="kv">
              <dt>Save slot</dt>
              <dd>{store.slot}</dd>
              <dt>World seed</dt>
              <dd>{world.seed}</dd>
              <dt>Engine version</dt>
              <dd>{world.engineVersion}</dd>
              <dt>Save format</dt>
              <dd>v{world.version}</dd>
            </dl>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => store.save() && setMsg({ text: 'Saved.', ok: true })}>
                Save now
              </button>
              <button className="btn ghost" onClick={download}>
                Export to file
              </button>
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>
                Import a file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  const w = parseWorld(await f.text());
                  if ('error' in w) return setMsg({ text: w.error, ok: false });
                  const slot = `career-${w.seed}-${Date.now().toString(36)}`;
                  const r = saveWorld(w, slot, w.manager.clubId ? w.clubs[w.manager.clubId].name : 'Unemployed');
                  if (!r.ok) return setMsg({ text: r.error, ok: false });
                  store.setWorld(w, slot);
                }}
              />
            </div>
            {msg && <div className={`notice ${msg.ok ? 'good' : 'error'}`}>{msg.text}</div>}
            <p className="muted" style={{ fontSize: 13.5 }}>
              Saves live in this browser's storage, which can be cleared by the browser or by you. Exported files are the only true backup. Imported files are checked before they replace anything.
            </p>
            <div>
              <button
                className="btn ghost"
                onClick={() => {
                  store.save();
                  store.setWorld(null);
                }}
              >
                Save and return to title
              </button>
            </div>
          </div>
        </Panel>

        <Panel title="Match viewing">
          <div style={{ display: 'grid', gap: 18 }}>
            <div className="field">
              Default view
              <Segmented
                label="Default view"
                value={s.viewMode}
                onChange={(v) => store.mutate((w) => (w.settings.viewMode = v), true)}
                options={[
                  { value: 'broadcast', label: 'Broadcast' },
                  { value: 'tactical', label: 'Tactical' },
                ]}
              />
            </div>
            <div className="field">
              Default length
              <Segmented
                label="Default length"
                value={s.playbackMode}
                onChange={(v) => store.mutate((w) => (w.settings.playbackMode = v), true)}
                options={[
                  { value: 'full', label: 'Full match' },
                  { value: 'highlights', label: 'Key highlights' },
                ]}
              />
            </div>
            <div className="field">
              Default speed
              <Segmented
                label="Default speed"
                value={s.matchSpeed}
                onChange={(v) => store.mutate((w) => (w.settings.matchSpeed = v), true)}
                options={[
                  { value: 6, label: 'Slow' },
                  { value: 12, label: 'Normal' },
                  { value: 24, label: 'Fast' },
                  { value: 48, label: 'Very fast' },
                ]}
              />
              <span className="hint">At normal speed a full match takes about seven and a half minutes.</span>
            </div>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}>
              <input type="checkbox" checked={s.reducedMotion} onChange={(e) => store.mutate((w) => (w.settings.reducedMotion = e.target.checked), true)} style={{ width: 20, height: 20 }} />
              Reduce motion (steadier camera, no banner animations)
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}>
              <input type="checkbox" checked={s.sound} onChange={(e) => store.mutate((w) => (w.settings.sound = e.target.checked), true)} style={{ width: 20, height: 20 }} />
              Crowd and whistle sound
            </label>
          </div>
        </Panel>

        <Panel title="Other saves in this browser">
          {listSaves().length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <dl className="kv">
              {listSaves().map((m) => (
                <div key={m.slot} style={{ display: 'contents' }}>
                  <dt>
                    {m.club} ({m.name})
                  </dt>
                  <dd>
                    {m.season}/{String(m.season + 1).slice(2)}, {m.week === 0 ? 'pre-season' : `MW ${m.week}`}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>

        <Panel title="About this build">
          <p style={{ fontSize: 14 }}>
            Every club, player and competition is fictional. Matches are decided by a deterministic spatial simulation: the same seed, line-ups and touchline decisions always produce the same match, whichever view or speed you watch at.
          </p>
        </Panel>
      </div>
    </div>
  );
}
