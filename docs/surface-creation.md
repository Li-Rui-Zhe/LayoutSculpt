[项目首页](../README.md) / [文档中心](README.md)

# 墙面与地板材质创作

<sub>LayoutSculpt / 使用指南</sub>

<details>
<summary>本页导航</summary>

- [页面使用](#页面使用)
- [AI 链路](#ai-链路)
- [光学材质](#光学材质)
- [文件与接口](#文件与接口)
- [验证](#验证)

</details>

## 页面使用

进入「DIY → 墙面 DIY / 地板 DIY」，无需先生成户型。

- **AI 生成**：描述想要的颜色、纹理、铺贴与光学效果，所选 AI 来源返回材质参数，程序绘制纹理并显示三维预览。
- **手绘创作**：支持画笔、橡皮擦、直线、矩形、椭圆、铺色、撤销重做和跨边续画。落笔后自动同步预览。
- **选用样板**：基于内置或已保存材质，调整染色、纹理密度、方向、光泽及光学效果。
- **上传图片**：支持 PNG/JPG/WebP，最大 10 MB、1600 万像素；中心裁成方形，透明像素合成白底。复杂壁画、定制花纹可使用此入口或手绘。

统一流程是「创作 → 预览与调整 → 保存」。各方式独立保留内容，手绘草稿不会锁住 AI。保存后材质进入素材库、户型生成和人工设计的墙面/地板选材列表。

## AI 链路

材质 AI 使用 AI 接入中已配置的 Codex 或 DeepSeek，按所选模型能力设置推理强度，不连接独立图片服务。项目内 `skills/surface-material/SKILL.md` 约束设计，LangChain 解析结构化参数，LangGraph 执行「参数设计 → 本机绘制」。AI 不生成或执行任意代码。

材质名称开放，不按白名单拒绝。原有乳胶漆、微水泥、瓷砖、木纹等作为可选 preset；新材质由 layers 组合纯色、噪声、纤维、编织、颗粒、脉络、条纹和网格。AI 可将羊毛地毯、软木、藤编等拆成不同配方。最多 8 层、单层周期 1..256；数值和复杂度校验仍保留。配方错误会要求 AI 修正一次，仍无效则保留现有设计并报错，不用空白图冒充成功。

新配方的 kind 是自由名称，preset 可为空，旧配方仍兼容。光学参数继续独立保存；纹理配方写入底图与正式素材 PNG 的 surface_parameters 元数据，颜色、密度、方向等后续调整写入 surface_design。当前图层生成二维颜色纹理，没有真实绒毛几何或法线；精确人物、文字等仍需手绘或上传补充。

生成任务写入 SQLite，刷新后可恢复显示。每种用途一个活跃任务，最多两个排队任务，执行串行；支持取消；重启后恢复尚未执行的排队任务，已经执行但被中断的任务不会自动重发，避免重复请求。历史记录支持继续加载。

2026-10-13 已移除独立图片服务调用、配置检测、图片质量与参考图控件以及特殊图案生图入口。旧客户端提交 `method=image` 返回 422；旧图片任务不再出现在当前生成记录，历史错误通过 API 返回时使用通用提示。旧任务数据和已保存素材不删除。

## 光学材质

玻璃（高光、磨砂、染色、背漆）及金属使用真实渲染参数。`optics` 保存 transmission、metalness、ior、thickness，roughness 范围为 0..1。旧配方没有 optics，继续使用不透光默认值。

预览使用 Three.js MeshPhysicalMaterial 与环境光反射，玻璃后方的参照物用于观察透光。光学参数可手动调节。PNG 内嵌完整配方，素材库、重新编辑与 GLB 导出均保留参数；GLB 使用标准 KHR_materials_transmission、KHR_materials_ior、KHR_materials_volume 扩展。

整墙使用玻璃可表达通透隔断；单侧或局部玻璃饰面不会移除背后实体墙。光学厚度不替代结构厚度和施工规格；环境反射不等同于精确实时镜面倒影。

## 文件与接口

- 手绘像素与底图存浏览器 IndexedDB；四种方式的草稿存 `surface-workspace:v2:<category>`。
- AI 描述兼容读取旧 `surface-prompts:v3:<category>` 的 parametric 字段。
- `data/material_sources/<sha>.png` 为未发布底图，编号 `source:<sha>`。
- `data/materials/<sha>.png` 为正式素材，编号 `texture:<sha>`；包含配方并随项目包导出。
- `POST /api/materials/source`：手绘或导入底图。
- `GET /api/materials/sources/{digest}.png`：读取底图。
- `POST /api/materials/generations`：提交 category、prompt；method 可省略或为 parametric。
- `GET /api/materials/generations?category=walls|floor`：当前材质任务历史。
- `POST /api/materials/generations/{id}/cancel`：取消任务。
- `POST /api/materials/preview`、`POST /api/materials/design`：预览、保存。

用户数据保留在忽略提交的 data 目录。新材质不覆盖已有素材。后端验证格式、大小、用途、路径标识及全部材质参数；前端和后端均阻止重复生成。

## 验证

定向测试覆盖上传和手绘、旧草稿兼容、AI 参数生成、取消与错误、玻璃材质、保存回读、真实 GLB 扩展、旧图片请求拒绝、历史报错清理及已保存素材保留。真实页面已验证本地 Codex 生成乳胶漆与高光玻璃并保存入库。

---

[← 文档中心](README.md) · [返回项目首页](../README.md)
