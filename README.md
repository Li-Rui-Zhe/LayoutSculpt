# LayoutSculpt户型工作台

React + Three.js 前端，FastAPI API，LangChain 调用本地 Codex，LangGraph 编排识别、复核、家具规划与 Blender 建模，SQLite 保存任务、事件与图检查点。

## 启动

要求 Node.js 22+、Python 3.11+、已安装并登录的 Codex CLI、Blender 4.5+。

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe scripts/dev.py
```

工作台：http://127.0.0.1:5173/ ，API 文档：http://127.0.0.1:8000/docs 。端口必须空闲。开发服务器只绑定本机。关闭时用 Ctrl+C。

可复制 `.env.example` 为 `.env`，设置 `CODEX_CMD`、`BLENDER_PATH`。默认查找本机 Codex 与项目 `tools/blender/*/blender.exe`。继承 Codex 自己的登录与模型配置；应用不保存 API Key，也不修改用户全局技能。

页面左上角“上传户型图”支持 PNG/JPG/WebP，最大 20 MB。可选“独立复核 Agent”。任务完成后自动载入真实 GLB，任务面板可以下载 GLB、Blender 工程和结构 JSON。

### 选择生成模型

上传面板的“生成模型”实时读取本地 Codex `model/list`，可以刷新；默认选中项目 `CODEX_MODEL` 或本地 Codex 配置的模型。仅支持文本的模型不可选，自定义服务商的配置模型会单独标注。模型列表来自本机服务，实际调用仍取决于该服务的授权与可用性。

所选模型对本次识别、复核、家具规划及结构修正全部生效，不改动全局 Codex 配置。任务提交时保存模型和适配后的推理强度；重试沿用原模型，模型不可用时明确报错。SQLite 任务、历史记录和 `manifest.json` 都保存所用模型。`GET /api/models?refresh=true` 可强制更新列表。

### 三维视图操作

模型在独立画布中旋转，不再进入工具面板下方。左键拖动旋转、右键平移、滚轮缩放；触屏使用单指旋转、双指缩放和平移。缩放范围 65%–250%，平移范围随户型大小限制。俯视模式锁定旋转方向；“居中并适配户型”恢复默认视角与缩放。原始户型图在左侧供对照，材质操作集中在底部。

## 调用链

```text
React → FastAPI 上传 → SQLite 任务 / SSE 事件
                       ↓
                 LangGraph 检查点
                       ↓
               户型识别 Agent
                       ↓
           独立空间复核 Agent（可选）
                       ↓
               家具规划 Agent
                       ↓
            Pydantic 几何 / 归属校验
                       ↓
            固定 Blender 建模程序
                       ↓
          model.glb / model.blend / layout.json
                       ↓
                Three.js 实时工作台
```

每个 Agent 通过 LangChain `ChatPromptTemplate → CodexChatModel → PydanticOutputParser` 调用。CodexChatModel 复用常驻 `codex app-server --listen stdio://`，通过 `initialize → thread/start → turn/start` 传入 `localImage`，按照 threadId 分发事件。参考项目的协议被独立实现，没有运行时路径依赖。各角色使用独立临时 Codex 线程，按依赖顺序协作，避免家具规划使用未经复核的布局。

## 目录

- `frontend/src/components/`：React 面板与上传 / 任务界面。
- `frontend/src/hooks/`：外观历史、任务记录和 SSE 连接。
- `frontend/src/viewer/StudioScene.js`：Three.js 生命周期和模型加载，释放旧模型与渲染资源。
- `backend/app/`：API、SQLite、Codex 适配器、LangGraph 和结构校验。
- `skills/*/SKILL.md`：项目内技能；公共契约与当前角色技能按序拼接、去重。每次任务保存技能快照和 SHA-256 摘要。
- `tools/build_from_layout.py`：读取经过校验的结构数据，确定性生成 Blender 模型。没有执行 Agent 返回的 Python。
- `public/models/apartment.glb`：原参考图的示例模型，与上传生成的结果分开。
- `data/jobs/<任务ID>/`：原图、角色输出、技能快照、Blender 日志和产物。
- `data/studio.sqlite3`：任务与事件；`data/graph.sqlite3`：LangGraph 检查点。

新增技能先写入 `skills/<名称>/SKILL.md`，再在 `workflow.py` 对应节点的 `registry.compose(...)` 中指定。API 只公开目录内已注册技能，不接受任意技能路径。独立复核开关改变 LangGraph 的分支；结构和家具始终有各自角色职责。

## 运行与验证

```powershell
npm run build
.\.venv\Scripts\python.exe -m pytest backend/tests -q
```

生产模式：构建后仅运行 FastAPI，它同时提供 `dist/` 页面及 API。单进程启动，不使用多个 Uvicorn worker；当前任务队列由该进程管理。进程中断的任务会标记为失败，原图与中间结果保留，通过“重新生成”建立新任务；不会把检查点误标为自动恢复成功。

上传图片内容及像素数在服务端校验。任务目录使用服务端 UUID。状态、事件同一事务写入；终态不会被迟到的生成结果覆盖。SSE 可通过 `Last-Event-ID` 重连。取消会中断 Codex turn 或终止 Blender。任务失败不回退为示例模型或虚假成功。

缺少尺寸时模型会说明估算依据；识别结果用于方案预览，不能等同于精确测绘。默认使用项目预制家具库；墙体与门窗继续参数化构建。家具支持替换为符合资产契约的自定义模型，详见 assets/furniture/README.md。

## 人工设计、家具管理与灯光

成功任务右上角点击「人工设计」，在俯视平面图中编辑。对象分为家具、墙体、地板 / 空间、门窗、通道、户型轮廓和灯具七类：

- 家具：新增、命名、复制、替换类型、拖动、旋转、尺寸修改及删除；按名称、类型、编号、所属空间搜索，支持定位、方向键和 1 / 5 / 10 厘米步长。拖动绿色手柄旋转，按住 Shift 吸附 15°，Esc 取消本次拖动；支持输入角度、±15° / ±90°、归零，以及平面图聚焦时用 `[` / `]` 旋转。角度统一到 0–360°（不含 360°），正值为顺时针，一次拖动只记录一步撤销。
- 墙体：拖整面墙或两端圆点，相连墙角和邻近地板角点联动；可添加隔墙并修改厚度、高度和墙色。
- 地板 / 空间：点选边界绘制新空间、拆分已有空间、整体平移、逐边增加角点或删除角点。支持空间名称、用途、独立地板材质，以及仅移除地板。删除空间可明确选择一并删除家具，否则尝试归入可容纳家具的其他空间。
- 门窗：独立新增、查询、移动、修改和删除门或窗户。门可选择门扇、铰链侧、开启方向和角度；窗可调整宽高与窗台。
- 通道：独立管理墙上无门扇的开放通道，与门窗分开。走廊区域在地板 / 空间中设置用途。
- 户型轮廓：重新绘制或增删改角点，保留至少三个角点及 2 平方米面积；可清空室内对象，轮廓作为共同基座保留。
- 灯具：支持灯泡、吊灯、落地灯的新增、查询、移动、替换和删除；可设置名称、发光点高度、亮度、色温及开关，每个方案最多 12 盏。

桌面人工设计页按对象库、平面画布、属性面板排列；小屏按画布、属性、对象库排列。旋转和位置尺寸优先显示，名称、类型和所属空间可展开编辑。数值位置输入与拖动共用完整家具边界检查，跨空间时自动匹配能容纳家具的空间；无法容纳时保留归属并提示，修正前不可生成。无效数字不会提交，输入框按 Esc 可恢复原值。墙、窗与通道方向仍由墙体端点确定；门扇有独立开启角度，轴对称灯具不提供无效果的旋转控件。

支持撤销、重做、还原原方案及按任务保存浏览器草稿。删除前展示关联影响；删除墙体会同时删除其门窗和通道。前后端校验凹形边界穿越、地板交叉或重叠、墙体中心线越界或重合、开口重叠及失效引用。当前几何检查不包含完整的家具碰撞、门扇扫掠碰撞或施工结构判断。

点击「保存并生成三维」通过 `POST /api/jobs/{id}/edit` 创建独立任务，服务端校验后直接运行 Blender，不调用 Codex。原方案和输入图片保留，失败可重试；新版本生成独立 `.glb`、`.blend` 和 `layout.json`。平面修改即时显示，三维在保存生成后更新。外墙的展示剖切继续保留。

三维光照只保留「白天」「夜晚」。白天关闭人工灯；夜晚根据保存的灯具位置、亮度、色温和开关进行照明，未摆放灯具时只显示少量环境光。`.blend` 保存灯具实体和真实点光源；GLB 的灯具元数据由工作台恢复为 Three.js 点光源。此预览用于视觉设计，不输出照度计算或专业照明合规结论。

## 家具资产与 Blender 环境

- 上传面板可选择“精细家具”或“基础几何”。精细方案从预制 `.blend` 追加 12 类家具，按布局自动定位、旋转、缩放；三种风格使用对应的木纹、织物和石材 PBR 配色。
- 已有成功任务可以点击“更新精细家具”：复用原房间、墙体和家具布置，仅运行 Blender，不再次调用 Codex。原任务保留；更新失败可重试。
- 任务详情显示家具匹配数量、资产版本和实际 Blender 版本。所有贴图已打包到 `.blend` 和 `.glb` 中。
- 网页材质切换会调整颜色、贴图、法线和粗糙度；“还原材质”恢复生成时材质。下载模型保留生成时的方案；导出效果图包含网页当前预览。
- 本地 Blender 查找顺序：`.env` 中的 `BLENDER_PATH` → 系统 PATH → Windows 默认安装目录 → 项目 `tools/blender/`。无需为 FastAPI 的 Python 单独安装 `bpy`。
- 资产生成方法、替换规范、材质属性见 [家具库说明](assets/furniture/README.md)。工程可直接用 Blender 打开编辑。

仅在更新家具资产时运行（普通户型生成不用执行）：

```powershell
.\.venv\Scripts\python.exe scripts/build_assets.py
```
