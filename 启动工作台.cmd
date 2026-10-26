@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo 缺少项目 Python 环境。请按 README 的快速开始安装依赖后重试。
  echo python -m venv .venv
  echo .venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -c "import tkinter" >nul 2>&1
if errorlevel 1 (
  echo 当前 Python 未安装图形窗口组件，将使用终端启动。
  ".venv\Scripts\python.exe" scripts\startup.py start
  pause
  exit /b
)
if exist ".venv\Scripts\pythonw.exe" (
  start "" ".venv\Scripts\pythonw.exe" "scripts\launcher_ui.py"
) else (
  ".venv\Scripts\python.exe" "scripts\launcher_ui.py"
)
