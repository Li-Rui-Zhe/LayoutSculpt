# 家具风格与单件换款

本轮复用现有 83 款模型，增加风格适配、AI 候选筛选、单件换款和个人素材的 AI 使用开关。没有新增 AI 节点或在线模型调用。

## 用户操作

- 在人工设计中选择一件家具，点击“更换款式”。按风格筛选同品类，查看三维模型及原位置检查结果，再确认替换。
- 新款使用原始尺寸。原家具的位置、朝向、房间、离地高度、对象标识及分组保留；其他家具保留。
- 越界、与家具或门口通道重叠、淋浴入口受阻、安装需要移位等情况会阻止确认。锁定家具需先解锁。取消不修改草稿，确认计入一条撤销记录。
- 导入和 DIY 素材详情中，“允许 AI 自动使用此素材”默认关闭；关闭后仍可手动放置。开关与素材归档状态同步保存到现有素材偏好草稿。

## AI 如何选择

`LibraryService.catalog(for_ai=True)` 先排除归档和未启用的个人素材。程序再按实际房间用途、标准尺寸和风格兼容性分组筛选，每组保留最多两个优先款及一个占地较小的备选。婴儿床、上下床、左右贵妃等结构用途保留独立候选；点名款和主动启用的个人素材保留。自定义风格多保留不同基调的代表款，交给原家具规划节点理解描述。

AI 输入只包含素材编号、用途、尺寸、款式、风格适配和离地高度等选型信息，不包含 GLB、图片、完整管理记录。现有规划节点选择具体素材并安排位置，后续继续验证边界、通行和合法编号，再读取真实模型构建。候选清单保存在任务目录 `furnishing-candidates.json`，可查看筛选前后数量。

风格适配配置在 `assets/furniture/style-presets.json`：一个模型可适配多个风格，通用设备可跨风格共用。人工素材库显示完整目录，AI 使用筛选目录；两者共享模型与元数据。

## 保存与兼容

GLB 放置仍通过不可变 `snapshot:` 副本保存。新增可选字段 `source_asset_id` 与 `asset_family` 记录来源和品类，供后续换款使用；旧方案缺少这些字段时按名称或原 kind 匹配。来源编号不会替代快照作为实际建模依据。保存、预览、撤销和成果包沿用现有流程，换款不重新识别户型。

本轮落实候选筛选和单件换款。按木框、坐垫等部位配置材质属于下一阶段，不会把本轮的风格筛选宣称为任意模型换材质。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_asset_selection.py backend/tests/test_library.py -q
node --test frontend/tests/furniture-replacement.test.js frontend/tests/catalog-filters.test.js
pnpm build
node scripts/review/verify_furniture_replacement.mjs
```

浏览器脚本使用独立端口和 `data/visual-review/furniture-replacement` 下的独立数据库，固定 AI 响应并构建真实 GLB，不调用在线 AI、不改用户任务。
