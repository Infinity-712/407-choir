# 抢凳子开发交接

日期：2026-10-03。工作目录为 `E:\Creation\Codex\3D modeling\407-choir\web\.worktrees\minigames`，分支为 `codex/minigames`。所有小游戏改动在这个工作树完成；合并回主目录及部署由主对话处理。当前任务仅本地开发、测试与交接，未执行部署。

## 本地运行

```powershell
Set-Location -LiteralPath 'E:\Creation\Codex\3D modeling\407-choir\web\.worktrees\minigames'
$env:PORT = '3002'
$env:WEB_PORT = '5174'
npm run dev
```

网页地址为 http://localhost:5174，后端为 http://localhost:3002。保持终端运行；停止时按 Ctrl+C。这组端口与主工作目录的 5173/3001 分开。环境变量仅影响当前终端，项目不会自动加载 `.env`。

在设置了同样端口的终端执行检查：

```powershell
npm test
npm run build
npx playwright test tests/browser/minigames.spec.ts
```

完整浏览器回归使用 `npm run test:browser`，依赖本机 Edge。浏览器测试包含真实 Socket.IO 通道，使用模拟麦克风；脚本验收仍需要朋友在真实设备和网络上补充试玩。

## 规则与操作

- 常驻「派对游戏」打开抢凳子规则及报名。首位报名者成为主持，3–6 人报名后可开始。未报名或晚加入者观战，不能抢游戏凳子。
- 倒计时 3 秒后播放随机 9–14 秒鼓点。停止时间由服务器决定，并且不提前发送给客户端。
- 音乐期间参赛者必须走动，不能坐普通椅子、弹琴或指挥。最近 4 秒实际距离至少 0.8 米、位置跨度至少 0.4 米，并有不同时间的有效位移采样，才有本轮抢座资格。转向或微小抖动不算。
- 音乐停止后，点击动态凳子或阶段条上的编号，走近后自动抢座；电脑也可自行走近按 E 或点「抢这个凳子」。服务器按有效请求到达顺序分配，每椅一人、每人一椅。
- N 位存活者对应 N−1 把椅子，每正常轮淘汰一位。轮间停留 3 秒后重新摆椅；最终两人争最后一把。冠军必须实际抢到最后一椅。
- 抢座限时 12 秒。超时多人未落座时，优先淘汰未达标者，再按较少走动距离、报名顺序确定一人，并公布原因。决赛无人落座则结束比赛，不产生空抢冠军。
- 关闭面板继续参赛。打开面板点「退出本局」可退赛；主持可「结束本局」。断线、离开小屋按退赛处理，主持离开会转交；全部原参赛者离线后自动开放新一局报名，观众不会被留在无法重开的结果页。退赛只剩一人时可判退赛胜利，全部退赛则结束比赛。
- 淘汰者继续留在房间聊天、观战。冠军可点名其他仍在线的本局参赛者唱歌；全房间可见点名，被点名人物显示「🎤 被选唱歌」，本人界面提示轮到自己唱歌。点名不会强制开麦或录音，唱歌者自行开启麦克风。
- 结束后主持或冠军可点「再玩一局，重新报名」。普通房间椅子、钢琴、指挥和原有聊天/语音功能继续沿用。

## 关键文件与接入点

| 文件 | 职责 |
| --- | --- |
| `shared/minigames.ts` | 公共状态/action 类型、人数/时间/走动参数、动态椅生成、动态碰撞与 `getMinigameLayout`。 |
| `shared/protocol.ts` | 在原有 `RoomState` 上追加可选 `minigame`；`Player.positionVersion` 用于本人强制移位同步，保持现有玩家 `Mode`，游戏落座仍为 `sit`。 |
| `server/minigames.ts` | 每房间权威状态机、私有随机音乐截止时间、实际位移资格、原子抢座、逐轮淘汰、超时/退赛、冠军点名。 |
| `server/room.ts` | 命令、有效移动采样、快照、50ms flush 推进、动态互动释放和离场接入；移动采用共享有效布局。 |
| `server/index.ts` | 注册 `minigame` Socket.IO 事件，沿用现有房间隔离与状态广播。 |
| `src/scene/PartyScene.ts` | 参数化临时椅、参赛/冠军/唱歌人物徽标与资源清理。 |
| `src/scene/RoomWorld.ts` | 动态椅渲染/拾取/寻路、共享有效布局、原指挥家具暂时隐藏、强制迁移后的本地坐标/路径更新。 |
| `src/components/PartyGames.tsx` | 规则、报名、主持操作、赛中状态与动态椅编号、退赛、冠军点名及结果。 |
| `src/party.css` | 桌面/手机面板及阶段条布局。 |
| `src/audio/PartyAudio.ts` | 同步自制鼓点、开始/停止与离房清理，后续真实音乐的替换入口。 |
| `src/App.tsx` | 常驻入口、小游戏命令与状态、场景互动、音频生命周期接入。 |
| `tests/minigames.test.ts` / `tests/minigames-server.test.ts` | 假时钟规则验证和真实 Socket.IO 命令测试。 |
| `tests/minigame-layout.test.ts` / `tests/party-scene.test.ts` / `tests/party-audio.test.ts` | 共享空间、场景生命周期和占位音频验证。 |
| `tests/browser/minigames.spec.ts` | 浏览器操作与真实网络参赛者的完整两轮、点名、6人报名上限、390px手机规则，以及真实触屏摇杆位移和568×320横屏验收。 |

