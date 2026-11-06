"""原创样板的显式物件分组；不对用户上传模型猜测语义。"""

# 前缀与 build_showcase 的命名对应。桌面摆件一起移动，灯光仍独立保留。
OBJECTS = [
    ("living_rug", "客厅羊毛地毯", "rug", "living", ("羊毛圆角地毯", "地毯细织镶边")),
    ("ottoman", "亚麻脚凳", "armchair", "living", ("脚凳实木", "脚凳承托", "脚凳亚麻")),
    ("coffee_table", "洞石椭圆茶几", "table", "living", ("洞石茶几", "洞石椭圆茶几", "茶几画册", "手作细颈花器_3.2", "花器细枝_3.2", "花器小叶_3.2")),
    ("side_table", "胡桃木边几", "table", "living", ("胡桃边几", "托盘", "咖啡杯")),
    ("island", "洞石料理岛台", "counter", "kitchen", ("岛台胡桃", "岛台洞石", "岛台竖向", "岛台嵌入", "电磁炉炉圈", "岛台下吸", "岛台铜色")),
    ("dining_table", "胡桃木椭圆餐桌", "table", "dining", ("椭圆餐桌", "餐桌柱脚", "亚麻餐垫", "手作陶瓷餐盘", "餐盘内沿", "早餐咖啡杯", "手作细颈花器_4.7", "花器细枝_4.7", "花器小叶_4.7")),
    ("bedroom_rug", "主卧织物地毯", "rug", "bedroom", ("主卧地毯",)),
]


def sample_object(node):
    return next((row[:4] for row in OBJECTS if node.startswith(row[4])), None)
