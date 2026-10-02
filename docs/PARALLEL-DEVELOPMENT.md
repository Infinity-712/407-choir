# 并行开发

本地 Git 仓库覆盖 `407-choir/web`：网站源码、测试、部署模板、网页模型及贴图。原始照片和 Blender 工程位于上级目录，未纳入本仓库。未配置远程仓库。

## 两个对话使用不同目录

- 现有网站：`E:\Creation\Codex\3D modeling\407-choir\web`。
- 小游戏：`E:\Creation\Codex\3D modeling\407-choir\web\.worktrees\minigames`，分支 `codex/minigames`。

在另一个 Codex 对话中将小游戏目录设为工作目录。开始前用 `git status -sb` 和 `git rev-parse --show-toplevel` 确认目录和分支。两个目录共享 Git 历史，源码及 node_modules 各自独立；不要在主目录切换分支来给另一个对话开发。

可给另一个对话的开场指令：

> 请在 E:\Creation\Codex\3D modeling\407-choir\web\.worktrees\minigames 中开发小游戏，使用现有 codex/minigames 分支。先阅读 README.md 和 docs/PARALLEL-DEVELOPMENT.md。该任务只做本地开发和测试；上线由原对话统一处理。不要修改上级主工作目录。

## 避免本地服务相互干扰

现有网站默认网页端口 5173、后端端口 3001。小游戏在 PowerShell 中使用另一组端口：

```powershell
Set-Location -LiteralPath 'E:\Creation\Codex\3D modeling\407-choir\web\.worktrees\minigames'
$env:PORT = '3002'
$env:WEB_PORT = '5174'
npm run dev
```

访问 http://localhost:5174 。在同样设置了 PORT/WEB_PORT 的终端中运行 `npm run test:browser`，测试也会使用独立服务。单元测试为 `npm test`，构建为 `npm run build`。环境变量只影响当前终端；`.env.example` 仅为说明，Node 服务不会自动加载 `.env`。

## 合并和备份

小游戏完成后先在其工作目录提交并测试，再回主目录合并 `codex/minigames`。修改同一源码文件时 Git 可能要求解决冲突；独立目录避免开发过程中的覆盖，不能消除合并冲突。

用 `git worktree list` 查看目录，用 `git log --oneline --all --graph` 查看提交。源码修改只有提交后才成为可恢复版本。此仓库仅在本机，尚不是异地备份。

`.gitignore` 排除 node_modules、构建/测试产物、发布包、工作树、真实环境文件和 deploy/state（证书及部署凭据）；只跟踪 `.env.example` 模板。上传任何远程仓库前再核查待发布文件。
