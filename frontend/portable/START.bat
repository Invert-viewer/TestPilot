@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "TESTPILOT_NODE=%~dp0runtime\node.exe"
if exist "%TESTPILOT_NODE%" goto run
where node.exe >nul 2>nul
if errorlevel 1 goto missing
set "TESTPILOT_NODE=node.exe"
:run
"%TESTPILOT_NODE%" "%~dp0server.cjs" %*
if errorlevel 1 goto failed
exit /b 0
:missing
echo 缺少 runtime\node.exe，请先完整解压压缩包，再运行本脚本。
goto failed
:failed
echo.
echo 前端未能启动，请阅读上方提示和“00-先读我.md”。
if not defined TESTPILOT_NONINTERACTIVE pause
exit /b 1
