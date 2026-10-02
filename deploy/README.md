# IP HTTPS 内测部署

入口：https://124.221.108.122；独立 Compose 项目 `choir407`。
服务器目录 `/home/infinity/apps/407-choir`；现有 OpenClaw 容器及脚本保持各自运行。

## 构建与启动

1. 本机运行 `npm run build`，将后端用 esbuild 打包为 `deploy/runtime/server/index.mjs`（Node ESM、packages external），复制 dist 到 `deploy/runtime/dist`。
2. 上传 package.json、package-lock.json、deploy、布局及 .dockerignore。
3. 服务器执行 `python3 deploy/initialize.py`；secret、app.env、coturn config 都在服务器 `deploy/state`，权限600。
4. `docker compose -f deploy/compose.yaml build app`。此服务器的 Docker Hub 不可达，因此复用已有 Node 24 镜像 `openclaw:local` 作为只读基础层，在独立镜像中添加 Nginx/coturn/Certbot。不会重建或重启 OpenClaw。
5. `docker compose -f deploy/compose.yaml up -d app proxy`，验证 ACME HTTP challenge。
6. `docker compose -f deploy/compose.yaml run --rm certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --preferred-profile shortlived --webroot -w /var/www/acme --ip-address 124.221.108.122`。
7. 将 `deploy/nginx-https.conf` 内容写入已有的 `deploy/state/nginx.conf` 文件（保留文件 inode），验证 Nginx 配置并 reload；`docker compose -f deploy/compose.yaml --profile https up -d turn`。

## 自动续期

运行 `python3 deploy/install_cron.py` 安装任务，保留用户原有 crontab。每6小时运行 `/bin/sh /home/infinity/apps/407-choir/deploy/renew.sh`，输出到 `deploy/state/renew.log`。
续期成功会 reload Nginx，并发送 SIGUSR2 让 coturn 4.6.1 热更新证书；应用和中继进程保持运行，保留房间状态和已有语音连接。

## 云防火墙

TCP22、80、443；TCP/UDP3478；TCP5349；UDP49160–49569。应用3001只绑定服务器 loopback。
腾讯云防火墙和主机 UFW 均已放行上述网站/语音端口。保留原有 SSH 规则。

## 2026-10-01 上线验收

- 公网入口使用受信任的 Let's Encrypt IP 证书，SAN 为 124.221.108.122；首次证书有效至 2026-10-08 04:43:59 UTC。
- `certbot renew --dry-run --run-deploy-hooks` 成功；续期任务已安装，热更新后同一 TLS TURN data channel 仍可传输数据。
- 本机 `scripts/verify_public.mjs` 通过：HTTPS、v3 模型、两名用户、聊天气泡、钢琴、开麦和真实中继音频数据、390×844 手机布局、无页面异常。
- 三种 TURN 通路 UDP/TCP/TLS 均以强制 relay 模式成功收发数据；`scripts/verify_public_signaling.mjs` 通过受信任的 WSS 连接和双用户信令测试。
- 网站 GLB SHA256：`01e7bcd2fde19bfcb1b31722cff91f041fa703f186759ab6d8e4cf4df22a12dd`，与本机模型一致。
- 应用、代理和中继健康检查均通过。OpenClaw gateway 容器 ID `ad7e15251729` 和 CLI `1ae08458c735` 均保持原样；CLI 在部署前已 unhealthy。
- 验收记录和截图在本机 `artifacts/public-verification.json`、`public-signaling.json`、`public-room-desktop.png`、`public-room-mobile.png`。
- 自动化使用浏览器模拟麦克风，实际设备的音量、底噪、手机浏览器性能仍需朋友跨网络试用确认。每人首次需下载约20MB模型；当前服务器出口5Mbps。

## 日常查看

在 `/home/infinity/apps/407-choir` 中执行：

```sh
docker compose -f deploy/compose.yaml --profile https ps
docker compose -f deploy/compose.yaml logs --tail 100 app proxy turn
tail -n 80 deploy/state/renew.log
/bin/sh deploy/renew.sh
```

不要公开或复制到发布包中的 `deploy/state/app.env`、`turn-secret`、`turnserver.conf` 或证书私钥。用户会话保存在应用内存，重新启动 app 会清空当前房间；日常续期热更新不重启 app。

## 更新与回退

### 2026-10-03 移动界面版本

当前Compose指定前端镜像 `choir407:frontend-20261003-mobile-r1`，继承前一性能版本，保留其旧哈希资源。发布目录为 `releases/frontend-20261003-mobile-r1`，发布包SHA256为 `e90bae170d06ce450598bd2897ddf2a78fc3d88b700effd3d5d4d83e4ca7d924`。

沿用下述保留连接的发布方式，新增JS/CSS、manifest.json和icons；通过HTTPS逐文件核对哈希后原子切换首页和Compose。app/turn/proxy的容器ID、启动时间、Nginx PID均未变；没有重启现有服务。公网手机全屏、主屏资源、菜单和摇杆验收通过。

该发布目录内的 `index.before.html`、`compose.before.yaml` 是回到前一性能版本的回退文件；新旧哈希资源都保留。后续重建proxy将使用上述移动版本镜像，当前运行容器仍显示最初镜像名称，具体机制见下一节。

### 2026-10-03 前端性能版本

本次前端镜像为 `choir407:frontend-20261003-r1`，通过 `Dockerfile.frontend` 继承 `choir407:20261001`。新 JS、CSS、LOD worker 和首页在独立发布目录构建；未变化的 GLB、布局及 Draco 解码器沿用基础镜像。发布包 SHA256：`344f8b0c5586c041dc3ded6c87f36f57b2f610ed1e22ab507922e98cb4e964e8`。

服务器发布目录：`/home/infinity/apps/407-choir/releases/frontend-20261003-r1`。其中保留发布脚本、新资源、旧首页、旧 Compose 和容器身份核验记录。

为保留在线 WSS 连接，本次先将新哈希资源复制到现有 proxy 容器，逐个通过 HTTPS 核对 SHA256，再原子替换首页。正式 Compose 已指定新前端镜像，但没有执行 `up` 或重建容器。当前运行容器仍标记旧镜像，静态内容已更新；普通 restart 保留容器可写层，未来 recreate 则从新镜像恢复同样的新内容。后续 `compose up` 会触发 proxy 重建，维护时需考虑在线玩家短暂重连。

本次发布前后 app、turn、proxy 容器 ID/启动时间及 Nginx PID 完全一致。续期目录、配置挂载和服务名保持原有路径。

本次回退无需重启服务：持有 `deploy/state/renew.lock`，将发布目录的 `index.before.html` 复制到 proxy 的 `/srv/407/dist/.index-rollback.tmp`，设为 0644 后 `mv` 覆盖首页；同样原子恢复 `compose.before.yaml` 为正式 Compose。保留新哈希资源以服务已经打开的页面；这些页面刷新后使用旧版。

今后发布前端时，先验证新镜像和资源再切换首页。不要删除唯一旧版本或覆盖同名但内容不同的哈希资源。

先运行本机测试/构建。上传新发布包后保留旧镜像 tag，重建/替换 `choir407`，验证新容器再清理旧发布包。
停用本项目：`docker compose -f deploy/compose.yaml --profile https down`；不会操作其它 Compose 项目。
IP 证书约6天有效，自动续期日志应定期检查；邮箱暂未提供，证书账户采用无邮箱登记。
语音为每房间最多16人的点对点连接，公网实测人数按带宽和设备表现决定。
