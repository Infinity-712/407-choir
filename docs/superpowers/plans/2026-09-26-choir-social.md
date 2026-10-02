# Choir gestures and speech bubbles implementation plan

**Goal:** Add expressive conductor gestures, toggleable held choir poses and customizable multiplayer speech bubbles to the existing room.

**Architecture:** Keep server-authoritative room snapshots and existing Socket.IO transport. Add synchronized pose/chat state and conductor meter/cues; animate the existing procedural avatar and render plain-text DOM bubbles above name labels. Small React components own the composer and action menu; App owns interaction gating.

**Tech stack:** TypeScript, React, Three.js, Socket.IO, node:test, Playwright.

**Spec:** User request in this task: common conducting gestures, slowly raised/held arms and opposite-chest hand poses toggled off with the same button, typed and emoji speech bubbles above names, customizable bubble style. Implementation is authorized by the user; preserve existing lighting, room geometry, piano and distance voice.

## Contract

- `ChoirPose`: raise-left/right/both, hand-left-chest (left hand on right chest), hand-right-chest (right hand on left chest).
- `Player`: pose, poseAt, chat. Held poses persist while walking/sitting and under temporary emotes; entering piano/conduct clears them. Explicit pose null restores neutral smoothly.
- `ConductorGesture`: beat, cue, crescendo, diminuendo, cutoff; conductor gains beats (2/3/4), gesture and gestureAt. Only owner may change. Cue starts, cutoff stops; expressive cues return to beat/rest after animation.
- `BubbleStyle`: palette cream/lavender/mint/peach; shape round/cloud. Store preference locally and send with each message.
- `ChatBubble`: text, style, at, until. Eight-second latest message, max80 Unicode codepoints, plain text only, independent rate limit1/sec burst2, isolated to room.
- Avatar animate options gain optional pose,poseAt,now(epoch ms),conductor. Client uses state.serverTime offset.

## Review focus

- IME Enter/Escape must not send prematurely or release a seat; composer suppresses movement/piano shortcuts and clears held inputs.
- Late join/expiry and different rooms cannot resurrect or leak messages.
- Shared materials/lighting/geometry and original Blender assets remain unchanged.
- Actual hand positions must cross toward opposite chest without clipping; piano/seat geometry regressions remain green.
- Touch UI must fit360px screens and landscape, including composer keyboard inset.

## Tasks

- [x] Server/shared: Write failing command tests for pose persistence/reset, owner-only conductor meter/cues, Unicode/style validation/rate/expiry, and room isolation; implement contracts/handlers and verify targeted tests. Owner social_state_recon.
- [x] Avatar: Write failing hand/transition/meter tests; add focused gesture sampler/arm targeting; preserve pelvis/legs/piano; verify avatar tests. Owner social_avatar_recon.
- [x] Components: Add ChatComposer, SocialActions and social.css with local style persistence, IME handling, touch controls and palette/shape preview. Owner hosting_options_research.
- [x] Integration: App routes new commands, unifies input gating, adds composer/actions and conductor meter/cues. RoomWorld renders separate name/bubble nodes, server-time expiry and viewport-aware positioning. Owner root.
- [x] Verification: Real two-browser pose/chat/style/expiry checks, piano and seated typing guards, mobile composer/layout and screenshots; full unit suite and production build; update local service and documentation. Owner root.

## Verification commands

`npm test`, `npm run test:browser`, `npm run build`; browser artifacts under `artifacts/`. No Git repository exists here; changes stay in the current shared workspace.
