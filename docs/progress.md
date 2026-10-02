# 407 web progress
Plan: docs/superpowers/plans/2026-09-26-party-plan.md

- Recon complete: no existing web/git; Node/Edge available.
- New standalone web directory isolates implementation from accepted Blender demo.
- Approved scope: existing multiplayer plan plus DIY cute avatar; execute directly.
- Decision: Socket.IO authoritative state and WebRTC mesh for account-free local small-group version. Production cross-network requires HTTPS/TURN; SFU expansion remains an infrastructure option.
- Complete: exported 7.21 MB room GLB, 68 chair anchors, 176 MIDI keys, original Blender SHA256 unchanged. Procedural wood gamma corrected after screenshot review.
- Complete: avatar geometry and all editor controls; desktop/mobile screenshot inspection.
- Complete: authoritative multiplayer, isolated rooms, exclusive ownership, separated spawn points, held/sounding/pedal snapshots.
- Complete: room walk/click navigation, seating, keyboard/pointer piano, sustained notes, conductor, emotes, local wardrobe and audio controls.
- Complete: voice lifecycle review fixed early signaling, late permissions, stale session/media races; 14 focused tests and real browser RTP validation.
- Independent client review identified 5 issues; all fixed and scoped re-review passed (connection lifecycle, late notes, failed piano claim mic, Escape priority, mixed input sources).
- Verification: npm test 41/41; production build passes; Playwright 3/3; real WebRTC two-way media with fake device, no page errors. All 71 interaction approaches reachable from spawn.
- Delivery: local Node server port 3001, development Vite port 5173. Public deployment and real cross-network microphone/headphone test are still external setup steps.

## Visual and interaction feedback refinement

- Replaced flat lighting with warm ceiling area lights, restrained fill, shadows, geometry-derived environment reflections, ambient occlusion and antialiasing.
- Fixed exported opaque white window panes; restored dark reflective glass and subtle wood/acoustic-ceiling material detail. Original Blender source remains unchanged.
- Rebuilt avatar face/hair/clothing silhouettes, continuous animated trouser legs, compact proportions and world scale 0.84; adjusted labels/camera and piano seating pose.
- Added real piano bench collision and furniture hit boxes. Picking now follows visible furniture rather than the player's sitting anchor; E uses the same target as the prompt.
- Movement transmits actual per-frame turn samples. Interaction flushes the latest position before claiming a seat/instrument, with duplicate claims blocked.
- A delayed movement rejection triggers an ordered state synchronization before resuming input. Idle avatars no longer send empty movement messages.
- Expanded chair collision to actual footprints and moved rear-row approaches into the real clear aisle; navigation includes these narrow lanes explicitly.
- Final verification: 53/53 unit/integration tests, production build, complete 3-test browser suite plus final 2 interaction regressions passed. All 71 full-collision routes simulated successfully. New production bundle and 73 picking boxes verified through port 3001; production screenshot capture reported no browser errors.

## Proximity voice, phones, central aisle and chair clearance

- Voice now uses a single audible Web Audio path with listener orientation, HRTF and a smooth 1.5–9m range. Added conservative default gain, AEC/NS capture, disabled AGC, high-pass/soft gate/compression and microphone sensitivity control. Piano remains room-wide.
- Real Edge WebRTC fixture measured near/far/silence, stereo direction reversal, background-noise attenuation, low-frequency rejection and strong-input limiting. This is a deterministic signal test, not a physical-microphone listening evaluation.
- Mobile UI now has an analog joystick, orbit/pinch gestures, compact location/emote menus, large touch interaction buttons, 12-key multi-touch piano, safe-area/landscape layouts and an initial performance preset.
- Clock geometry is at x=0. Removed C08/C09/C10 across all four rows (12 chairs) from derived meshes, picking and collisions; 56 chairs / 59 assets remain. Spawn now faces the central aisle at [-.6,0,-.6]; lectern has a collider.
- Chair-only seated pose moves forward 0.19 avatar units so knees and heels clear the actual chair front; unchanged piano reach. Geometry intersection regression covers all outfits and multiple animation times.
- 68/68 unit/integration tests and production build passed. Remaining seats/routes, four-stage ascent/descent at multiple frame rates and separated 16-player spawns validated.
- Final browser suite 4/4 passed, including CDP touch joystick climb to y=.894, pinch without accidental walking and two-finger piano chords in portrait/landscape. Port 3001 serves the final 56-chair layout and current hashed bundle; local LAN IPv4 health check passed.


## Choir gestures and speech bubbles (2026-09-26)

Implemented server-owned persistent choir poses, 2/3/4-beat conducting with cue/cutoff/dynamics, and ephemeral styled plain-text/emoji chat. Added desktop/touch menus, IME and piano/seat input guards, local bubble preferences, and projected label collision avoidance. Corrected gesture handedness to the avatar perspective. Final verification: 85 unit/integration tests, full 6-test browser suite plus 3 final targeted reruns, production build and port 3001 runtime smoke passed. See VERIFICATION.md and artifacts/social-production-*.png. Ready for local user review.
