@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules\ (
  call npm install
  if errorlevel 1 exit /b 1
)
if not exist dist\index.html (
  call npm run build
  if errorlevel 1 exit /b 1
)
echo 407 合唱小屋：http://localhost:3001
echo 请保持此窗口开启；按 Ctrl+C 停止。
start "" "http://localhost:3001"
call npm start
