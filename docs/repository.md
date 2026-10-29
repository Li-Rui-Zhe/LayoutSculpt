[项目首页](../README.md) / [文档中心](README.md)

# 公开仓库内容

<sub>LayoutSculpt / 开发与维护</sub>

<details>
<summary>本页导航</summary>

- [项目简介](#项目简介)
- [保留](#保留)
- [不分发](#不分发)
- [本地备份](#本地备份)
- [Git 历史](#git-历史)
- [参赛展示](#参赛展示)
- [提交配置](#提交配置)
- [仓库地址与上游](#仓库地址与上游)
- [源码布局](#源码布局)

</details>

仓库用于展示、运行和复现“LayoutSculpt”，保留产品代码、必要资产、测试及使用说明。

## 项目简介

支持 Codex 与 API 接入的开源 AI 空间设计工作台，涵盖户型识别、交互式 3D 编辑、建筑构件与灯具、家具与墙地面 DIY、素材管理及 GLB 导出。

该文案与 `package.json` 的 `description` 保持一致，用于仓库 About / Description 等对外介绍。API 接入范围以 [AI 接入说明](ai-connections.md) 为准。

## 保留

- React / Three.js 前端、FastAPI 后端和项目 AI 契约。
- 83 款运行时家具 GLB（45 个品类，目录 3.2.0）、当前首页设计示例、材质与上传演示户型。
- pnpm 锁文件、Python 依赖及已验证环境的依赖快照。
- 单元测试、真实 GLB 校验、浏览器检查及基准测试脚本。
- 可选离线家具制作代码，用于重建本地源工程。

运行时 GLB 是产品依赖，不属于可删除的临时生成物。删除家具资产会影响新户型生成，删除当前示例会影响首屏。

## 不分发

- 用户上传图、任务成果、数据库、检查点、缓存和本机日志。
- 旧品牌界面截图、开发期间的视觉验收图片与个人任务流水。
- 旧示例 `apartment.glb` 及 Blender 源工程。
- 可再生的 `.blend` 文件、Blender 安装包及项目单独的 CLI 安装。
- npm / Yarn 锁文件；本项目统一使用 pnpm。
- 环境文件、账号登录信息和密钥。

`.gitignore` 负责阻止这些本地文件被重新加入。新增对外截图时使用 `docs/images/`，仅放当前产品、有明确说明的图片，不堆积开发截图。

### README 展示素材

README 使用轻量 SVG 横幅、四段重新录制的 GIF 与对应 WebP 静态封面。主线为「空间预览 → 材质搭配 → 家具创作 → 模型接入」，统一宽度、章节编号与字幕；接入页保留更高画幅，完整展示模型和保存按钮。浏览器偏好减少动态效果时展示静态封面；图片与动画都可单独打开。

空间采用当前「林间光庭」；家具采用内置玄关柜模板。AI 接入页使用明确标注的示例模型、`DEMO` 密钥标识和浏览器内存中的演示设置，展示保存与未保存状态；不会读取真实凭据、保存本机 AI 设置或发起 AI 推理。用户任务、素材和草稿在录制上下文中隔离。原始帧、中间文件与检查报告保留在被忽略的 `data/readme-recording/`。

更新演示时，先构建并启动当前项目，再从根目录执行：

```sh
pnpm build
node scripts/review/record_readme.mjs
python scripts/build_readme_gifs.py
```

Python 使用项目 `.venv`；Windows 可执行 `.venv\Scripts\python.exe scripts/build_readme_gifs.py`。录制默认连接 `http://127.0.0.1:8000`，可用 `STUDIO_BASE_URL` 指定已有项目服务。单独重录可在录制命令末尾加 `showcase`、`materials`、`diy` 或 `ai-connections`。每帧写入清单；整组通过后标记为 `complete`。编码器拒绝失败或不完整录制，并输出首、中、末帧及体积、时长报告。修复失败组后可单独重录；不发布不完整演示。字体优先使用 Windows 微软雅黑或 macOS 苹方。

详细用法移至 [设计工作流](design-workflows.md)，相关功能截图放在 `docs/images/` 并由文档引用。日常反馈与可选的私密报告入口见根目录 [SECURITY.md](../SECURITY.md)。

## 本地备份

本轮移除的文件归档在本机被忽略的 `data/repository-cleanup/`，不属于仓库交付内容。需要编辑家具源工程时，使用 [资产制作说明](../assets/furniture/README.md) 重建。

## Git 历史

本轮清理移除的是分支当前版本的文件。旧提交中的历史文件仍可通过 Git 历史查看；普通删除不会缩小已有历史。比赛若要求完全不包含旧文件历史，需要另建干净的提交仓库或单独整理历史，不能把当前目录清理描述为历史清除。

## 参赛展示

以 [README](../README.md) 为安装和功能入口，提供实际运行演示。介绍时区分原创设计示例、真实 AI 识别结果和人工调整结果；几何一致性校验不能代替原图识别准确性评价。参赛材料另按比赛要求准备，不把内部调试记录当作产品文档。

## 提交配置

`.gitignore` 排除本机数据、认证、依赖、构建输出和临时验收文件；`.gitattributes` 规定文本 LF、Windows 启动脚本 CRLF，GLB 和图片不做换行转换；`.editorconfig` 为编辑器提供一致格式。必要资产与依赖锁文件仍需跟踪。提交操作见 [贡献说明](../CONTRIBUTING.md)。

## 仓库地址与上游

项目维护在 [Li-Rui-Zhe/LayoutSculpt](https://github.com/Li-Rui-Zhe/LayoutSculpt) 与 [L-rui-zhe/LayoutSculpt](https://github.com/L-rui-zhe/LayoutSculpt)。文档与代码可以在两处使用，`origin`、`upstream` 只是各自本地配置的名称，不表示固定账号。普通克隆通常将所克隆仓库命名为 `origin`；提交前用 `git remote -v` 核对目标，只推送约定的仓库，不自动同步另一账号或强制覆盖远端。

GitHub About / Description 是仓库设置，推送 `package.json` 不会自动更新它。已登录 GitHub CLI 的维护者可运行 `gh repo edit <账号>/LayoutSculpt --description "<上方项目简介>"`，或在仓库首页 About 旁的设置中更新。不要将 GitHub 令牌写入项目配置。

## 源码布局

| 目录 | 作用 |
| --- | --- |
| `frontend/src/` | React 界面、编辑器、Three.js 预览与 AI 接入 |
| `backend/app/` | API、AI 适配、校验、GLB 构建、任务与数据 |
| `assets/` / `public/` | 公共模型、材质、示例和图标 |
| `skills/` | AI 角色契约与提示 |
| `scripts/` | 启动、资产制作、录制与验证 |
| `docs/` | 使用、实现与历史记录 |
| `data/` | 本机任务、草稿、缓存与报告；不分发 |

---

[← 文档中心](README.md) · [返回项目首页](../README.md)
