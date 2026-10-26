# 开发与提交说明

安装、AI 接入和启动方式见 [README](README.md)，功能说明见 [文档索引](docs/README.md)。本项目使用 pnpm，Python 优先使用项目内 `.venv`。

## 开发前

1. 用 `git status` 检查本地修改，保存自己的工作后再同步远程。
2. 新功能分支可使用 `codex/功能名称`。不要覆盖其他人的修改或强制推送共享分支。
3. 使用 `pnpm dev:all` 启动开发环境。开发端口通过 `.env` 的 `STUDIO_FRONTEND_PORT` 统一配置，不要只改 Vite 端口。

## 文件与数据边界

- 提交代码、项目 `skills/`、测试、说明、依赖锁文件和官方 GLB、缩略图、贴图。
- 不提交 `.env`、密钥、登录记录、本机 `data/`、数据库、用户上传图、DIY 成果、缓存、日志、依赖目录和构建输出。
- `.env.example` 只能保存无密钥的配置示例。项目外的数据目录也不要复制进仓库。
- `.gitignore` 只影响尚未被跟踪的文件；用 `git ls-files -ci --exclude-standard` 检查是否有已跟踪的忽略文件。
- 共享自己制作的素材时，仅将确认可公开的 GLB 放入资源目录，并记录来源；不要上传整个本机素材数据库。
- `.gitattributes` 统一文本换行，`.cmd` / `.bat` 使用 CRLF；模型和图片保持二进制。`.editorconfig` 供编辑器采用相同格式。

## 提交前验证

```sh
pnpm test:backend
pnpm test:frontend
pnpm build
pnpm test:prelaunch
git diff --check
git diff --cached --check
git diff --cached --stat
git ls-files -ci --exclude-standard
```

后端与浏览器测试使用隔离数据和模拟 AI。真实 AI 识别质量需要单独评估，不能将模拟测试写成真实账户验证。完整方法和 Mac 浏览器准备方式见 [测试说明](docs/testing.md)。

改变用户入口、默认流程、接口或环境变量时，同时更新 README 和对应功能文档。历史验收记录保留日期和实际结果，不把旧测试数量当成当前版本的通过证据。

提交日志使用中文，写清需求或问题、实现思路；必要时附复现方式和验证结果。推送前检查远端是否有新提交，推送后核对远程分支提交号；CI 结果以 GitHub 实际运行状态为准。
