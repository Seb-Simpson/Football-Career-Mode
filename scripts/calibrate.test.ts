import { test } from 'vitest';
import { createWorld } from '../src/domain/generate';
import { autoLineup } from '../src/domain/lineup';
import { MatchEngine } from '../src/simulation/match/engine';
import { teamInput } from '../src/simulation/match/setup';
import { clubStrength } from '../src/domain/generate';

test('calibrate', () => {
  const w = createWorld(42, 'Test');
  for (const c of Object.values(w.clubs)) c.lineup = autoLineup(w, c).lineup;
  const ids = Object.keys(w.clubs).slice(0, 10);
  const agg: any = { g: 0, hw: 0, d: 0, aw: 0, shots: 0, ot: 0, pass: 0, acc: 0, corners: 0, fouls: 0, yel: 0, red: 0, off: 0, poss: 0, n: 0, strongWin: 0, strongN: 0 };
  const t0 = Date.now();
  let k = 0;
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
    if (i === j) continue;
    const h = w.clubs[ids[i]], a = w.clubs[ids[j]];
    const m = new MatchEngine(teamInput(w, h, true), teamInput(w, a, true), 1000 + k++);
    m.runToEnd();
    const [hg, ag] = m.score();
    const s = m.matchStats();
    agg.g += hg + ag; agg.n++;
    if (hg > ag) agg.hw++; else if (hg === ag) agg.d++; else agg.aw++;
    agg.shots += s.shots[0] + s.shots[1]; agg.ot += s.onTarget[0] + s.onTarget[1];
    agg.pass += s.passes[0] + s.passes[1]; agg.acc += s.passAcc[0] + s.passAcc[1];
    agg.corners += s.corners[0] + s.corners[1]; agg.fouls += s.fouls[0] + s.fouls[1];
    agg.yel += s.yellows[0] + s.yellows[1]; agg.red += s.reds[0] + s.reds[1]; agg.off += s.offsides[0] + s.offsides[1];
    agg.poss += s.possession[0];
    const sh = clubStrength(w, h.id), sa = clubStrength(w, a.id);
    if (Math.abs(sh - sa) > 3 && hg !== ag) { agg.strongN++; if ((sh > sa) === (hg > ag)) agg.strongWin++; }
  }
  const n = agg.n;
  console.log(`matches ${n} in ${Date.now() - t0}ms (${((Date.now() - t0) / n).toFixed(1)}ms/match)`);
  console.log(`goals/match ${(agg.g / n).toFixed(2)} H/D/A ${(agg.hw / n * 100).toFixed(0)}/${(agg.d / n * 100).toFixed(0)}/${(agg.aw / n * 100).toFixed(0)}`);
  console.log(`shots/team ${(agg.shots / n / 2).toFixed(1)} onT ${(agg.ot / n / 2).toFixed(1)} passes/team ${(agg.pass / n / 2).toFixed(0)} acc ${(agg.acc / n / 2).toFixed(0)}%`);
  console.log(`corners/team ${(agg.corners / n / 2).toFixed(1)} fouls/team ${(agg.fouls / n / 2).toFixed(1)} yel ${(agg.yel / n).toFixed(1)} red ${(agg.red / n).toFixed(2)} off ${(agg.off / n).toFixed(1)} homePoss ${(agg.poss / n).toFixed(0)}`);
  console.log(`stronger side wins decisive games ${(agg.strongWin / agg.strongN * 100).toFixed(0)}% of ${agg.strongN}`);
}, 600000);
