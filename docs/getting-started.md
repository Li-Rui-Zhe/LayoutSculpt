[项目首页](../README.md) / [文档中心](README.md)

# 开始使用

<sub>LayoutSculpt / 使用指南</sub>

<details>
<summary>本页导航</summary>

- [环境要求](#环境要求)
- [首次安装与启动](#首次安装与启动)
- [连接你的 AI](#连接你的-ai)
- [数据与维护](#数据与维护)
- [下一步](#下一步)

</details>

从准备本机环境，到打开第一个空间。这里集中说明安装、启动、AI 连接、开发端口和数据备份。

## 环境要求

| 依赖 | 说明 |
| --- | --- |
| Node.js | 22+ |
| pnpm | 前端依赖和项目命令，使用 `pnpm-lock.yaml` |
| Python | 3.11+；当前固定依赖在 Windows、Python 3.13.5 下验证 |
| AI 来源 | 本机已登录的 Codex CLI，或在「AI 接入」中连接 DeepSeek API；户型识别需支持图片理解的模型 |
| 验收浏览器 | Windows 默认 Edge，Mac 默认 Playwright Chromium；日常使用支持 WebGL 的浏览器 |

Codex 可复用本机环境，也可由项目准备独立 CLI、配置与登录；独立模式不复制原登录凭据、不修改全局模型配置。Blender 仅用于可选的离线家具源工程制作。

## 首次安装与启动

以下命令在 Windows PowerShell 中运行，项目目录可放在 D 盘：

```powershell
git clone git@github.com:Li-Rui-Zhe/LayoutSculpt.git D:\LayoutSculpt
cd D:\LayoutSculpt
pnpm install --frozen-lockfile
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
pnpm build
pnpm start
```

打开 **http://127.0.0.1:8000/**。API 文档：http://127.0.0.1:8000/docs。

安装并构建后，Windows 日常使用只需双击项目根目录的 **启动工作台.cmd**：自动检查、启动并打开页面；当前项目已经运行时直接复用。成功后启动窗口自动关闭，后台继续运行。遇到问题才显示简短原因、重试与日志入口。也可使用 `pnpm launch` 打开启动窗口（需要 Python 的 Tk 组件）。

`pnpm start` 使用单个 FastAPI 进程同时提供构建页面和 API，只监听本机，并自动打开浏览器；加 `--no-browser` 可关闭自动打开。修改前端后需重新 `pnpm build`。终端 Ctrl+C 只关闭该次命令新启动的服务，不关闭已经运行并被复用的服务。

同为 Windows、Python 3.13.5 的环境，可用 `backend/requirements.lock.txt` 替代范围依赖文件安装，复现已验证的 Python 包版本。其他环境使用 `requirements-dev.txt` 并运行测试。

macOS 安装时，请在项目目录重新创建 Python 环境，不要复制 Windows 的 `.venv`：

```sh
pnpm install --frozen-lockfile
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt
pnpm build
pnpm start
```

启动脚本优先使用项目 `.venv`，找不到时在 macOS 优先查找 `python3`。本机 Codex 优先读取 `CODEX_CMD` / PATH，并补充常见 Homebrew 安装路径；需要时在 `.env` 中指定完整路径。Windows 已完成本机验收；CI 已配置 Windows、macOS Intel / Apple Silicon 检查，尚需实际运行确认，Mac 桌面使用体验仍待实机验收。Mac 浏览器验收前执行 `pnpm exec playwright install chromium`。

## 连接你的 AI

在左侧打开「AI 接入」，选择 DeepSeek API 或 Codex。顶部会展示保存的来源、具体模型与密钥脱敏标识；选择模型后点击保存，新任务使用新的默认配置。

DeepSeek 的完整密钥不回显；留空保留旧密钥，更换时再填写。户型识别需要视觉模型，只有文字能力的模型仍可用于无参考图的家具和材质创作。完整说明见 [AI 接入](ai-connections.md)。

### 开发模式

```powershell
pnpm dev:all
```

前端 http://127.0.0.1:5173/，后端 http://127.0.0.1:8000/。也可在两个终端分别运行 `pnpm dev` 与 `pnpm dev:api`。开发模式与 `pnpm start` 共用 8000 端口，选择一种后端启动方式。

如果 5173 已被其他项目占用，在项目 `.env` 设置 `STUDIO_FRONTEND_PORT=5176` 并重启前后端。Vite、启动脚本和后端写入来源校验共用此配置，只允许配置的开发端口与 8000 页面，不会自动放行其他本机端口。不要单独传 `--port`。`pnpm start` / `pnpm dev:api` / `pnpm dev:all` 会先识别端口上的项目：同一项目与数据目录可复用，其他程序或旧版本无法确认身份时提示原因，不自动结束进程、不自动跳到其他端口。普通使用仍可直接打开 http://127.0.0.1:8000/。

连接异常时网页只显示一条可关闭的提示，可点击重新检测；检测不会刷新页面或清空编辑，不自动重放生成、删除等操作。若更换端口，请先备份未同步内容，浏览器草稿不能跨端口自动迁移。启动日志保存在 `data/logs/`；可以运行 `pnpm start --check` 只检查服务，不启动或关闭任何进程。服务身份检测用于防止误连，不替代用户认证；本项目仍面向本机单人使用。

<details>
<summary><strong>配置本机模型、超时与数据目录</strong></summary>

### 配置

AI 来源在「AI 接入」页面选择并保存；选择 Codex 时可继承本机登录和模型配置，选择 DeepSeek API 时使用接入页保存的连接。需要覆盖项目环境选项时：

```powershell
Copy-Item .env.example .env
```

| 变量 | 默认值／用途 |
| --- | --- |
| `CODEX_CMD` | 可选，指定已经安装的 CLI 路径；默认从 PATH 查找 |
| `CODEX_MODEL` | 可选，项目优先使用的模型，不改全局配置 |
| `CODEX_EFFORT` | `medium`，按实际模型能力适配 |
| `CODEX_TIMEOUT_SECONDS` | `600`，单阶段 AI 总预算，包含修正和重连 |
| `AI_REVIEW_TIMEOUT_SECONDS` | `300`，可选 AI 复核上限，不超过阶段预算 |
| `AI_CACHE_ENABLED` | `true`，复用完全匹配且通过当前校验的阶段结果 |
| `MODEL_TIMEOUT_SECONDS` | `180`，本地模型构建等待上限 |
| `JOB_CONCURRENCY` | `2`，同时处理任务上限 |
| `STUDIO_FRONTEND_PORT` | `5173`，前端、启动器和后端共同使用的开发端口 |
| `STUDIO_DATA_DIR` | 项目 `data/`；可指定其他本地数据目录 |

Windows 下，未显式设置 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY` 时，CLI 子进程继承启用的系统手动代理；不修改系统设置。修改代理后重启项目。

生成页面从所选 AI 来源获取实时模型目录，可手动刷新。户型识别要求模型支持图片，实际权限取决于账号及服务商。失败后默认沿用原设置，在同一任务里“继续生成”；更换模型与推理强度通过次级入口建立独立新版本，不会静默替换模型。`.env`、登录文件及 API 密钥不得提交仓库。

</details>


## 数据与维护

升级前停止服务，备份整个 `data/` 及本机 `.env`；恢复时停止服务并整体还原，保持任务数据库与检查点对应。浏览器未提交草稿需另行保存为模型版本。

仓库包含代码、说明和必要公共资产，不包含用户任务原图、生成成果、数据库、缓存、日志、CLI 安装或本地凭据。若配置项目目录外的数据位置，也应自行备份并排除于 Git。


### 本机备份与缓存

“使用帮助 → 本机数据与备份”可查看占用、安排备份或恢复。数据版本升级前自动备份；手动安排的备份、恢复在下次启动时执行，运行期间不会覆盖正在编辑的数据。恢复前先验证文件摘要并另存当前数据，保留最近 3 份备份（正在恢复的来源额外保留）。不包含 `.env`、API 密钥、Codex 登录及尚未同步的浏览器草稿。备份在同一磁盘的 `data/backups/`，不能替代异盘备份。

AI 缓存每 6 小时检查，最多保留 30 天及 512 MB；清理不会删除项目、生成成果或用户素材，首次重新分析可能稍慢。启动数据操作失败会停止加载数据，原数据保留；可在日志中查看原因。

开发者：涉及数据库或数据格式变化的发布必须更新 `backend/app/data_maintenance.py` 的 `DATA_VERSION`，在迁移前触发备份。

当前为本地单人产品，尚不提供多人账号隔离、云端调度、完整寻路、精确门扇扫掠或施工安全判断。


## 下一步

- [设计工作流](design-workflows.md)：上传户型、核对结构、编辑与保存。
- [AI 接入](ai-connections.md)：来源、模型、登录和密钥。
- [测试说明](testing.md)：开发验证与真实 AI 质量评估。

---

[← 文档中心](README.md) · [返回项目首页](../README.md)
