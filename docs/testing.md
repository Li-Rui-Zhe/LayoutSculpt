# 测试与验收

所有命令从项目根目录运行。测试与生成质量分别评估，自动化通过不代表 AI 能正确识别任意原图。

## 基础检查

```powershell
pnpm test:backend
pnpm test:frontend
pnpm build
pnpm test:prelaunch
```

| 检查 | 范围 |
| --- | --- |
| 后端 | 数据契约、结构确认、阶段缓存、AI 临时错误、检查点恢复、取消、真实 GLB 和一致性 |
| 前端 | 编辑几何、开口安装、平面导航、模型选择、场景生命周期、灯光、剖切及取景 |
| 构建 | 生成用于本机发布的前端页面 |
| 浏览器预上线 | 默认三维初稿、同任务继续、人工核对、刷新恢复、真实建模、灯光、草稿导出、移动端及受限存储 |

测试数量会随版本变化，以本次测试输出和 CI 结果为准。历史验收记录不代表当前版本已通过检查。

`test:prelaunch` 启动独立测试服务，使用固定 AI 响应和真实建模器，Windows 默认使用本机 Edge，Mac 使用 Playwright Chromium（先执行 `pnpm exec playwright install chromium`）；自动选择空闲测试端口和独立数据目录。输出位于 `data/`，不修改用户任务、不调用真实 AI。

## 专项浏览器检查

保留在 `scripts/review/`，避免与日常启动脚本混放。完整验收使用 `pnpm test:prelaunch`；只复验渐进生成与同任务继续可运行 `node scripts/prelaunch.mjs --progressive`，同样使用隔离服务和空闲端口。

部分旧专项脚本需要已有任务及运行中的本机服务，默认端口可能为 5173、8000 或 8011，请先核对脚本参数及 `REVIEW_URL` 支持情况；不要为运行测试结束其他项目的进程。

```powershell
node scripts/review/verify_showcase.mjs
node scripts/review/verify_workspace.mjs <成功任务ID>
node scripts/review/verify_editor_openings.mjs <任务ID>
node scripts/review/verify_editor_navigation.mjs <任务ID>
node scripts/review/verify_delivery_notice.mjs <成功任务ID>
```

编辑器检查使用隔离浏览器上下文，其中固定响应及模拟交互不能代替真实 AI 验收。运行前应了解各脚本所需的任务状态。

`pnpm test:visual <model-url> [output-dir]` 直接加载开发模块拍摄白天、夜晚、俯视和完整墙体，需要 `pnpm dev`，不能仅用构建后的静态页面代替。

截图、报告、数据库及模型输出全部保存在被忽略的 `data/`，不加入公开仓库。

建筑构件专项运行 `node scripts/review/verify_architecture_library.mjs`：覆盖五类 17 个样板、分类与搜索、墙段适配、门窗新增与替换、撤销、重叠拦截、旧后端提示、手机布局及墙面立体材质预览。脚本模拟任务和草稿接口，使用正式 GLB 建模器生成并校验隔离模型，不修改真实任务。`backend/tests/test_opening_variants.py` 另校验门窗样式导出、实际截面及前后端部件几何的一致性。

三维实时编辑专项见 `scripts/review/verify_live_doors.mjs` 与 `verify_generated_drag.mjs`：检查已有模型变换、取消、撤销、刷新恢复，以及不必要的预览请求和加载提示。运行前阅读脚本的任务 ID 与服务配置，隔离草稿，不将测试修改写入用户设计。单元测试覆盖灯具部件完整性、门扇枢轴、浮点尾差和绘制合帧。

公开 GIF 录制与编码方法见 [仓库内容](repository.md)。它只演示实际页面操作，隔离用户数据与凭据，不作为 AI 生成质量的验收结果。真实 GLB 流程测试为独立 Python 冷启动预留等待时间，断言仍检查实际模型及交付状态；耗时应另用基准记录，不能把超时上限当作性能承诺。

## 真实 AI 与耗时

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/benchmark_ai.py --source <原图路径> --model <图片模型> --effort medium
.\.venv\Scripts\python.exe -X utf8 scripts/benchmark_delivery.py --run data/ai-benchmarks/<验证目录ID>
```

这些命令会调用本机已登录的 AI，使用隔离数据目录。前者停在结构核对；后者使用明确标记的性能测试候选进行家具和建模验证，不代表用户已经核对原图。

比较首次调用和缓存复用时，保持原图、模型、强度、提示、运行环境一致，并分别记录识别、复核、家具和建模耗时。远端排队与网络会影响结果，不能用单次观测推出固定加速比例。

## 成功率

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/report_generation_success.py
.\.venv\Scripts\python.exe -X utf8 scripts/report_generation_success.py --replay
```

