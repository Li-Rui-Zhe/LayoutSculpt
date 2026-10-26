import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  isRoomFloorHit,
  updateRoomHighlight,
  clearRoomHighlight,
} from "../src/editor/roomSelection.js";
import { selectionFromHit } from "../src/editor/liveModel.js";

function document() {
  return {
    layout: {
      outline: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
      rooms: [
        {
          id: "living",
          name: "客厅",
          polygon: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: 2 },
            { x: 0, y: 2 },
          ],
        },
        {
          id: "bedroom",
          name: "卧室",
          polygon: [
            { x: 2, y: 2 },
            { x: 4, y: 2 },
            { x: 4, y: 4 },
            { x: 2, y: 4 },
          ],
        },
      ],
    },
    furniture: { items: [] },
  };
}

test("地板工具只接受房间地板，家具携带的 room_id 不能抢走选择", () => {
  assert.equal(isRoomFloorHit({ room_id: "living" }), true);
  assert.equal(
    isRoomFloorHit({ live_selection: { type: "rooms", key: "living" } }),
    true,
  );
  for (const metadata of [
    { room_id: "living", furniture_index: 0 },
    { room_id: "living", opening_index: 0 },
    { room_id: "living", fixture_id: "lamp" },
    { room_id: "living", wall_ids: ["wall"] },
    { room_id: "living", live_selection: { type: "furniture", key: "sofa" } },
  ])
    assert.equal(isRoomFloorHit(metadata), false);
});

test("高亮沿真实凹形房间边界，不覆盖缺口或修改设计数据", () => {
  const doc = document(),
    original = JSON.stringify(doc);
  const rt = { scene: new THREE.Scene(), liveOrigin: { x: 2, y: 2 } };
  updateRoomHighlight(rt, doc, { type: "rooms", index: 0 });
  const highlight = rt.roomHighlight;
  assert.equal(highlight.userData.roomId, "living");
  const outline = highlight.children.find((node) => node.isLineLoop);
  assert.equal(outline.geometry.attributes.position.count, 6);
  const mesh = highlight.children.find((node) => node.isMesh);
  const positions = mesh.geometry.attributes.position;
  const indices = mesh.geometry.index;
  let area = 0;
  for (let i = 0; i < indices.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(
      positions,
      indices.getX(i),
    );
    const b = new THREE.Vector3().fromBufferAttribute(
      positions,
      indices.getX(i + 1),
    );
    const c = new THREE.Vector3().fromBufferAttribute(
      positions,
      indices.getX(i + 2),
    );
    area += new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).length() / 2;
  }
  assert.ok(Math.abs(area - 3) < 1e-6);
  assert.equal(JSON.stringify(doc), original);
  updateRoomHighlight(rt, doc, { type: "rooms", index: 0 });
  assert.equal(rt.roomHighlight, highlight, "同一房间不应反复分配网格");
  clearRoomHighlight(rt);
});

test("切换房间和离开地板编辑时释放旧高亮；未铺地板的空间仍可定位", () => {
  const doc = document(),
    rt = { scene: new THREE.Scene() };
  updateRoomHighlight(rt, doc, { type: "rooms", index: 0 });
  let disposed = 0;
  for (const node of rt.roomHighlight.children) {
    node.geometry.addEventListener("dispose", () => disposed++);
    node.material.addEventListener("dispose", () => disposed++);
  }
  doc.layout.rooms[1].floor_enabled = false;
  updateRoomHighlight(rt, doc, { type: "rooms", index: 1 });
  assert.equal(disposed, 4);
  assert.equal(rt.scene.children.length, 1);
  assert.equal(rt.roomHighlight.userData.roomId, "bedroom");
  assert.equal(
    rt.roomHighlight.children.filter((node) => node.isMesh).length,
    0,
  );
  updateRoomHighlight(rt, doc, { type: "furniture", index: 0 });
  assert.equal(rt.scene.children.length, 0);
  assert.equal(rt.roomHighlight, null);
});

test("三维模型后台更新并重排房间后，仍按房间身份定位", () => {
  const original = document(),
    current = document();
  current.layout.rooms.reverse();
  assert.deepEqual(selectionFromHit({ room_id: "living" }, original, current), {
    type: "rooms",
    index: 1,
  });
});
