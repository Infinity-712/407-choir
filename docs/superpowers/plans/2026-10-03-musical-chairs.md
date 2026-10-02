# Musical Chairs Implementation Plan

> **For agentic workers:** Use a shared contract and parallel implementation with separate file ownership; TDD per task and fresh whole-branch review before final commit.

**Goal:** A complete local multiplayer musical-chairs game with permanent entry, guidance, dynamic chairs and winner nomination.
**Architecture:** Add a per-room authoritative state machine; shared geometry generates client/server effective layouts. Existing Socket.IO commands, movement and sit avatars remain primary.
**Tech Stack:** Existing TypeScript, React, Three.js, Socket.IO, Web Audio, node:test and Playwright; no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-03-musical-chairs-design.md

## Global Constraints

- Only this minigames worktree; branch codex/minigames. Local ports 5174/3002. No deployment or merge into main.
- Never modify room.glb or source Blender files; parameter geometry for temporary game chairs.
- Preserve existing room, piano, chat, voice, avatars and mobile controls.
- Server authoritative, no client-specified identity, no future music-stop timestamp in snapshots.
- New files carry the subsystem; small integration hooks in shared/protocol.ts, server/room.ts, server/index.ts, src/App.tsx, src/scene/RoomWorld.ts.

## Review Focus

Old requests after a round change, simultaneous seat claims, rotating instead of walking, disconnect/host transfer, scene restored around bystanders, stalled finals, phone overlay input leakage, audio not stopping on exit.

## Task 1: Shared contract and geometry

Files: shared/minigames.ts, shared/protocol.ts, tests/minigame-layout.test.ts.
Produces MusicalChairsState, MinigameAction, isMusicalChairsActive, createGameChairs, getMinigameLayout and arena constants.
- [x] Write semantic geometry/layout tests; observe missing-module RED.
- [x] Implement contract and safe shared dynamic layout; validate approach, collision and cleanup.
- [x] Run focused tests, document contract for parallel owners.

## Task 2: Authoritative state machine

Owner: server worker. Files: server/minigames.ts, server/room.ts, server/index.ts, tests/minigames.test.ts, tests/minigames-server.test.ts.
Consumes Task1; event minigame with actions join/leave/start/claim/nominate/reset/cancel. Existing claim routes game-chair IDs through the same game validator.
- [x] Write failing fake-clock rules/RoomController tests and a real Socket.IO test.
- [x] Implement private music deadlines, motion window, phases, atomic seats and results; integrate movement/layout/release/disconnect/flush.
- [x] Verify invalid/late/cross-room requests, timeout and restoration; run focused tests.

## Task 3: Dynamic scene

Owner: scene worker. Files: src/scene/PartyScene.ts, src/scene/RoomWorld.ts, tests/party-scene.test.ts.
Consumes Task1 and state.minigame. No App edits.
- [x] Write failing geometry lifecycle test.
- [x] Render shared chair assets, toggle original conductor meshes, rebuild picking/effective layout on scene signature changes; use per-player positionVersion for authoritative relocation.
- [x] Label participants/winner/singer safely, keep bubble positioning; verify owned resource disposal and collision matching.

## Task 4: UI and drum placeholder

Owner: UI worker. Files: src/components/PartyGames.tsx, src/party.css, src/audio/PartyAudio.ts, src/App.tsx, tests/party-audio.test.ts.
Consumes Task1. Game commands use existing request() and authoritative state. Existing interact flushes pending movement before claim.
- [x] Write failing audio lifecycle tests and add browser entry acceptance.
- [x] Add permanent party entry, help/lobby/action/result/status UI; keep active-game view small, close modal on start.
- [x] Add synchronized procedural drums on shared AudioContext; follow existing sound volume and clean up on exit.
- [x] Validate narrow portrait/landscape fit and input guards.

## Task 5: Integrated verification, review and commit

Owner: root. Files: tests/browser/minigames.spec.ts, README.md, docs/MINIGAMES-HANDOFF.md.
- [x] Run all unit tests and production build.
- [x] On 5174/3002 exercise three-person full game and six-person lobby, phone interface and existing browser regressions; inspect screenshots.
- [x] Fresh independent review; fix concrete important findings and retest.
- [x] Update handoff/documentation; git diff --check; commit on codex/minigames and report hash. Do not merge/deploy.

## Ledger

- Initial branch codex/minigames and status clean; linked worktree verified; README/parallel instructions read. Read-only explorers completed server, scene and UI maps.
- User supplied implementation authorization and detailed gameplay; routine policy decisions above are recorded assumptions, so no repeated permission gate.
- Shared protocol is root-owned. Server, scene and UI ownership is disjoint after Task1, allowing parallel work. Each consumes identical state names/constants.

- Shared geometry, procedural audio and server/scene rules followed RED→GREEN focused tests. Final unit run: 136/136; production build passed on 2026-10-03.
- Independent review caught shared teleportVersion interrupting others' navigation; corrected to per-player positionVersion with server and scene regressions. Game-seat UI/escape now opens details rather than proposing a forbidden stand-up action.
- Visual QA caught GLTFLoader node-name sanitization preventing lectern hiding; real GLTFLoader.parseAsync regression proves all seven authored parts hide and restore, including originally hidden parts.
- Added spectator-safe lobby restoration when every original participant disconnects; observers cannot reset an active result while the host/champion remains online.
- Browser full-game nomination and 6-person lobby passed; phone rules/joystick also passed individually. Final whole-site browser run is pending. An earlier whole-site run lost its reused dev servers; restarted an owned worktree dev session on 5174/3002, verified health and served party entry before rerunning.

- A real GLB screenshot showed the default follow camera inside the front cabinet after arena relocation; participants now receive a safe left-side view only once per new round, retaining subsequent orbit/zoom input. Camera lifecycle regression passed; all six start-position camera points avoid room/furniture colliders.
- Removed conditional toggle clicks after automatic start/winner panels: browser tests now await authoritative UI transitions. The legacy social regression waits for piano release before navigating to the conductor. Active participants no longer see unusable ordinary furniture shortcuts.

- Final fresh root verification: `npm test` 136/136, `npm run build` passed, and full `PORT=3002 WEB_PORT=5174 npm run test:browser` 13/13 passed in 2.5m. Desktop and narrow phone screenshots visually inspected; lectern/stool hide, scene visible, seats/actions/status readable. No source/GLB changes after these gates.
- Handoff and README finalized; all original room GLB Git hashes match. Commit only on codex/minigames, preserve worktree and preview; integration/deployment remains with original conversation.
