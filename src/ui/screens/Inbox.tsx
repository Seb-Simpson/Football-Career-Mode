import { useEffect, useState } from 'react';
import { acceptJob, respondToBid } from '../../simulation/world/season';
import { PageHead } from '../components/Bits';
import { useStore, useWorld } from '../store';

export function Inbox() {
  const store = useStore();
  const world = useWorld();
  const [id, setId] = useState<string | null>(store.params.id ?? world.inbox[0]?.id ?? null);
  const msg = world.inbox.find((m) => m.id === id) ?? null;

  useEffect(() => {
    if (msg && !msg.read) store.mutate((w) => (w.inbox.find((m) => m.id === msg.id)!.read = true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="page">
      <PageHead title="Inbox" sub={`${world.inbox.filter((m) => !m.read).length} unread`}>
        <button className="btn ghost" onClick={() => store.mutate((w) => w.inbox.forEach((m) => (m.read = true)))}>
          Mark all as read
        </button>
      </PageHead>
      <div className="panel inbox">
        <div className="inbox-list">
          {world.inbox.length === 0 && <p className="empty">No messages.</p>}
          {world.inbox.map((m) => (
            <button key={m.id} className={`inbox-item ${m.read ? 'read' : ''}`} aria-current={m.id === id} onClick={() => setId(m.id)}>
              <i className="dot" />
              <span>
                <b>{m.subject}</b>
                <span>
                  {m.from}, {m.week === 0 ? 'pre-season' : `matchweek ${m.week}`}
                </span>
              </span>
            </button>
          ))}
        </div>
        {msg ? (
          <article className="letter">
            <p className="muted" style={{ fontSize: 13.5 }}>
              From {msg.from}
            </p>
            <h2>{msg.subject}</h2>
            <div className="body">{msg.body}</div>
            {msg.action && (
              <div style={{ marginTop: 22, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {msg.action.resolved ? (
                  <span className={`flag ${msg.action.resolved === 'accepted' ? 'good' : 'info'}`}>{msg.action.resolved === 'accepted' ? 'Accepted' : 'Declined'}</span>
                ) : msg.action.type === 'accept-bid' ? (
                  <>
                    <button
                      className="btn"
                      onClick={() => {
                        let r = { ok: false, message: '' };
                        store.mutate((w) => (r = respondToBid(w, msg.id, true)), true);
                        store.toast(r.message, r.ok ? 'ok' : 'error');
                      }}
                    >
                      Accept bid
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        let r = { ok: false, message: '' };
                        store.mutate((w) => (r = respondToBid(w, msg.id, false)));
                        store.toast(r.message);
                      }}
                    >
                      Reject
                    </button>
                    <button className="link" onClick={() => store.openPlayer(msg.action!.playerId!)}>
                      View player
                    </button>
                  </>
                ) : msg.action.type === 'job-offer' && !world.manager.clubId ? (
                  <button
                    className="btn club"
                    onClick={() => {
                      store.mutate((w) => acceptJob(w, msg.action!.clubId!), true);
                      store.go('home');
                      store.playCutscene({ kind: 'appointed', clubId: msg.action!.clubId! });
                    }}
                  >
                    Accept the job
                  </button>
                ) : null}
              </div>
            )}
          </article>
        ) : (
          <p className="empty">Select a message.</p>
        )}
      </div>
    </div>
  );
}
