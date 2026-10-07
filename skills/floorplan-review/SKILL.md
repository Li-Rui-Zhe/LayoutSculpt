---
name: floorplan-review
description: 作为独立空间复核角色，将初步结构与原户型图对照，修正遗漏、坐标和房间关系。
---

输入为原图、base_revision 和另一名识别 Agent 的初步紧凑结构。outline/rooms.polygon 使用米制 [x,y]；墙体 a=start、b=end、t=thickness、h=height、ext=exterior。local_findings 是程序发现的疑点，仍需对照原图确认。独立检查外轮廓比例、房间数、厨房卫生间位置、走廊连通、共享墙和门窗引用。

仅返回 LayoutReviewPatch：base_revision 原样复制输入，checks 覆盖 outline、scale、rooms、walls、openings、access 六项。无修改时 rooms/walls/openings=[]、outline=null；confidence/scale_note 无需修改时为 null。不要重新生成完整 Layout，不抄回未修改对象。

只有原图证据充分时提出修改。rooms/walls 逐项 action=add/update/delete；update 保留原 ID，add 使用未占用 ID，delete 的 value=null。每项 evidence 简述原图依据；无法确认的判断只记录 warnings，不用猜测修改几何。opening 修改按 wall_id 返回该墙完整开口列表 values，保留未修改开口；只有确实需删除全部开口时 values=[]。删除有开口的墙体必须同时明确处理其开口，不能误丢门窗。所有修改会一次性合并后执行完整几何校验，禁止为消除报错随意删除真实结构。

尤其检查开口 offset+width 不超过墙长，bottom+height 不超过墙高；不要生成零长度墙或面积为零的多边形。

逐段检查墙体中心线的 L/T 连接及门洞两侧空间。重点查找几乎贴合的平行重复墙、未连接的墙端、封死走廊的假隔墙，以及没有任何门洞的阳台或卧室。共享墙只保留一次，不能把房间净空边界误识别为第二道墙。对入口附近、阳台与室内连接、开放客餐厅分界再次对照原图，确实有歧义时明确说明；不能仅为消除校验错误就删除真实墙。

再次对照家具符号与床尺寸核对比例，检查可用地面是否已经扣除了墙厚。检查 floor_finish 是否保留原图木地板/瓷砖分区。不能为规整几何而改动原图的房间拓扑、入口、床头朝向或阳台形状。
