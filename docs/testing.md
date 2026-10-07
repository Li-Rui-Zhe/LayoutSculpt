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
| 浏览器预上线 | 上传、待核对、刷新恢复、确认后真实建模、灯光、下载、移动端及受限存储 |

最近验证：2026-10-07，Windows、Python 3.13.5，后端 147 项、前端 43 项、构建及隔离浏览器验收通过。新增功能后应重新运行相关检查。

`test:prelaunch` 启动独立测试服务，使用固定 AI 响应和真实建模器，需要本机 Edge 及空闲的 8011 端口。输出位于 `data/`，不修改用户任务、不调用真实 AI。

## 专项浏览器检查

保留在 `scripts/review/`，避免与日常启动脚本混放。部分检查需要已有任务及运行中的本机服务；默认访问 5173。具体前置条件见脚本参数和实现。

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