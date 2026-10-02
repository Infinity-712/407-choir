# 407 Choir Party Implementation Plan

> **For agentic workers:** Use subagent-driven-development for independent tasks. User explicitly requested execution; no additional approval gate.

**Goal:** 可试玩的多人合唱室网站，含可爱捏脸、房间交互、钢琴和语音。
**Architecture:** React UI manages entry and overlays; Three.js renders real exported room and procedural avatars. Socket.IO authoritative room service and browser WebRTC voice share participant IDs.
**Tech Stack:** TypeScript, React, Three.js, Vite, Socket.IO, Web Audio, WebRTC, Playwright.
**Spec:** ../specs/2026-09-26-party-design.md

## Global Constraints
原Blender文件只读；角色自制；全房间语音；仅演奏者本人禁止开麦；退出演奏不自动开麦；默认关麦；无假玩家；不投射照片。

## Review Focus
权限晚返回时进入钢琴；多人同抢物件；按住音符时断网；后来加入和重连；模型和玩法坐标一致。

## Tasks
- [x] 1. Export room: scripts/export_room.py -> public/assets/room.glb + interaction-layout.json + export-report.json. Verify chair count, MIDI keys, original file untouched, triangle/file size.
- [x] 2. Avatar studio: src/avatar/AvatarRig.ts and AvatarPreview.tsx; shared/avatar.ts validation. Real geometry changes, animations, disposal. Test malformed stored/network config before implementation; inspect browser appearance.
- [x] 3. Multiplayer: server/room.ts, server/index.ts, tests/room.test.ts. Shared protocol in shared/protocol.ts. Test competing claims, malformed events, disconnect notes, mic restrictions, room isolation first. npm test.
- [x] 4. Client: src/App.tsx, src/scene/RoomWorld.ts, src/audio/PianoAudio.ts, src/audio/VoiceChat.ts, src/styles.css. Implement entry studio, controls, interactions, UI, audio and networking. Test permission race and collision logic where material.
- [x] 5. Integration: build, independent review, Playwright two-client tests, rendering screenshots and documented launch/deployment steps. npm run build, npm test, npm run test:browser.

## Interfaces
shared/protocol.ts is authoritative. Layout uses Y-up [x, z, -y]. Avatar faces +Z, standing root at feet; seated root at seat anchor. Events: join, move, claim, release, avatar, mic, emote, piano, tempo, signal; server publishes state, piano, signal. Ack={ok,error?,id?,state?}. Voice signaling must only target users in same room.

