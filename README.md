# 造个家

把二维户型图变成可旋转、可调整、可下载的三维空间。

面向**本地单人使用**：浏览器连接本机服务，任务保存在本机。AI 识别户型，用户确认结构后，程序生成真实 GLB；普通生成无需安装 Blender。

## 功能

- 上传 PNG、JPEG 或 WebP 户型图，最大 20 MB。
- 并排核对原图与识别结构，手动调整墙体、空间、门窗和通道。
- 在确认结构中规划家具，复用 14 类家具资产，生成带材质的 GLB。
- 三维／俯视、完整墙体／剖切、白天／夜晚及材质预览。
- 手动编辑家具、灯位、尺寸、朝向和门窗参数，支持撤销及浏览器草稿。
- 下载模型、结构数据、质量及一致性报告，导出当前效果图。
- 保存历史版本、阶段缓存与检查点；服务重启后继续未完成步骤。

首屏「林间暖居」为项目原创设计示例，与用户上传任务分开。

## 环境要求

| 依赖 | 说明 |
| --- | --- |
| Node.js | 22+ |
| pnpm | 前端依赖和项目命令，使用 `pnpm-lock.yaml` |
| Python | 3.11+；当前固定依赖在 Windows、Python 3.13.5 下验证 |
| Codex CLI | 使用本机已经安装并登录的版本，账号及模型需支持图片输入 |
| Microsoft Edge | 仅浏览器自动验收需要；日常可用支持 WebGL 的浏览器 |

项目不安装另一份 Codex CLI，不复制登录凭据，也不修改全局模型配置。Blender 仅用于可选的离线家具源工程制作。

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

`pnpm start` 使用单个 FastAPI 进程同时提供构建页面和 API，只监听本机。修改前端后需重新 `pnpm build`。关闭服务使用 Ctrl+C；不要同时启动多个使用相同数据目录的后端进程。

同为 Windows、Python 3.13.5 的环境，可用 `backend/requirements.lock.txt` 替代范围依赖文件安装，复现已验证的 Python 包版本。其他环境使用 `requirements-dev.txt` 并运行测试。

### 开发模式

```powershell
pnpm dev:all
```

前端 http://127.0.0.1:5173/，后端 http://127.0.0.1:8000/。也可在两个终端分别运行 `pnpm dev` 与 `pnpm dev:api`。开发模式与 `pnpm start` 共用 8000 端口，选择一种后端启动方式。

### 配置

默认继承本机 Codex 登录及模型配置。需要覆盖项目配置时：

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
| `STUDIO_DATA_DIR` | 项目 `data/`；可指定其他本地数据目录 |

Windows 下，未显式设置 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY` 时，CLI 子进程继承启用的系统手动代理；不修改系统设置。修改代理后重启项目。

生成页面从本机 CLI 获取模型目录，可手动刷新。模型必须支持图片，实际权限取决于账号及服务商。重试可更换模型和推理强度，创建独立任务；不会静默替换模型。`.env`、登录文件及 API 密钥不得提交仓库。

## 户型图到三维

```text
上传原图 → AI 结构识别 → 几何校验 → 可选 AI 增量复核
                                        ↓
                        对照原图人工确认／修改结构
                                        ↓
                         AI 家具规划 → 本地摆放检查
                                        ↓
                         确定性 GLB 构建 → 实际模型校验
                                        ↓
                            Three.js 预览与成果下载
