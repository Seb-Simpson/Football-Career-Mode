# Football Career Mode

> Build a club. Shape a footballing identity. Watch your decisions come to life.

A planned football management and career simulation inspired by the depth of **Football Manager** and the broadcast presentation associated with **EA Sports FC**. The ambition is a compelling long-term career with matches that are enjoyable to watch on a phone or laptop.

**Project status:** first playable vertical slice (November 2026). A browser game called **Touchline** now implements the core career loop and a watchable automated match. See [Current build](#current-build) for what exists, how it was verified, and what is still a target. The rest of this README remains the product brief.

**Core interpretation:** the user is the manager. Footballers are controlled by the simulation. You select the team, recruit players, develop talent, set tactics, make substitutions, and watch matches unfold. There are no manual passing, shooting, tackling, or movement controls. A player career and other career perspectives are possible future modes, not the starting scope.

**Inspiration, not affiliation:** FM informs management depth; FC informs presentation ambition. “FC27” is a creative reference from the project brief, not a source of verified feature specifications. Use original interfaces, writing, graphics, audio, and code.

---

## Contents

0. [Current build](#current-build)
1. [Vision and priorities](#vision-and-priorities)
2. [Scope and delivery strategy](#scope-and-delivery-strategy)
3. [Career setup and the core loop](#career-setup-and-the-core-loop)
4. [The football world](#the-football-world)
5. [Players, squads, and development](#players-squads-and-development)
6. [Tactics and staff](#tactics-and-staff)
7. [Transfers, contracts, and scouting](#transfers-contracts-and-scouting)
8. [Club management and career stories](#club-management-and-career-stories)
9. [Match simulation](#match-simulation)
10. [Match viewing and broadcast quality](#match-viewing-and-broadcast-quality)
11. [Interface and accessibility](#interface-and-accessibility)
12. [Mobile and laptop compatibility](#mobile-and-laptop-compatibility)
13. [Saves, offline use, and recovery](#saves-offline-use-and-recovery)
14. [Technical direction](#technical-direction)
15. [Quality gates and testing](#quality-gates-and-testing)
16. [Development roadmap](#development-roadmap)
17. [Working with Claude and other contributors](#working-with-claude-and-other-contributors)
18. [Decisions, risks, and often-forgotten details](#decisions-risks-and-often-forgotten-details)
19. [Running the project and contributing](#running-the-project-and-contributing)

## Current build

**Touchline** is a TypeScript + React + Vite single-page app with no server. Everything below has working UI and domain behaviour, and is covered by the automated checks listed. Items not listed here are still targets from the brief.

| Area | Implemented | Evidence |
| --- | --- | --- |
| World | 20 fictional clubs in two 10-team divisions (Crown League, Crown League Two), generated players, nations, kits and crests | `tests/domain.test.ts` |
| Competitions | Double round-robin fixtures, ordered tiebreakers (points, GD, GF, head-to-head, name), two up and two down, season rollover | `tests/domain.test.ts`, `tests/career.test.ts` (full-season soak) |
| Match engine | Deterministic spatial simulation (fixed 0.2s step, seeded RNG): positioning, pressing, marking, passing, dribbling, tackles, fouls, cards, offside, corners, throw-ins, goal kicks, free kicks, penalties, stoppage time, fatigue, injuries, substitutions, tactical changes | `tests/match.test.ts` (determinism, command replay, score/event/stat consistency, seeded regression batch) |
| Watching | Broadcast camera (perspective projection on Canvas 2D: stands, ad boards, nets, animated players), top-down tactical view, full match / key highlights / instant result, 0.5–4× speed, goal replays, procedural crowd and whistle audio | Manual browser checks (Playwright screenshots at 1440×900 and iPhone 13) |
| Touchline control | Substitutions that wait for a stoppage (5 maximum), formation and instruction changes mid-match, assistant replaces injured players | `tests/match.test.ts` |
| Management | Club choice with difficulty, squad selection by tap (no dragging), assistant pick with explanations, lineup validation, tactics with trade-off text and presets, training focus, player profiles | Manual browser checks |
| Market | Scouting (one-week reports, estimates before then), bids, wage demands, budgets, free agents, release, renewals, transfer list with AI bids, AI recruitment in windows | `tests/career.test.ts` (atomic transfer) |
| Club | Ledger (gate, broadcast, sponsorship, prize money, wages, running costs), board objective and confidence, dismissal and job offers | Full-season soak |
| Development | Weekly and off-season attribute growth/decline, ageing, retirement, youth intake, contract expiry | Full-season soak |
| Saves | Local saves with temp-write and backup copy, validated import/export, version check | `tests/career.test.ts` |
| Layout | Laptop side rail; phone top bar, bottom tabs, sheets, floating Continue; no horizontal page scroll at 390px | Playwright overflow check |

### Engine calibration (seeded batch, 90 matches)

Measured with `npm run calibrate` on the current engine (version 1.0.0):

| Metric | Result | Typical real-world reference |
| --- | --- | --- |
| Goals per match | 2.64 | 2.5–2.9 |
| Home / draw / away | 46% / 22% / 32% | ~45 / 25 / 30 |
| Shots per team | 17.4 | 12–14 |
| On target per team | 5.8 | 4–5 |
| Fouls per team | 8.7 | 10–12 |
| Pass accuracy | 68% | 75–85% |
| Stronger side wins decisive games | 63% | — |

Known gaps: corners (~2.5 per team) and offsides (~0.1 per team) are low, shot volume is high and pass accuracy is low. Shot conversion uses a location-based model discounted for game pressure; it is not shown to players as xG.

### Known limitations

- No cup competition, loans, staff, set-piece routines or 3D renderer yet. The broadcast view is a 2.5D canvas projection, the agreed stepping stone toward milestone 2.
- Background matches use the same engine as the watched match, at roughly 0.25–0.4s each, so a matchday takes about 2 seconds with a progress overlay. Moving this into a Web Worker is the next performance step.
- Saves use `localStorage` rather than IndexedDB; a career is about 0.5 MB. Multi-tab conflict detection is not implemented.
- Real-device performance, screen-reader passes and long multi-season soaks have not been done.

## Vision and priorities

The game should make the player feel responsible for a living football club. Signing a striker, changing a press, trusting an academy player, or resting a tired captain should have believable consequences.

Quality takes priority over feature count:

1. **Trustworthy football:** coherent rules, credible results, competent AI, and decisions that matter.
2. **Enjoyable match viewing:** readable action, convincing movement, stable cameras, atmosphere, and useful analysis.
3. **An absorbing career:** development, rivalries, transfers, job changes, and a world that evolves over many seasons.
4. **A polished experience on both devices:** touch, mouse, and keyboard support without sacrificing essential management systems.
5. **Reliable progress:** responsive menus, recoverable saves, clear feedback, and predictable performance.

Depth should be optional to operate, not absent. A newcomer can delegate scouting or training; an experienced manager can take control. Explain why a decision matters before asking the user to make it.

### What success feels like

- A new manager can choose a club, pick a sensible team, and reach the first match without reading a manual.
- A viewer can understand the score, time, teams, possession changes, and tactical shape at a glance.
- An equal-strength match can go either way without outcomes feeling arbitrary.
- A tactical change visibly affects positioning and creates trade-offs rather than guaranteeing a goal.
- An academy graduate's first start feels connected to earlier development decisions.
- A career remains coherent after promotion, relegation, transfers, manager moves, and multiple seasons.

### Boundaries

The initial product is a single-player, browser-based manager career. Multiplayer, direct footballer controls, Ultimate Team-style modes, gambling mechanics, and an enormous licensed world database are outside the initial scope. Native apps, online careers, international management, and player careers require separate design and funding decisions.

## Scope and delivery strategy

Use these labels throughout development:

| Label | Meaning |
| --- | --- |
| Implemented | Exists in code and has passed the relevant checks; provide evidence before using this label. |
| Core target | Required for the first complete career release, delivered across milestones. |
| Later target | Valuable expansion after the core experience is dependable. |
| Proposed default | A practical starting decision that can change when measured evidence supports it. |

Implemented features and their evidence are listed in [Current build](#current-build).

### First complete career release: core targets

- One fictional domestic football system with two connected divisions, promotion/relegation, and a cup.
- A complete season cycle, AI-controlled clubs, fixtures, tables, transfers, and season rollover.
- Manager creation, club selection, objectives, job security, and the ability to continue after dismissal.
- Squad selection, roles, basic training, fitness, injuries, morale, scouting, contracts, and club finances.
- Watchable automated matches with tactical changes, substitutions, full-match/highlight/result viewing options.
- A polished broadcast view, a lightweight tactical view, accessible controls, and phone/laptop layouts.
- Local saves, autosave recovery, export/import, and settings.
- Original or properly licensed fictional data and assets.

The first playable milestone is much smaller: two teams, one match, one formation editor, reliable results, and an initial spectator view. It is a foundation, not the finished game.

### Later targets

Additional countries and competitions, continental qualification, advanced recruitment networks, deeper staff specialisms, richer board/media relationships, facility projects, detailed set-piece routines, international management, extensive historical records, modding, and optional cloud saves.

Expand only when the existing competition, match engine, save format, and mobile experience can support it.

## Career setup and the core loop

### Start a career

Choose a manager name and appearance/profile, supported pronouns, nationality, coaching background, and experience level. These should affect believable reputation and opportunities rather than arbitrary bonuses.

Choose a club using a readable summary: squad strength, finances, expectations, facilities, league rules, and likely challenge. Offer a recommended club for beginners and clearly identify difficult rebuilds.

Select:

- World seed and available league size.
- Currency, language, date format, units, and accessibility preferences.
- Guidance level and delegated responsibilities.
- Match presentation quality and preferred viewing length.
- Save name and autosave behavior.
- Optional later challenge rules such as restricted recruitment or a single rolling save.

### The management loop

1. Read a short inbox/dashboard summary of important decisions.
2. Review squad condition, form, availability, and the next opponent.
3. Train, scout, negotiate, and adjust tactics.
4. Submit a valid lineup and bench.
5. Watch the match, make managerial changes, or simulate to the result.
6. Review the result, player performance, injuries, finances, and consequences.
7. Advance the calendar and repeat through a complete season.

Advancing time must stop at meaningful decisions: an invalid lineup, a response deadline, a match, or a contract action requiring approval. Let the manager delegate routine tasks and configure which alerts interrupt progress.

### Long-term career

Reputation, board confidence, achievements, relationships, and tactical identity develop over time. Managers can receive offers, apply for jobs, be dismissed, and move between clubs without resetting the football world. Provide retirement, a career history, and an understandable way to end or continue a save.

## The football world

### Competitions and calendar

Every competition needs a versioned rules definition rather than scattered special cases:

- Participating clubs, schedule format, points system, and ordered tiebreakers.
- Home/away balance, rest periods, postponements, and fixture congestion.
- Promotion, relegation, playoffs where relevant, and qualification places.
- Cup draws, byes where required, extra time, penalties, and any leg/aggregate rules.
- Transfer windows, registration dates, eligibility, squad limits, and suspension rules.
- Season start/end dates, award periods, and the exact rollover sequence.

Do not assume every competition uses the same rules. For fictional launch leagues, publish a concise rules page in the game. Complex regional regulations can wait until that region is supported properly.

### Living world

Other clubs must select teams, rotate, recruit, sell, renew contracts, develop youth, manage budgets, and change managers. They follow the same core football and financial rules as the user.

Persist tables, fixtures, player statistics, trophies, records, transfers, and club histories. Track unique IDs so a renamed club or transferred player retains its history.

Use detailed simulation where the user is watching and a scalable background model elsewhere. Both must respect shared abilities, tactics, and competition rules. Validate that switching viewing mode does not create different results for the same simulated match.

## Players, squads, and development

### Player model

Each player needs identity, age/date of birth, nationality, preferred foot, positions, role familiarity, contract, wages, club ownership, registration, and career history.

Attributes should distinguish meaningful football behaviors:

| Area | Examples |
| --- | --- |
| Technical | First touch, passing, dribbling, finishing, crossing, tackling, heading, set pieces |
| Mental | Decisions, anticipation, composure, positioning, concentration, teamwork, work rate |
| Physical | Acceleration, pace, strength, agility, balance, stamina, jumping |
| Goalkeeping | Handling, reflexes, one-on-ones, aerial reach, positioning, distribution |
| Context | Fitness, fatigue, sharpness, morale, confidence, cohesion, role familiarity |

Define a consistent scale and its meaning. Avoid one overall rating deciding every duel. Physical traits should affect movement; decisions and positioning should affect choices; technique should affect execution.

Potential is uncertain and development is uneven. Scouting reports should communicate confidence and ranges rather than expose every hidden value.

### Squad management

Support a starting XI, bench, reserves/youth where included, captaincy, set-piece takers, squad roles, rotation plans, and a depth chart. Clearly show injury, fatigue, suspension, registration, and position problems before kickoff.

Offer an assistant's lineup with explanations and allow manual overrides. Preserve tactical presets without silently overwriting the manager's team.

### Training, health, and youth

- Weekly team training balances tactical work, fitness, recovery, and preparation.
- Individual focus develops roles and attributes at a believable rate.
- Age, coaching, facilities, playing time, personality, injury history, and workload affect progress.
- Medical reports show expected recovery ranges and risk; return dates are not guarantees.
- Fatigue and injury risk respond to congestion and intensity without becoming unavoidable punishment.
- Youth intake replaces retiring players and supports a sustainable long-running population.
- Academy players need development plans, eligibility checks, and appropriate loan opportunities.

Injuries, form, morale, and development must affect AI teams too. Avoid endless growth, identical prospects, or permanent penalties that make recovery impossible.

## Tactics and staff

### Tactical control

Provide formations with editable roles and duties, not just positions on a graphic.

Core instructions include mentality/risk, width, tempo, passing directness, buildup, pressing intensity, defensive line, defensive block, transitions, and attacking support. Define conflicting instructions and explain their trade-offs.

Include opponent analysis, substitutions, formation changes, tactical presets, and basic attacking/defending set-piece assignments. Later, add detailed routines and player-specific opposition instructions.

The engine should express recognizable styles such as possession play, counterattacking, a high press, and a low block. Each needs strengths, costs, and counters. Player suitability and familiarity should matter.

### Staff and delegation

Coaches, scouts, medical staff, and an assistant have ability, wages, contracts, and assignments. Start with a small useful staff model; expand specialisms later.

Delegate training, lineup suggestions, scouting, or routine renewals within explicit budget/role limits. Delegation should be inspectable and reversible. Staff advice must use available information and acknowledge uncertainty.

## Transfers, contracts, and scouting

### Recruitment

Search and filter by position, role, age, price/wage estimates, attributes known to the club, and availability. Use shortlists, scout assignments, reports, and comparisons.

Scouting takes time, costs resources, and improves knowledge. Distinguish observed facts from estimates, and record report age so old information is not treated as current.

### Deals

Core deal types are permanent transfers, free agents, contract renewals, and loans. Support negotiation, counteroffers, response deadlines, failed medicals where appropriate, and rejection reasons.

Contracts need start/end dates, wages, squad role, and signing costs. Add bonuses, installments, sell-on clauses, release clauses, and loan options only when accounting, UI, AI, and rules support them consistently.

A transfer is complete only after every necessary agreement, budget check, eligibility check, and registration step. Apply money and ownership changes atomically so reloading cannot duplicate a player or charge a fee twice.

### Believable market

Clubs consider sporting need, finances, age, contract length, reputation, and replacement options. Players consider playing time, wages, career prospects, relationships, and location/reputation factors appropriate to the world.

AI must negotiate and operate within its budget. Prevent obvious exploits such as unlimited inflated sales, free renewals followed by guaranteed resale, duplicate offers, and loans that ignore eligibility.

## Club management and career stories

### Finances and board

Track cash separately from transfer budget and wage budget. Show income and expenses with an understandable ledger: matchday revenue, broadcast/prize money, sponsorship, wages, fees, staff, and facilities.

Include season budgets, board expectations, review dates, and financial consequences. Do not let UI estimates silently become guaranteed income. Model debt or insolvency only if the consequences and recovery paths are defined.

Objectives should suit the club and season. Explain board confidence changes and distinguish short-term results from longer-term development. Difficulty should change information, resources, or challenge settings transparently rather than secretly rigging match results.

### People and narrative

Player happiness can respond to playing time, promises, role, results, and treatment. Team talks, meetings, and media interactions should have bounded effects and clear context.

Use persistent events for rivalries, breakthroughs, milestone appearances, difficult transfers, managerial returns, and title races. Stories should follow actual world state; text must never announce a trophy, injury, or transfer that did not happen.

Later targets include richer supporter sentiment, facilities, sponsorship decisions, staff relationships, and deeper press systems. Avoid repetitive inbox filler and dialogue choices with unexplained severe penalties.

## Match simulation

The simulation is the authority for the football. Presentation visualizes its state; animation must not invent a different match.

### Football behavior

- Spatial positioning for both teams, a ball model, possession, movement, marking, support runs, and team shape.
- Passing, receiving, dribbling, duels, shooting, saves, interceptions, rebounds, and clearances.
- Goalkeepers with distinct positioning, distribution, and shot-stopping behavior.
- Kickoff, throw-ins, corners, goal kicks, free kicks, and penalty procedures.
- Fouls, advantage where supported, bookings, dismissals, offside, stoppage time, and full-time rules.
- Fatigue, injuries, weather/pitch conditions if implemented, and tactical changes.
- Extra time and shootouts only when required by competition rules.

Do not preselect a winner and animate plausible highlights afterward. Outcomes should arise from the shared football model, player decisions, execution uncertainty, and tactics.

### Match management

The manager can pause, change tactics, request substitutions, change viewing speed, and switch viewing mode. Changes follow football rules and display when they will take effect.

A requested substitution should wait for a permitted stoppage; an injured player, sent-off player, exhausted substitution allowance, or empty bench must be handled explicitly. Fast simulation must resolve mandatory decisions through a stated assistant policy or stop and ask.

### Fairness and consistency

Use a seeded random generator owned by the simulation and a fixed simulation step. The same seed, engine version, initial state, and ordered managerial inputs should reproduce the same match independently of frame rate.

Visual effects, cameras, and crowd audio use separate randomness. Pausing, replaying, changing device quality, or hiding the browser tab must not change football outcomes.

Live score, commentary, statistics, highlights, tables, and the result must all derive from the same events. Track shots, shots on target, possession, passing, cards, substitutions, and scorer/assist attribution with documented definitions. Add xG only with a defined and calibrated shot-quality model; it is not a decorative random number.

## Match viewing and broadcast quality

**Watching is a central feature, not an afterthought.** Aim for a premium broadcast feel within measured browser and device limits. An early tactical prototype is acceptable for validating football; it does not satisfy the final presentation goal on its own.

### Presentation targets

- A polished real-time 3D broadcast view as the intended flagship presentation, subject to the device benchmark milestone.
- A clear, attractive lightweight tactical view for analysis, accessibility, and lower-power devices.
- Recognizable kits, clear player silhouettes, readable ball contrast, consistent pitch markings, and coherent lighting.
- Convincing running, turning, receiving, passing, shooting, tackling, saving, and celebrations.
- Movement that respects speed, acceleration, contact, and ball position; minimize foot sliding and visible snapping.
- A stable broadcast camera that anticipates play without losing the ball or causing motion sickness.
- Additional tactical, behind-goal, and replay views only when they improve readability.
- Stadium atmosphere, crowd reactions, goal celebrations, and coordinated audio.
- Scoreboard, clock, team identifiers, lineups, substitution notices, cards, and concise match information.
- Replays for major moments with clear replay labels and an immediate skip/return control.

A small set of convincing animations and one polished stadium is preferable to many unfinished environments. Establish an original visual style; avoid promising console-level photorealism across all phones.

### Viewing modes

| Mode | Intended behavior |
| --- | --- |
| Full match | Watch all simulated football, with pause and speed controls. |
| Extended highlights | Show attacks, meaningful defensive phases, major incidents, and tactical context. |
| Key highlights | Show the most consequential events without spoiling their outcome in advance. |
| Commentary / tactical | Lightweight accessible presentation with useful match information. |
| Instant result | Finish through the same rules and simulation, with a clear assistant policy for decisions. |

Highlights select moments from authoritative events and retain enough buildup to understand the action. Replays play recorded state, never resimulate the incident. Switching modes must neither duplicate nor skip simulation events.

### Sound and commentary

Use layered crowd sound, whistles, ball/contact sounds, and optional music with separate volume controls. Begin with accurate event-driven text commentary. Voice commentary is a later asset and production decision.

Audio must start only after a user gesture where browsers require it. Support mute, captions/text alternatives, reduced motion, and skipping celebrations and presentation sequences. Do not force camera cuts or loud audio as the only indication of an event.

## Interface and accessibility

### Main screens

Career setup; club dashboard; inbox/calendar; squad; player profile; tactics; training/medical; scouting/shortlist; transfers/contracts; finances/board; competitions; match center; history; save/load; settings.

Prioritize the next meaningful action. Show current date, club, next fixture, urgent tasks, and a clear Continue button. Confirm major financial commitments, firing staff, releasing players, and deleting saves; avoid confirmations for every routine selection.

### Laptop

Use space for side navigation, sortable tables, comparisons, keyboard shortcuts, tooltips, and multi-panel tactical analysis. Preserve filter/sort state and avoid forcing repeated navigation between related players.

### Mobile

Use a compact navigation system, stacked panels, readable squad cards, bottom sheets where useful, and persistent access to essential actions. Convert dense tables into purposeful summaries with detail views. Do not merely shrink the desktop UI.

Touch-based team selection and substitutions must work without dragging or hover. Keep match controls reachable without covering the ball or critical action.

### Accessibility targets

- Aim for WCAG 2.2 AA for menus, management screens, and supporting DOM controls.
- Keyboard navigation, visible focus, logical headings, labels, and screen-reader-friendly forms.
- At least 44 × 44 CSS pixel primary touch targets, with adequate spacing.
- Readable text, scalable UI, sufficient contrast, and color-independent status indicators.
- Reduced motion, camera-shake controls, captions/text alternatives, and configurable audio.
- Text/tactical access to important match information that would otherwise exist only in a canvas.
- No critical timed decision without pause or an accessible alternative.

Validate with actual keyboard and assistive-technology use as well as automated checks. Translation-ready strings, flexible layouts, local date/number formatting, and proper font coverage should be considered from the start.

## Mobile and laptop compatibility

### Proposed support baseline

A responsive web application, optionally installable as a PWA once the basics are stable. Native app store delivery is not required for the initial release.

| Area | Target |
| --- | --- |
| Phones | Current supported iOS Safari and Android Chrome; verify exact versions at each release. |
| Laptops | Current stable Chrome, Edge, Firefox, and Safari on supported desktop systems. |
| Layout | Management usable from 360 CSS pixels wide; laptop layouts verified at 1280 × 720 and larger. |
| Orientation | Portrait management and both portrait/landscape match layouts; suggest landscape without forcing it. |
| Input | Touch, mouse, trackpad, and keyboard. No hover-only essential actions. |
| Display | Safe areas, browser bars, zoom, high DPI, and on-screen keyboards handled correctly. |

### Performance targets to validate

These are proposed budgets, not measured results. Record named baseline phone/laptop hardware, OS/browser, world size, scene, quality preset, and a repeatable benchmark before claiming support.

- Target stable 30 FPS on an agreed mid-range phone and 60 FPS on an agreed integrated-graphics laptop at appropriate presets.
- At 30/60 FPS, frame budgets are about 33.3/16.7 ms; report slow-frame percentiles and sustained performance, not just average FPS.
- Target visible feedback within 100 ms for routine input; long simulation tasks show progress and do not block navigation or cancellation at safe boundaries.
- Target the first interactive dashboard within five seconds on the documented baseline network/device, with football assets loaded on demand.
- Benchmark a complete match and a 20-minute session for memory growth, heat-related slowdown, battery load, and frame pacing.
- Set download, GPU memory, working-memory, and season-advance budgets after the first measured vertical slice; keep results in the repository.

Provide Low/Medium/High/Auto quality settings. Adjust resolution, shadows, crowd density, post-processing, and animation detail before changing football simulation fidelity. Allow explicit overrides. A low-quality setting must still show coherent player movement and readable action.

Handle WebGL/context loss, unsupported hardware, interrupted audio, resize, and orientation changes without losing the career. Use the tactical view as a clear fallback when the broadcast renderer is unavailable.

## Saves, offline use, and recovery

### Save design

Local-first single-player progress is the proposed default. Use versioned structured saves in browser storage, with multiple career slots, manual saves, rotating autosaves, and explicit export/import.

Save the world seed, simulation/engine version, game date, rules/data version, clubs, players, contracts, finances, fixtures, events, history, settings where relevant, and random-generator state. Define whether matches can resume mid-match; initially require a safe pre-match checkpoint and clearly explain any interrupted-match recovery.

- Save before irreversible calendar transitions and after completed matches.
- Write a complete new snapshot atomically before replacing the previous one.
- Keep at least one last-known-good recovery snapshot.
- Validate imported data, types, sizes, references, and version compatibility before changing the active career.
- Migrate supported older saves through tested migrations; reject unsupported future versions clearly.
- Detect multiple tabs editing the same career to prevent conflicting writes.
- Explain save failure and storage/quota problems immediately, with a download recovery option where possible.

Browser storage can be cleared or evicted and is not a backup. Make export easy. Cloud sync and cross-device continuation are later targets requiring authentication, conflict resolution, privacy decisions, and operating costs; they must not be implied by local saving.

### Offline and interruption behavior

After required assets have been downloaded, local career systems should be designed to work offline. A PWA cache requires explicit version/update behavior and verified offline operation before being advertised.

When the page becomes hidden or the phone locks, pause foreground matches and checkpoint at a safe boundary. Do not simulate hours of accidental catch-up or let real-world clock changes alter career time.

An application update must not silently replace a running engine mid-match. Explain when reload is safe and preserve recoverable progress.

## Technical direction

The current build follows this direction with TypeScript, React and Vite. The broadcast view is a Canvas 2D perspective renderer for now (no Three.js yet), and the simulation runs on the main thread.

### Suggested stack

- TypeScript for typed domain models and shared contracts.
- React with Vite for the management interface and development tooling.
- Three.js for the intended 3D broadcast renderer; a lightweight Canvas 2D tactical renderer as a separate view.
- A Web Worker for simulation and calendar/background work where useful.
- IndexedDB for structured local saves, with explicit migrations and export/import.
- A small unit-test runner and browser automation such as Vitest and Playwright once the project is scaffolded.
- Static hosting initially; no server is necessary for local-only careers. GitHub Pages is a possible deployment target, not an existing live site.

Only add a physics engine, backend, cloud service, or runtime AI integration when it solves a demonstrated problem. The core career should not require a paid language-model API or internet access. If generative text is added later, it must be optional and grounded in authoritative events.

### System boundaries

1. **Domain and rules:** players, clubs, contracts, competitions, eligibility, and finance.
2. **World simulation:** calendar, fixtures, AI management, development, and transfers.
3. **Match simulation:** deterministic spatial football, rules, and event generation.
4. **Presentation:** management UI, broadcast renderer, tactical renderer, commentary, and audio.
5. **Persistence:** validation, snapshots, migrations, recovery, and import/export.
6. **Data/content:** versioned competition definitions, fictional rosters, translations, and asset metadata.

The simulation must not depend on React, DOM layout, camera state, or GPU frame rate. UI commands are validated by the domain layer and produce explicit success/failure results. Assign stable IDs and use integer minor currency units to avoid financial rounding errors.

Use bounded messages/snapshots between worker and UI, with interpolation for smooth rendering. Keep match events ordered and identifiable so consumers can safely avoid processing them twice.

### Proposed source layout

This is a suggested structure, not a description of files already present.

```text
src/
  domain/          # Entities, invariants, competition rules
  simulation/      # World calendar, AI, development, match engine
  presentation/    # 3D match, tactical view, commentary, audio
  ui/              # Screens and accessible management controls
  persistence/     # Save schema, migrations, recovery
  data/            # Fictional world definitions and configuration
  shared/          # Commands, events, IDs, worker contracts
tests/             # Rules, seeded regressions, integration, browser checks
public/assets/     # Optimized, licensed game assets
docs/              # Architecture decisions, benchmarks, rules, asset credits
```

### Rendering and asset pipeline

Choose glTF/GLB for reusable 3D assets if the prototype confirms suitability. Standardize scale, pitch coordinates, player pivots, skeletons, ball attachment/contact markers, animation naming, and material budgets.

Use asset compression, level of detail, instancing, pooled objects, and lazy loading as appropriate. Test loading errors and missing assets. Asset licenses and source attribution must travel with the files.

## Quality gates and testing

The user requested README work, not a gameplay session. These are requirements for later implementation; no game was played or validated while writing this document.

### Core correctness

- Lineups contain the correct number of eligible players with no duplicate identities.
- Goals, scoreboards, match reports, scorer records, and league tables agree.
- Offside, restarts, cards, suspensions, substitutions, extra time, and shootouts follow supported rules.
- Transfers preserve player ownership, update balances once, and obey windows/registration.
- Schedules do not double-book a club or omit required fixtures.
- Promotion/relegation, qualification, contracts, awards, and aging happen once per rollover.
- Save/load round trips preserve the world and random state; failed saves leave recovery intact.
- Replays, rendering speed, quality settings, and highlights do not change the result.

### Football quality

Run seeded batches covering balanced teams, mismatches, different tactical styles, fatigue, injuries, red cards, and unusual formations.

Compare goals, draws, home advantage, shots, cards, possession, and other distributions with a documented reference competition and season. Use tolerances and report variance rather than tuning to one exciting match.

Stronger squads should win more often across large samples, without eliminating upsets. Tactics should alter opportunities and trade-offs. AI should not require hidden user-only penalties to compete.

### Longevity

Before the full career release, run at least a 20-season automated soak test at the supported world size. Check finances, wage/fee inflation, squad sizes, player ages, youth supply, injuries, competition scheduling, retirement, and database/save growth. Investigate runaway trends and disappearing clubs or players.

### Presentation and devices

- Review uninterrupted match sequences, not just screenshots or goal montages.
- Check ball visibility, player/ball contact, camera tracking, animation transitions, kit clashes, and overlays.
- Test touch substitutions, lineup editing, contracts, saving, and a complete match flow on representative real phones and laptops.
- Verify narrow screens, portrait/landscape changes, zoom, long names, large numbers, virtual keyboards, and empty/error states.
- Test screen-reader/keyboard management, reduced motion, color-independent signals, and muted audio.
- Exercise reload, offline startup where supported, tab switching, storage failure, WebGL loss, and update recovery.

### Definition of done for a feature

A feature has working UI and domain behavior, compatible AI behavior where applicable, save/load support, relevant tests, accessible/device-appropriate controls, and documented limitations. Buttons that do nothing, generated filler data, and screenshots alone are not evidence of completion.

## Development roadmap

| Milestone | Deliverable | Exit condition |
| --- | --- | --- |
| 0. Foundations | Scaffold, rules/data model, original style direction, device baselines | App starts; chosen architecture and benchmark scenarios are documented. |
| 1. Football prototype | Two teams, full rules subset, tactics, tactical viewer, seeded events | Complete matches finish correctly; results are reproducible and tactics have visible effects. |
| 2. Presentation vertical slice | One stadium, representative players/animations, broadcast camera, audio, controls | A complete match is enjoyable to watch and meets agreed phone/laptop budgets; rendering approach is confirmed. |
| 3. Career loop | Club choice, squad, training, basic transfers/contracts, fixtures, table, local saves | A full season can be completed and recovered after reload without manual data repairs. |
| 4. Football world | Second division, cup, AI recruitment, youth, finances, jobs, rollover | Promotion/relegation and multi-club careers work; 20-season simulation remains coherent. |
| 5. Release polish | Device/accessibility pass, onboarding, recovery, asset optimization, release build | Core quality gates pass; remaining limitations and supported versions are published. |
| 6. Expansion | More depth, competitions, content, optional online services | Each addition preserves simulation, save compatibility, and performance standards. |

Do not fill every management screen before proving that the match is worth watching. Equally, do not build a beautiful replay scene disconnected from a working football model.

If the intended 3D view cannot meet baseline-device quality, record the findings and resolve scope before expanding content. A tactical fallback is useful, but silently dropping the flagship viewing goal is not a substitute for that decision.

## Working with Claude and other contributors

Treat this README as the product brief. Implement in small, reviewable milestones rather than trying to generate the whole game in one pass.

For each task:

1. Inspect existing files, repository instructions, and current feature status.
2. State the specific behavior to deliver and its acceptance criteria.
3. Keep football rules and world state out of UI components.
4. Implement real behavior end to end; label temporary fixtures and placeholders.
5. Verify relevant rules, saves, performance, and layouts.
6. Update documentation to distinguish completed work from remaining targets.

Suggested first implementation task:

> Scaffold the proposed TypeScript application and deliver milestone 1 as a small vertical slice: two fictional teams, valid lineup selection, a seeded automated match, a readable tactical spectator view, pause/speed controls, basic tactical input, and a consistent final report. Add meaningful rule and determinism checks. Document setup commands only after they work. Keep the broadcast-renderer boundary ready for milestone 2.

Avoid replacing working systems during unrelated changes, burying new dependencies without explanation, or claiming “complete career mode” because menus exist. Document architecture decisions, benchmark results, and known limitations as the project develops.

## Decisions, risks, and often-forgotten details

The following defaults make the brief actionable without pretending that every product choice has been settled.

| Topic | Proposed default / required follow-up |
| --- | --- |
| Career perspective | Manager career with automated football; player career requires separate scope. |
| Data and scale | Small fictional two-division world first; team counts and calendar chosen before fixture implementation. |
| Art direction | Original broadcast-oriented 3D style; validate visual quality and device costs in milestone 2. |
| Rules | Explicit fictional competition rules; do not imply full regulatory coverage for every real league. |
| Budget | No budget, team size, or delivery date assumed; estimate after measured prototypes. |
| Accounts | No account needed for local careers. Cloud sync is separately scoped. |
| Monetization | No monetization system assumed; no pay-to-win mechanics or mandatory paid API dependencies. |
| Internet | Offline-friendly local simulation; installation and optional services may require connectivity. |
| Football coverage | Decide men's/women's competitions and database scope explicitly; model competition-specific rules and attributes without hidden assumptions. |
| Languages | English first, with translation-ready structure. |
| Analytics | Off by default unless explicitly designed, disclosed, and enabled; never upload careers silently. |
| Licensing | Repository license and asset/data permissions must be chosen and documented before distribution. |
| Release hosting | Static web delivery proposed; a repository is not automatically a deployed GitHub Pages game. |

### Details to resolve before they cause bugs

- Kit clashes, goalkeeper kits, shirt numbers, substitutions after red cards, abandoned fixtures, and not enough eligible players.
- Deadline days, expiring loans, released players, unpaid installments, contract overlap, and expiring scout reports.
- Leap years, month lengths, date ordering, time-zone-independent career dates, and fixture rescheduling.
- Equal points, equal tiebreakers, cup byes, simultaneous final-day fixtures, and invalid competition configurations.
- Retired players retaining records, new youth IDs, duplicate names, name changes, and short/long club names.
- Manager dismissal during a window, unemployed progression, job acceptance timing, and a club losing its manager.
- Declined negotiations, no search results, missing assets, unavailable audio, disconnected devices, and a renderer that cannot start.
- Storage eviction, corrupt imports, old saves, multiple open tabs, offline updates, and disk/storage quota exhaustion.
- Sensible difficulty and guidance without hidden match rigging.
- Clear separation between estimated scouting information and facts known to the simulation.
- Privacy, attribution, backups, dependency updates, and support/bug-report workflows.

Use fictional clubs, badges, kits, competitions, people, and original audio unless appropriate rights are secured. Do not copy FM/FC assets, databases, interfaces, commentary, branding, or proprietary code. Naming an inspiration does not grant reuse rights.

## Running the project and contributing

Requirements: Node.js 20 or newer and npm. These commands have been run and verified:

```bash
npm install
npm run dev        # development server (Vite)
npm test           # unit, engine and full-season tests (~2 minutes)
npm run build      # typecheck and production build into dist/
npm run preview    # serve the production build locally
npm run calibrate  # 90-match engine statistics batch (~40 seconds)
npm run build:site # build and copy index.html + assets/ to the repo root for GitHub Pages
```

The game is published with GitHub Pages ("Deploy from a branch", `main`, root): https://seb-simpson.github.io/Football-Career-Mode/. The root `index.html` and `assets/` are build output. Don't edit them by hand. The source page is `web/index.html`, and the `Build site` workflow rebuilds and commits the root files on every push to `main`.

Source layout:

```text
src/
  domain/          # Types, formations, player ratings/valuation, fixtures, table, lineups, world generation
  simulation/
    match/         # Deterministic match engine and team setup
    world/         # Matchdays, weekly cycle, finances, transfers, board, season rollover
  presentation/    # Canvas renderer (broadcast + tactical), commentary, procedural audio
  persistence/     # Save, load, validation, export/import
  ui/              # React screens, components, theme (club colours drive the chrome)
  data/            # Fictional name and club definitions
web/index.html     # Source HTML entry (Vite root)
  shared/          # Seeded RNG
tests/             # Domain, engine and career tests
scripts/           # Engine calibration batch
```

Still to add: a repository licence, asset credits (currently none: all graphics are generated in code, fonts are OFL via Fontsource), issue templates and a release process.

A useful bug report includes the game version, device/browser, reproduction steps, expected and actual behavior, and a seed/save only when the reporter chooses to share it. Remove personal information from shared files.

**The guiding standard:** make management decisions meaningful, make the football worth watching, and make the experience dependable on both mobile and laptop.
