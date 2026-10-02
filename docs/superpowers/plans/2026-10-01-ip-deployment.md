# 407 IP HTTPS Deployment Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved deployment inline, task by task.

**Goal:** Publish the approved v3 party room at https://124.221.108.122 with multiplayer, microphone and TURN fallback.

**Architecture:** An independent Docker Compose project serves the existing Node application behind Nginx. Certbot issues a short-lived public-IP certificate and renews it automatically. Coturn uses server-side shared-secret authentication; the application issues temporary client credentials.

**Tech Stack:** Existing React/Three.js/Socket.IO, Node 24, Docker Compose, Nginx, Certbot >=5.4, coturn.

**Spec:** User-approved IP HTTPS + Docker/Nginx + TURN rollout in this chat, 2026-10-01.

## Global Constraints

- Preserve the two OpenClaw containers and existing scripts; independently named Compose project and directory.
- Approved scene v3, 56 chairs, four keyboard instruments and current interaction IDs.
- Do not expose TURN shared secret or SSH private keys in client responses, logs, image layers or repository files.
- Tencent cloud firewall changes are performed by the user; SSH does not grant cloud-account API access.
- Certificate renewal and reload must be automatic for the approximately six-day IP certificate.
- No Git repository exists; track execution in this document and keep rollback artifacts.

## Review Focus

- Browser cache must not retain stale credentials or stale interaction layout.
- UDP-blocked networks must have TCP/TLS TURN alternatives.
- A changed certificate must reload Nginx and coturn while preserving game state.
- Remote image registries may be unavailable; verify transport and use trusted local image/runtime fallback.
- HTTP success alone does not prove HTTPS, WebSocket or real relay connectivity.

## Task 1: Temporary TURN credentials

Files: server/turn.ts, server/index.ts, src/audio/VoiceChat.ts, tests/turn.test.ts, .env.example.

- [x] Test expiry username, HMAC-SHA1 authentication, random user isolation, URL/TTL validation, no master-secret exposure, and public API integration.
- [x] Implement makeTurnCredentials(options) with a six-hour TTL, read TURN_SHARED_SECRET/TURN_URLS server-side, retain existing ICE_SERVERS compatibility.
- [x] Refresh browser ICE configuration every 15 minutes and dispose the timer.
- [x] Run the unit suite and production build.

## Task 2: Independent deployment stack

Files: deploy/Dockerfile, deploy/compose.yaml, deploy/nginx*.conf, deploy/initialize.py, deploy/renew.sh, deploy/README.md, .dockerignore.

- [x] Package backend and built frontend without local secrets or unrelated Blender sources.
- [x] Generate secret and coturn config on the server with restricted permissions; configure its NAT mapping 124.221.108.122/10.0.0.15 and UDP 49160–49569.
- [x] Start HTTP ACME challenge endpoint and verify it from outside the server.
- [x] Issue trusted IP certificate with Certbot, enable HTTPS and coturn TLS.
- [x] Install a user cron renewal job, reload certificate consumers after successful renewal.
- [x] Verify Compose configuration, Nginx syntax, health checks and unchanged OpenClaw container identities/status.

## Task 3: Public acceptance

- [x] Verify trusted certificate, HTTPS health, v3 asset hash and WebSocket multiplayer over the public address.
- [x] Exercise desktop/mobile interactions and forced relay WebRTC with fake capture; document that actual microphone listening remains a human field test.
- [x] Verify certificate renewal command and log/job installation.
- [x] Report live URL, verification evidence and any firewall dependency accurately.

## Execution ledger

- SSH key added and tested; infinity belongs to sudo and docker groups. Sudo requires a password, but Docker access works.
- Existing OpenClaw runs on loopback ports 18789/18790. Ports 80/443/3478/5349 are free.
- User asked to add cloud firewall 443 TCP, 3478 TCP+UDP, 5349 TCP, UDP 49160–49659.
- Task 1: complete. TURN tests observed module-missing RED, then all96 unit tests GREEN; production build exits0.
- Task 2: package uploaded and isolated image building; Debian repository mirror works. Existing OpenClaw gateway healthy and CLI unhealthy before deployment; neither restarted.
- Ruling: use photographed UDP49160–49569 firewall range — 410 ports fit the current16-person room with RTCP multiplexing; config matches actual firewall.
- Ruling: Docker Hub unavailable — reuse trusted local Node24 image layers for independent choir407 image; adds Nginx/coturn/Certbot without modifying source image or OpenClaw containers.
- Host UFW initially allowed only22, causing external HTTP timeout despite correct cloud rules. Added only required web/TURN ports; external ACME challenge then passed.
- Trusted Let's Encrypt IP certificate issued by Certbot5.8.0; HTTPS health succeeds from outside without bypassing certificate validation.
- Independent review raised a P1: restarting coturn during renewal would destroy allocations without ICE recovery. Fixed at the renewal hook by using coturn4.6.1's SIGUSR2 certificate reload; reviewer confirmed the fix. Same forced-TLS relay data channel kept transmitting through the real hook, with unchanged connection.
- Renewal dry-run and deploy hook passed. Every-six-hour user cron installed, retaining all original entries.
- Public browser acceptance passed for two users, chat, piano, microphone, forced relay audio, mobile viewport and zero page errors. UDP/TCP/TLS relay paths all passed; separate trusted WSS join/signaling smoke passed.
- Remote asset SHA256 matches local v3 GLB. App/proxy/turn healthy; OpenClaw IDs and statuses unchanged. Evidence and field-test limits recorded in deploy/README.md.
- Final release archive uploaded after the hook fix and cron installer were included; package excludes server state, SSH keys and environment secrets. SHA256:777ce6d373c26fd4f169149aecad8d391333ca9006f168ea66b737addde55ac1.