```

AI 输出结构化数据，程序据此建模，不执行 AI 返回的任意 Python。确认后的墙体、房间、门窗和轮廓被锁定，家具规划不能改写。导出后重新读取实际 GLB，检查墙体体积、门窗高度区间截面、房间地面及基座轮廓。

### 失败处理与恢复

- 临时 AI 连接错误最多自动重连一次，使用原模型，计入原阶段总预算。
- AI 复核超时或暂时不可用时保留有效识别结构，标记复核未完成，进入人工核对。
- 疑似重复墙、缺少入口等启发式判断仅提醒；无效多边形、失效引用和真实结构不一致仍需修正。
- 自动家具先尝试有限局部平移和缩放；仍放不下的家具暂缓并记录说明。手动摆放不会被自动移动或删减。
- 家具 AI 超时、暂时不可用或响应持续无法读取时，可交付房屋结构，显式标记 `delivery_status=structure_ready` 并提供完善家具入口；完整方案为 `ready`，两者分开统计。
- 后端重启后，处理中任务重新排队，验证原图、参数及确认记录后从检查点继续。待核对任务仍等待用户确认；已取消任务不会自动恢复。
- 历史失败任务可按界面入口重试或恢复有效识别结构，新建版本并保留原记录。

**几何一致性不等于图片识别正确。**缺少尺寸时只能估算，AI 自报置信度不能替代对照原图。产品用于空间方案预览，不替代现场测量或施工图审核。

流程、缓存依据、时间预算与实测方法见 [AI 流程设计](docs/ai-pipeline-design.md)。

## 工作台操作

- 三维：左键旋转、右键平移、滚轮缩放；触屏支持单指旋转及双指缩放／平移。适配按钮恢复全图。
- 墙体：切换「剖切／完整」，下载的 GLB 保留完整墙高。
- 照明：白天关闭人工灯，夜晚按保存的灯位、亮度、色温及开关照明。隐藏裸灯泡占位造型，保留实际光照。
- 手动布局：点击「手动调整布局」，结构核对阶段也可编辑。新增门窗前选择目标墙，并调整尺寸、位置及门扇／窗台参数。
- 平面编辑：滚轮围绕鼠标缩放，空白拖动或手形模式平移；空格临时平移，`0` 适配全图，方向键微移，Shift 加速。
- 保存手动修改后生成独立版本，原方案保留。网页材质影响当前预览及效果图，模型下载保留生成时材质。

户型外轮廓按墙体和空间边界自动适配，无需单独手工描轮廓。草稿及外观偏好保存在浏览器，清理浏览器数据可能丢失；重要修改应保存为模型版本。

## 验证与成功率统计

```powershell
pnpm test:backend
pnpm test:frontend
pnpm build
pnpm test:prelaunch
```

`test:prelaunch` 使用本机 Edge、8011 端口、独立数据与固定 AI 响应，验证真实建模及浏览器交互，不调用实际 AI、不修改用户任务。测试通过不能代表新户型识别成功率。

只读统计本机历史任务，区分完整交付、仅结构交付、失败和待核对：

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/report_generation_success.py
.\.venv\Scripts\python.exe -X utf8 scripts/report_generation_success.py --replay
```

`--replay` 在隔离目录重建各原图最近成功的保存方案，验证实际 GLB；不调用 AI，不计作新图识别样本。报告写入 `data/success-audits/`。新图首次成功、重试成功与保存方案回放应分别评估。

浏览器视觉检查：

```powershell
pnpm test:visual /api/jobs/<任务ID>/artifacts/model.glb data/visual-review
node scripts/verify_workspace.mjs <任务ID>
```

验收范围与限制见 [本地预上线记录](docs/prelaunch-review.md)，历史效果改进见 [质量检查记录](docs/quality-review.md)。

## 目录与资产

| 目录 | 内容 |
| --- | --- |
| `frontend/src/` | React 界面、平面编辑器、Three.js 预览 |
| `backend/app/` | API、Codex 适配、LangGraph、SQLite、校验与 GLB 构建 |
| `backend/tests/`、`frontend/tests/` | 隔离测试 |
| `skills/` | 项目 AI 角色契约与提示，随任务保存快照 |
| `assets/furniture/` | 家具索引、必需 GLB、可选源工程 |
| `public/` | 随项目分发的示例模型、材质和图标 |
| `scripts/` | 启动、资产制作、基准测试和浏览器验收 |
| `docs/` | 设计与验收说明 |
| `data/` | 本地任务、原图、数据库、检查点、缓存与报告；不提交 |

家具 GLB 和示例模型随仓库分发，新安装无需先制作资产。替换规范及可选离线制作见 [家具资产库](assets/furniture/README.md)。重建首页示例：

```powershell
.\.venv\Scripts\python.exe scripts/build_showcase.py
```

## 数据与维护

升级前停止服务，备份整个 `data/` 及本机 `.env`；恢复时停止服务并整体还原，保持任务数据库与检查点对应。浏览器未提交草稿需另行保存为模型版本。

仓库包含代码、说明和必要公共资产，不包含用户任务原图、生成成果、数据库、缓存、日志、CLI 安装或本地凭据。若配置项目目录外的数据位置，也应自行备份并排除于 Git。

当前为本地单人产品，尚不提供多人账号隔离、云端调度、完整寻路、精确门扇扫掠或施工安全判断。

## 许可

[Apache License 2.0](LICENSE)。