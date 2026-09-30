import test from "node:test";
import assert from "node:assert/strict";
import {
  clone,
  moveSelection,
  moveWall,
  freeOpening,
  problems,
  simplePolygon,
  restorableDraft,
  splitRoom,
  removeObject,
  objectEntries,
  searchEntries,
  polygonInside,
  doorLeafPoints,
} from "../src/editor/geometry.js";

test("门窗和通道独立查询，索引仍指向正确对象", () => {
  const d = fixture();
  d.layout.openings.push({
    ...d.layout.openings[0],
    kind: "passage",
    offset: 4,
    bottom: 0,
  });
  assert.deepEqual(
    objectEntries(d, "passages").map((e) => e.index),
    [1],
  );
  assert.deepEqual(
    objectEntries(d, "openings").map((e) => e.index),
    [0],
  );
  assert.equal(
    removeObject(d, { type: "openings", index: 1 }).layout.openings[0].kind,
    "window",
  );
});
test("家具支持名称、类型、所属空间查询且保留准确索引", () => {
  const d = fixture();
  d.furniture.items[0].name = "窗边阅读椅";
  const entries = objectEntries(d, "furniture");
  for (const q of ["窗边", "椅子", "客厅"])
    assert.equal(searchEntries(entries, q, d.layout.rooms)[0].index, 0);
  assert.deepEqual(searchEntries(entries, "不存在"), []);
});
test("拆分空间自动归属家具，跨家具的拆分被拒绝且不改原数据", () => {
  const d = fixture(),
    original = clone(d);
  const n = splitRoom(d, 0, "x", 1, "new");
  assert.equal(n.layout.rooms.length, 3);
  assert.equal(n.furniture.items[0].room_id, "new");
  assert.deepEqual(problems(n), []);
  assert.deepEqual(d, original);
  assert.throws(() => splitRoom(d, 0, "x", 2, "new"), /家具/);
});
test("级联删除墙体开口，空间家具需明确处置，允许删除最后一个对象", () => {
  const d = fixture();
  const n = removeObject(d, { type: "walls", index: 0 });
  assert.equal(n.layout.openings.length, 0);
  assert.throws(() => removeObject(d, { type: "rooms", index: 0 }), /家具/);
  const empty = removeObject(
    removeObject(d, { type: "rooms", index: 0 }, true),
    { type: "rooms", index: 0 },
  );
  assert.equal(empty.layout.rooms.length, 0);
  assert.equal(empty.furniture.items.length, 0);
  while (empty.layout.walls.length) empty.layout.walls.pop();
  empty.layout.openings = [];
  assert.ok(restorableDraft(empty));
  assert.deepEqual(problems(empty), []);
});
test("完整边界校验拦截顶点在内但穿过凹槽的家具和地板", () => {
  const u = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 6 },
    { x: 4, y: 6 },
    { x: 4, y: 2 },
    { x: 3, y: 2 },
    { x: 3, y: 6 },
    { x: 0, y: 6 },
  ];
  assert.equal(polygonInside(rectangle(1, 3, 4, 1), u), false);
  assert.equal(polygonInside(rectangle(0.2, 0.2, 2, 1), u), true);
});
test("灯具移动删除及门扇铰链方向保持一致", () => {
  const d = fixture();
  d.layout.lights = [
    {
      id: "l",
      name: "阅读灯",
      kind: "bulb",
      x: 1,
      y: 1,
      elevation: 2,
      lumens: 800,
      temperature: 3000,
    },
  ];
  assert.equal(
    moveSelection(d, { type: "lights", index: 0 }, 1, 0).layout.lights[0].x,
    2,
  );
  assert.equal(
    removeObject(d, { type: "lights", index: 0 }).layout.lights.length,
    0,
  );
  const [h, t] = doorLeafPoints(
    { offset: 1, width: 1, angle: 90, hinge: "end", swing: "right" },
    d.layout.walls[0],
  );
  assert.deepEqual(h, { x: 2, y: 0 });
  assert.ok(Math.abs(t.x - 2) < 1e-6);
  assert.equal(t.y, -1);
});

