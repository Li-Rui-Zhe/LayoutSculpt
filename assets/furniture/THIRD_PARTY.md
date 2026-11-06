# 第三方家具与材质

运行时资产均随项目离线提供，不会在用户生成户型时访问素材网站。官网预览图未用于产品；缩略图由本项目从实际 GLB 渲染。

## Poly Haven 家具 · CC0-1.0

许可：https://polyhaven.com/license 。原始依赖的下载地址、字节数与 MD5 见 `external-sources.json`，导入后的 GLB SHA256 见 `catalog.json`。转换仅应用节点变换、底面归零和 GLB 内嵌打包，保留源网格、UV 和 PBR；未逐轴拉伸。导入脚本拒绝超预算和无效资源。

| 素材 | 原作者 | 原始页面 |
| --- | --- | --- |
| 木扶手高背软包休闲椅 | Vibrant Nordic | https://polyhaven.com/a/modern_arm_chair_01 |
| 高背软包餐椅 | James Ray Cock | https://polyhaven.com/a/dining_chair_02 |
| 格栅实木长电视柜 | Patrik Pangerl | https://polyhaven.com/a/modern_wooden_cabinet |
| 实木双层方边几 | James Ray Cock | https://polyhaven.com/a/side_table_01 |

## ambientCG 实拍纹理 · CC0-1.0

- [Fabric030](https://ambientcg.com/a/Fabric030)：布艺家具的实拍纹理基础。
- [Wood051](https://ambientcg.com/a/Wood051)：木制家具的实拍纹理基础。
- 许可：https://docs.ambientcg.com/license/ 。允许修改与再分发。
- `assets/materials/pbr/sources.json` 保存原始 ZIP SHA256、下载地址与每个发布贴图的 SHA256。
- 改动：512px、中性色图、弱化 OpenGL 法线；粗糙度进入 glTF metallicRoughness 的 G 通道，B=0。家具底色另由材质因子指定。
- CC0 允许无署名使用，此处主动保留来源和作者，以便维护和审查。

普通家具构建不联网。基础 Blender 重建保留已登记的外部家具，不覆盖旧用户快照。实拍纹理增强质感，不代表商品扫描精度、物理强度或施工认证。