报告按不同原图、策略版本和交付状态分类。完整家具方案、仅房屋结构、失败、取消及待确认分别记录；首次成功与重试成功不能混为同一指标。

`--replay` 只重建已保存的方案并检查实际 GLB，不调用 AI，不能作为新原图识别成功率样本。原图到结构的准确性需要对照图纸评估；结构到模型的一致性由几何校验评估。

## 当前限制

缺少尺寸时只能估算；图像识别可能误判；家具碰撞采用占地近似。尚不提供完整寻路、精确门扇扫掠或施工结构审核。公开展示应说明原图质量、人工调整与是否完成家具交付。

## 自动检查与性能记录

GitHub 推送及 PR 会运行 `.github/workflows/checks.yml`：后端测试、前端测试、生产构建和独立浏览器验收。仅使用模拟 AI 与临时数据，不需要用户密钥。未推送前不会触发远程 CI。

`python scripts/report_pipeline.py` 汇总已有任务的阶段耗时，按策略版本、模型、强度、缓存命中和结果分别统计中位数与 P95，不触发 AI 调用。样本少于 10 条时仅用于排查，不作为跳过复核的依据；准确性仍需对照固定原图人工验收。

三维拖动只降低像素比例，结束约 220 ms 后恢复；模型与灯光保持一致，截图前强制恢复清晰度。验证时分别记录拖动帧耗时、首次加载及缓存再次加载，不承诺固定加速比例。

## 建筑构件与文档更新验证（2026-10-28）

### 后续收尾：实时编辑、文案与公开演示

- 前端全量 221 项通过，生产构建通过；构建仍提示 Three.js 分包超过默认 500 kB 阈值，不影响构建完成。
- 后端全量首次 628 项通过、1 项真实建模冷启动等待超时；为该集成测试单独增加等待上限后，渐进生成与恢复专项 7 项全部复验通过，保留原有实际 GLB、交付顺序和状态断言。未把初次全量运行记录成全绿。
- 独立浏览器预上线验收通过：常规流程 7 组、异常恢复 4 组、渐进生成与继续任务 2 组，页面异常为空。真实建模及素材首次索引等待与功能断言分开，避免将测试框架默认等待时间当作产品性能指标。
- 清理过时软装分类分支和无用 Python 导入；`ruff` 的 F401/F841 检查、Git 空白检查、Markdown 本地链接、发布资产与忽略规则检查通过，候选文件扫描未发现疑似密钥。
- 四份公开 GIF 更新为当前示例和页面操作，AI 接入演示没有输入凭据或调用真实服务。Windows 本机验证；远程 CI、Mac 实机与真实 AI 识别质量未由本轮测试代替。

### 前序验收

- 后端全量 609 项通过，前端全量 204 项通过，生产构建通过。
- 建筑构件专项浏览器检查通过：五类 17 个样板、门窗安装与替换、墙段适配、撤销、重叠保护、旧服务提示、手机布局及墙面立体材质。
- `pnpm test:prelaunch` 通过：常规流程 7 组、异常恢复 4 组、渐进生成与继续任务 2 组，页面异常为空。同步修正了验收脚本中环境菜单和新建页标题的过期定位。
- 本次验证在 Windows 上完成，AI 使用测试替身；实际 GLB 由正式建模器生成并校验。Mac 与远程 CI 的状态以推送后的真实运行结果为准。

## 历史验证记录（2026-10-26）

- 生成、工作流及可靠性专项 49 项通过，补充后渐进生成专项 7 项通过，合计覆盖 52 项不同测试。
- 前端单元测试 137 项通过，生产构建通过。
- 隔离浏览器：常规流程 7 组、异常恢复 4 组、渐进生成与继续任务 2 组通过，页面异常为空；真实 GLB 初稿截图已人工查看。
- 上述验证在 Windows 上完成，AI 使用测试替身。Mac CI 已配置，不把尚未执行的 CI 描述为通过。
- 详细边界见 [本轮记录](progressive-generation-20261026.md)。历史更大范围的测试结果见各轮记录，不能替代本次代码的验证范围。