临时椅使用每局/每轮独立 ID，每房间独立占有；观众、旧局/旧轮请求不能抢座，成功抢座的重发请求按规则幂等处理。原始 GLB 未修改，场景中的指挥台及指挥凳在活动期间暂时隐藏，服务端和客户端同步使用共享布局移除对应碰撞。结束时释放动态椅占用、恢复原家具，并将落在恢复碰撞中的角色迁移到合法位置。每个 `Player.positionVersion` 通知该客户端清理旧路径并采用权威位置，其他人抢座不会打断本人的路线。全局 `minigame.teleportVersion` 保留用于场景迁移计数，客户端不再据此取消自己的导航。指挥家具按 GLTFLoader 保留的原名或清理后的节点名识别，隐藏与恢复7个部件。参赛者每轮首次使用左侧俯视的默认视角（yaw −π/2、pitch 0.6、distance 3.4m），避开前侧柜墙；之后拖动和缩放保留，不会被普通状态更新重置。合并主对话相机优化时保留此新轮初始化入口，通用相机约束沿用主对话实现。

## 后续接入用户音频

当前使用程序合成鼓点，不依赖外部音频文件。用户提供音乐后，可把获准使用的音频放入 `public/assets`，在 `PartyAudio` 中加载并解码为 `AudioBuffer`，用 `AudioBufferSourceNode` 替换鼓点声源。保持 `sync`、`setVolume`、`dispose` 接口及统一 `AudioContext`，让现有 UI 和清理流程继续工作。

根据公开的 `phaseStartedAt` 与服务器时间偏移定位播放进度；中途加入或网络恢复时从当前偏移播放。音轨可循环至服务端停乐，收到 `scramble` 或其他非音乐阶段立即停止并断开音源。随机停止仍属于服务端，不能改成客户端按音轨结尾决定，也不能把未来停止时间公开。离房、取消、重开及组件卸载都要停止所有旧音源。新的曲目选择/索引需由房间状态统一广播，避免不同客户端随机选曲。

## 验证记录

主代理当前已确认 `npm test` **136/136 通过**，`npm run build` **通过**。`PORT=3002 WEB_PORT=5174 npm run test:browser` **13/13 通过**（2.5分钟）：包括4项小游戏、原有真实触屏、钢琴/语音/指挥、捏脸、画质及聊天/动作。已完成独立代码审查和真实GLB截图检查，`git diff --check` 通过；房间GLB与原提交的Git对象哈希均为 `7a742c36d3c2729cdff9c4422f551f6412b013db`。

合并前由主对话核对最终验证、Git diff 和提交，再在主工作目录合并 `codex/minigames`；同文件的主分支改动需要人工解决冲突。继续遵守 [并行开发目录约定](PARALLEL-DEVELOPMENT.md)。

验收截图（本地 `artifacts`，未纳入Git）：

- `minigames-scramble-desktop.png`：临时凳子、阶段条与抢座操作，指挥家具隐藏。
- `minigames-winner-desktop.png`：冠军与全房间可见点名。
- `minigames-phone-rules.png`：390px报名规则、可持续访问的关闭按钮。
- `minigames-phone-landscape.png`：568×320横屏阶段条与真实摇杆走动结果。

开发预览保留在5174/3002；主对话合并时重点核对 `src/App.tsx`、`src/scene/RoomWorld.ts`、`server/room.ts` 和 `shared/protocol.ts` 与其并行改动，保留主对话最新优化并接入小游戏模块。浏览器测试 `tests/browser/social.spec.ts` 的唯一改动是等待钢琴界面完成退出后再点指挥台，防止把尚未结束的交互误认为已退出。
