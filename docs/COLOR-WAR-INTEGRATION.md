# 颜色战争：本地开发与合并

## 分支和范围

- 分支：`codex/minigames-color-war`，从 `codex/minigames` 的 `fe2d847` 创建。
- 本功能工作树：`E:\Creation\Codex\3D modeling\407-choir\web.worktrees\minigames`。
- 原 `codex/minigames` 工作树位于 `web\.worktrees\minigames`，当时已有抢凳子未提交修改。本分支独立开发，没有修改该目录。
- 只实现颜色战争。未合并其他小游戏、未发布、未改云服务器或部署配置。

```powershell
Set-Location -LiteralPath 'E:\Creation\Codex\3D modeling\407-choir\web.worktrees\minigames'
$env:PORT = '3002'
$env:WEB_PORT = '5174'
npm run dev
```

访问 http://localhost:5174 。先确认这两个端口空闲，避免与另一个小游戏对话同时启用服务。测试使用同样两个环境变量；单元及 Socket.IO 集成测试使用内部假时钟或临时端口。

**本次并行测试例外：** 用户已允许颜色战争临时使用网页 **5175** / 后端 **3003**，因为抢凳子正在占用 5174/3002。复现本次测试时，将上述 `WEB_PORT` / `PORT` 改为 `5175` / `3003`。

浏览器测试默认拒绝复用已经占用的端口，防止把另一个工作树当成本分支测。只有确认运行服务属于本工作树时，才设 `$env:PW_REUSE_SERVER='1'` 复用它；通常停止本地预览后让测试自己启动服务即可。

## 玩法

1. 从常驻工具栏的游戏手柄进入「颜色战争」，选择声部队伍。
2. 总共2–20人，每队最多4人，至少两队且全员准备后，由第一位报名者开局。倒计时3秒，一局180秒。
3. 拖动画面选择水平方向，滑杆调整仰角，F或触屏按钮投掷。气球受重力影响，墙体和家具阻挡。投掷间隔650毫秒，命中后900毫秒保护；敌队 +10，友伤 −8。
4. 开局8秒后出现首个任务，此后约每25秒出现一个、持续20秒。幸运座位绑定真实空闲椅子，首先坐下 +20；旋律从6段简短白键乐句中随机选择，均在 C4–B4 内、共5音，实际弹琴首先完成 +15，并获得12秒三连散射。重复按住一个键不能刷进度，音符间隔超过3秒重来。
5. 颜料3秒消退。最高队分获胜，平分并列；主持可结束或重置。主持离开后自动继任；人数或队伍不足时结束本局。局中未报名者旁观，结束后再加入。

所有得分、弹道、碰撞、奖励和计时由后端决定。客户端只提交选队、准备、投掷方向等意图。弹琴和指挥时不允许投掷；正常聊天、空间语音与钢琴广播沿用已有功能。

## 队伍颜色

SATB 没有统一的全球代表色。本游戏采用一个已公开的合唱教学配色：S红、A蓝、T绿、B黄，P按需求使用白色；配合字母和深色轮廓辨认。

- 教学配色依据：[Emily Tully — Making sense of ensemble and choir music](https://www.emilytully.co.uk/post/making-sense-of-ensemble-and-choir-music)。
- 不同团体使用不同颜色的例子：[Liberty Singers — How I arrange my choirs](https://libertysinger.com/how-i-arrange-my-choirs/)。
- 颜色值集中在 `shared/color-war.ts`，后续可按本团习惯替换。

## 合并接口

| 模块 | 合并时保留的内容 |
| --- | --- |
| `shared/color-war.ts` | 独立类型、规则常量、队色、命令名、发射原点 |
| `shared/protocol.ts` | `RoomState.colorWar?`，不改变普通玩家模式 |
| `server/color-war.ts` | 每房间一个 `ColorWarGame`，可注入时钟/随机源 |
| `server/room.ts` | 20人房间上限；命令路由、快照与 tick；真实 claim / piano / release / leave 钩子 |
| `server/index.ts` | Socket.IO 注册 `COLOR_WAR_COMMANDS` |
| `src/minigames/ColorWarPanel.tsx` / `.css` | 大厅、规则、队分、任务、投掷按钮、手机布局 |
| `src/minigames/ColorWarEffects.ts` | 队伍圈、气球、短时颜料、奖励座位标记，独立销毁 |
| `src/App.tsx` | 常驻入口、弹窗状态、F快捷键、刷新位置后投掷、真实任务导航 |
| `src/scene/RoomWorld.ts` | 相机朝向提供投掷方向、方向箭头、队名字母、效果生命周期 |

事件名统一使用 `color-war:*`。独立引擎不会修改普通玩家位置或占用状态。合并抢凳子时，保留两个游戏各自的字段/路由，不要用其中一个覆盖另一个。

**统一小游戏菜单时：** 把当前 `openColorWar` 入口挂到总菜单即可。主对话还应增加房间级活动互斥，避免同一房间同时运行抢凳子与颜色战争；本分支没有抢凳子的最新协议，未假定其接口。`App.tsx`、`RoomWorld.ts`、`room.ts` 和 `protocol.ts` 是最可能需要手动合并的位置。

## 验证和限制

```powershell
npm test
npm run build
npm run test:browser -- tests/browser/color-war.spec.ts
```

测试包括规则和20人容量、薄墙/家具碰撞、友伤与保护期、奖励时限、真实椅子与钢琴协议、断线和重置、真实 Socket.IO 房间隔离、特效销毁，以及桌面/手机浏览器的共享比赛。截图输出到忽略跟踪的 `artifacts/color-war-*.png`。

2026-10-03 本分支验收：`npm test` **136/136通过**；生产构建通过；`color-war.spec.ts`、`mobile.spec.ts`、`social.spec.ts` **4/4通过**（5175/3003）。已检查桌面、手机大厅、手机对局及横竖屏钢琴截图。独立审查发现的命中尺寸、结算弹层和琴键遮挡问题均已修复。

20人容量通过逻辑测试；浏览器联调使用双人，并非20台设备压力测试。空间语音仍是原来的点对点实现，服务器带宽与手机性能需由主对话上线前实测。比分仅保存在内存，不设持久排行榜。