const rectangle = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
function fixture() {
  return {
    layout: {
      outline: rectangle(0, 0, 8, 6),
      rooms: [
        { id: "a", name: "客厅", polygon: rectangle(0, 0, 4, 6) },
        { id: "b", name: "卧室", polygon: rectangle(4, 0, 4, 6) },
      ],
      walls: [
        {
          id: "top",
          start: { x: 0, y: 0 },
          end: { x: 8, y: 0 },
          thickness: 0.12,
          height: 2.8,
          exterior: true,
        },
        {
          id: "side",
          start: { x: 8, y: 0 },
          end: { x: 8, y: 6 },
          thickness: 0.12,
          height: 2.8,
          exterior: true,
        },
        {
          id: "partition",
          start: { x: 4, y: 0 },
          end: { x: 4, y: 6 },
          thickness: 0.1,
          height: 2.8,
          exterior: false,
        },
      ],
      openings: [
        {
          wall_id: "top",
          kind: "window",
          offset: 2,
          width: 1.2,
          height: 1.2,
          bottom: 0.9,
        },
      ],
    },
    furniture: {
      items: [
        {
          kind: "chair",
          room_id: "a",
          x: 2,
          y: 2,
          width: 0.5,
          depth: 0.5,
          height: 0.8,
          rotation: 0,
        },
      ],
      notes: [],
    },
  };
}
test("家具跨房间拖动更新归属，原方案不变", () => {
  const d = fixture(),
    before = clone(d);
  const n = moveSelection(d, { type: "furniture", index: 0 }, 3, 0);
  assert.equal(n.furniture.items[0].room_id, "b");
  assert.equal(n.furniture.items[0].x, 5);
  assert.deepEqual(d, before);
  assert.deepEqual(problems(n), []);
});
test("墙体移动联动相邻地板与外轮廓，保留开口相对距离", () => {
  const d = fixture();
  const n = moveWall(d, 0, 0, -0.2);
  assert.equal(n.layout.walls[1].start.y, -0.2);
  assert.equal(n.layout.outline[0].y, -0.2);
  assert.equal(n.layout.rooms[0].polygon[0].y, -0.2);
  assert.equal(n.layout.openings[0].offset, 2);
});
test("窗户只能沿墙移动并限制在墙长内", () => {
  const d = fixture();
  assert.equal(
    moveSelection(d, { type: "openings", index: 0 }, 0, 2).layout.openings[0]
      .offset,
    2,
  );
  assert.equal(
    moveSelection(d, { type: "openings", index: 0 }, 20, 2).layout.openings[0]
      .offset,
    6.8,
  );
});
test("新增通道避让门窗，满墙拒绝添加", () => {
  const d = fixture();
  const o = freeOpening(d.layout, d.layout.walls[0], "passage");
  assert.equal(o.bottom, 0);
  assert.equal(o.kind, "passage");
  d.layout.openings.push(o);
  assert.deepEqual(problems(d), []);
  d.layout.openings = [{ ...o, offset: 0, width: 8 }];
  assert.equal(freeOpening(d.layout, d.layout.walls[0], "window"), null);
});
test("提示家具越界与门窗重叠，识别交叉地板和损坏草稿", () => {
  const d = fixture();
  assert.ok(restorableDraft(d));
  assert.equal(
    restorableDraft({ layout: { rooms: [{}] }, furniture: { items: [] } }),
    false,
  );
  d.furniture.items[0].x = -1;
  d.layout.openings.push({ ...d.layout.openings[0] });
  assert.equal(problems(d).length, 2);
  const p = rectangle(0, 0, 4, 4);
  [p[1], p[2]] = [p[2], p[1]];
  assert.equal(simplePolygon(p), false);
  d.layout.rooms[0].polygon = p;
  assert.ok(problems(d).some((i) => i.type === "rooms"));
});
