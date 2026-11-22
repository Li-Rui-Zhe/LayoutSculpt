import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Box,
  Compass,
  FileImage,
  History,
  Check,
  SlidersHorizontal,
  Layers,
  Sparkles,
} from "lucide-react";
import { api } from "../api.js";
import { showcase } from "../catalog.js";
import {
  readContext,
  useUrlContext,
  writeContext,
} from "../hooks/urlContext.js";
import {
  exteriorDescriptionLimit,
  interiorExteriors,
} from "../hooks/interiorDraft.js";
import {
  captureWhitePanorama,
  listPanoramaRooms,
  openPanoramaCapture,
  panoramaDoors,
} from "../viewer/panoramaCapture.js";
import PanoramaView from "../viewer/PanoramaView.jsx";
import RoamHistory, { historyDate } from "./RoamHistory.jsx";
import LoadingProgress from "./LoadingProgress.jsx";
import WorkspaceSidebar from "./WorkspaceSidebar.jsx";
import StructureReview from "./StructureReview.jsx";
import { pollInteriorHistory } from "./interiorImageState.js";
import "./real-roam.css";

const sample = { id: "sample", title: showcase.title, url: showcase.model_url };
const panoramaBatchLimit = 16;
const modelSteps = ["识别户型", "布置白模", "生成模型"];
const defaultPrompt =
  "像普通住宅的自然实拍。浅色木材、哑光墙面和少量布艺，窗边自然亮、室内有层次。保持房间原有布局，少摆装饰，保留干净的天花板。";

function roomRecord(item, room, projectId) {
  const context = item.context;
  return (
    !item.archived &&
    context?.framing === "panorama" &&
    context.projectId === projectId &&
    (context.roomId
      ? context.roomId === room.id
      : context.roomName === room.name)
  );
}

export default function RealRoam({
  projectId,
  job,
  jobs,
  projects,
  onEditStructure,
  onProject,
  onHistoryTask,
}) {
  const project =
    projectId === "sample"
      ? sample
      : {
          id: projectId,
          title: job?.name || "当前方案",
          url: job?.result?.model_url,
        };
  const [previews, setPreviews] = useState(() => new Map());
  const [records, setRecords] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState("");
  const [versionId, setVersionId] = useUrlContext("roamVersion", "");
  const [settingsChoice, setSettingsChoice] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewActionsHost, setReviewActionsHost] = useState(null);
  const [roomError, setRoomError] = useState("");
  const [mode, setMode] = useState("result");
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [exterior, setExterior] = useState("auto");
  const [exteriorDescription, setExteriorDescription] = useState("");
  const [busy, setBusy] = useState("");
  const [prepared, setPrepared] = useState(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState(false);
  const [revision, refresh] = useState(0);
  const live = useRef(false);
  const request = useRef(null);
  const lastAutoCapture = useRef(null);
  const briefSet = useRef(false);
  const room = rooms.find((item) => item.id === roomId);
  const versions = records.filter(
    (item) =>
      !item.archived &&
      item.context?.framing === "panorama" &&
      item.context.projectId === project.id,
  );
  const historical = versions.find(
    ({ id, status }) =>
      id === versionId && (status === "ready" || status === "failed"),
  );
  const viewRoom = historical
    ? rooms.find((item) => roomRecord(historical, item, project.id))
    : room;
  const viewName = viewRoom?.name || historical?.context.roomName || room?.name;
  const canGenerateRoom = room && (!historical || viewRoom?.id === room.id);
  const roomStates = useMemo(
    () =>
      rooms.map((item) => {
        const matches = records.filter((record) =>
          roomRecord(record, item, project.id),
        );
        const active = matches.find((record) =>
          ["queued", "generating"].includes(record.status),
        );
        const ready = matches.find((record) => record.status === "ready");
        return { room: item, latest: matches[0], active, ready };
      }),
    [project.id, records, rooms],
  );
  const { latest, ready } =
    roomStates.find((item) => item.room.id === roomId) || {};
  const settingsOpen = settingsChoice ?? (historyLoaded && !!room && !ready);
  const roomErrorMessage = error || (historical || latest)?.error;
  const source = previews.get(roomId);
  const running = records.find((item) => item.status === "generating");
  const waiting = roomStates.filter(
    ({ active }) => active?.status === "queued",
  );
  const completed = roomStates.filter(({ ready }) => ready).length;
  const remaining = roomStates.filter(({ active, ready }) => !active && !ready);
  const hasBrief =
    !!prompt.trim() && (exterior !== "custom" || !!exteriorDescription.trim());
  const displayed = historical || ready;
  const white = historical
    ? historical.view_url
    : source?.image || (ready || latest)?.view_url;
  const showingResult = mode === "result" && !!displayed?.image_url;
  const panorama = showingResult ? displayed.image_url : white;
  const viewContext =
    historical?.context ||
    (showingResult ? ready.context : source || (ready || latest)?.context);
  const compactRoom = /卧|卫生间|厕所|bedroom|toilet/i.test(viewName || "");
  const focus = viewContext?.landmarks?.find(({ label }) =>
    /马桶|坐便/.test(label),
  );
  const heading =
    compactRoom && focus ? (focus.x / 100 - 0.5) * 360 : viewContext?.heading;
  const defaultHeading = (id) =>
    project.id === "sample" && id === rooms[0]?.id ? Math.PI / 3 : undefined;
  const preferredHeading = defaultHeading(viewRoom?.id);
  const doors = useMemo(
    () => panoramaDoors(viewRoom, viewContext, preferredHeading),
    [viewRoom, viewContext, preferredHeading],
  );
  const awaitingReview = job?.status === "awaiting_review";
  const stopped = ["failed", "cancelled"].includes(job?.status);
  const buildingModel = !project.url && !panorama;
  const structureOnly = job?.result?.delivery_status === "structure_ready";

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!project.url) return;
    let current = true;
    listPanoramaRooms(project.url)
      .then((available) => {
        if (!current) return;
        setRooms(available);
        const savedRoomId = readContext("roamRoom");
        const savedRoom = available.find(({ id }) => id === savedRoomId);
        setRoomId(savedRoom?.id || available[0]?.id || "");
        setRoomError(available.length ? "" : "当前模型里没有可取景的房间。");
      })
      .catch(() => {
        if (current) setRoomError("暂时无法读取房间，请刷新页面重试。");
      });
    return () => {
      current = false;
    };
  }, [project.url]);
  useEffect(() => {
    const controller = new AbortController();
    const stop = pollInteriorHistory({
      load: () => api("/interior-images", { signal: controller.signal }),
      onData: (value) => {
        if (!briefSet.current) {
          briefSet.current = true;
          const saved = value.items.find(
            (item) =>
              !item.archived &&
              item.context?.framing === "panorama" &&
              item.context.projectId === project.id,
          );
          if (saved) {
            setPrompt(saved.prompt);
            setExterior(saved.context.exterior || "auto");
            setExteriorDescription(saved.context.exteriorDescription || "");
          }
        }
        setRecords(value.items);
        setHistoryLoaded(true);
        setHistoryError(false);
      },
      onError: () => setHistoryError(true),
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [project.id, revision]);

  useEffect(() => {
    if (!historical && latest?.status === "ready") setMode("result");
  }, [latest?.id, latest?.status, historical?.id]);
  useEffect(() => {
    if (historical && viewRoom?.id && viewRoom.id !== roomId) {
      setRoomId(viewRoom.id);
      writeContext({ roamRoom: viewRoom.id });
    }
  }, [historical, viewRoom?.id, roomId]);

  async function perform(action, operation) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setBusy(action);
    try {
      await operation(controller.signal);
    } catch (err) {
      if (live.current && !controller.signal.aborted) {
        setError(err.message);
        refresh((n) => n + 1);
      }
    } finally {
      request.current = null;
      if (live.current) setBusy("");
    }
  }

  function prepare(target) {
    return perform("capture", async (signal) => {
      const next = await captureWhitePanorama(
        project.url,
        target.id,
        defaultHeading(target.id),
      );
      if (!signal.aborted)
        setPreviews((items) => new Map(items).set(target.id, next));
    });
  }

  // 等房间和历史都就绪后再取景，已有全景直接显示。
  useEffect(() => {
    if (
      !historyLoaded ||
      !room ||
      white ||
      historical ||
      busy ||
      lastAutoCapture.current === room.id
    )
      return;
    lastAutoCapture.current = room.id;
    void prepare(room);
  }, [historyLoaded, room, white, historical, busy]);

  function selectRoom(id) {
    if (id === roomId && !historical) return;
    const target = roomStates.find((item) => item.room.id === id);
    if (!target) return;
    setRoomId(id);
    writeContext({ roamRoom: id });
    setVersionId("");
    setMode("result");
    setError("");
    lastAutoCapture.current = null;
  }

  function openVersion(item) {
    const target = rooms.find((room) => roomRecord(item, room, project.id));
    if (target) {
      setRoomId(target.id);
      writeContext({ roamRoom: target.id });
    }
    setVersionId(item.id);
    setMode(item.image_url ? "result" : "white");
    setHistoryOpen(false);
  }

  function useHistoricalBrief() {
    setPrompt(historical.prompt);
    setExterior(historical.context.exterior || "auto");
    setExteriorDescription(historical.context.exteriorDescription || "");
  }

  async function addReference(form, view, signal) {
    const image = await fetch(view.image, { signal });
    form.append("view", await image.blob(), "view.jpg");
    form.append(
      "context",
      JSON.stringify({
        projectId: project.id,
        title: Array.from(project.title).slice(0, 120).join(""),
        framing: "panorama",
        roomId: view.roomId,
        roomName: Array.from(view.roomName).slice(0, 80).join(""),
        landmarks: view.landmarks,
        heading: view.heading,
        rotation: view.rotation,
        exterior,
        exteriorDescription:
          exterior === "custom" ? exteriorDescription.trim() : undefined,
      }),
    );
  }

  function trackSubmission(items) {
    const ids = new Set(items.map(({ id }) => id));
    setRecords((previous) => [
      ...items,
      ...previous.filter(({ id }) => !ids.has(id)),
    ]);
    refresh((n) => n + 1);
  }

  function generate(event) {
    event.preventDefault();
    if (
      busy ||
      running ||
      waiting.length ||
      !canGenerateRoom ||
      !hasBrief ||
      !historyLoaded
    )
      return;
    return perform(source ? "submit" : "capture", async (signal) => {
      const view =
        source ||
        (await captureWhitePanorama(project.url, room.id, preferredHeading));
      if (signal.aborted) return;
      setBusy("submit");
      const form = new FormData();
      form.set("prompt", prompt.trim());
      await addReference(form, view, signal);
      const value = await api("/interior-image", {
        method: "POST",
        body: form,
        signal,
      });
      if (!signal.aborted) {
        setVersionId("");
        trackSubmission([value]);
      }
    });
  }

  function generateRemaining() {
    if (busy || !remaining.length || !hasBrief || !historyLoaded) return;
    setPrepared(0);
    return perform("batch", async (signal) => {
      const capture = await openPanoramaCapture(project.url);
      try {
        for (
          let offset = 0;
          offset < remaining.length;
          offset += panoramaBatchLimit
        ) {
          const form = new FormData();
          form.set("prompt", prompt.trim());
          for (const { room: target } of remaining.slice(
            offset,
            offset + panoramaBatchLimit,
          )) {
            if (signal.aborted) return;
            const view =
              previews.get(target.id) ||
              capture.capture(target.id, defaultHeading(target.id));
            await addReference(form, view, signal);
            setPrepared((number) => number + 1);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          const { items } = await api("/interior-images/batch", {
            method: "POST",
            body: form,
            signal,
          });
          if (!signal.aborted) trackSubmission(items);
        }
      } finally {
        capture.dispose();
      }
    });
  }

  function stopWaiting() {
    return perform("stop", async (signal) => {
      const batches = new Set(waiting.map(({ active }) => active.batch_id));
      for (const batch of batches)
        await api("/interior-images/batches/" + batch + "/cancel", {
          method: "POST",
          signal,
        });
      if (!signal.aborted) refresh((n) => n + 1);
    });
  }

  const generatingRoom = roomStates.find(
    ({ active }) => active?.status === "generating",
  )?.room.name;
  const progressText =
    busy === "batch"
      ? "准备白模底图 " + prepared + " 张"
      : generatingRoom
        ? generatingRoom +
          "生成中" +
          (waiting.length ? " · " + waiting.length + " 间排队" : "")
        : waiting.length
          ? waiting.length + " 间排队"
          : "";

  return (
    <section className="real-roam" aria-labelledby="roam-title">
      <header className="roam-heading">
        <div>
          <h1 id="roam-title">
            真实漫游 <small>实验</small>
          </h1>
          <p>
            {project.title}
            {rooms.length > 0 && ` · ${completed} / ${rooms.length} 间已生成`}
          </p>
        </div>
      </header>
      {structureOnly && (
        <p className="roam-model-status">
          户型结构已生成，家具待补齐。
          <button type="button" className="text-button" onClick={onProject}>
            查看当前方案
          </button>
        </p>
      )}
      {buildingModel ? (
        <div className="roam-layout roam-preparation">
          {awaitingReview ? (
            <StructureReview
              key={job.id}
              job={job}
              projects={projects}
              onEdit={onEditStructure}
              actionsHost={reviewActionsHost}
              inRoam
            />
          ) : job?.source_url ? (
            <figure className="roam-build-plan">
              <figcaption>
                <FileImage size={15} /> 原始户型图
              </figcaption>
              <a
                href={job.source_url}
                target="_blank"
                rel="noreferrer"
                aria-label="放大原始户型图"
              >
                <img src={job.source_url} alt="本次上传的户型图" />
              </a>
            </figure>
          ) : null}
          <WorkspaceSidebar
            label="漫游进度侧栏"
            className="roam-preparation-sidebar"
          >
            <h2>
              {awaitingReview
                ? "漫游进度"
                : stopped
                  ? "白模未完成"
                  : "正在准备漫游白模"}
            </h2>
            {awaitingReview ? (
              <ol className="roam-steps">
                <li aria-current="step">
                  <strong>核对户型</strong>
                  <span>检查墙体和门窗的位置</span>
                </li>
                <li>生成白模</li>
                <li>按房间生成全景</li>
              </ol>
            ) : stopped ? (
              <p role="status">{job.error || job.stage}</p>
            ) : (
              <LoadingProgress
                compact
                label={job?.stage || "正在读取任务"}
                progress={job?.progress}
                indeterminate={!job}
                operationKey={project.id}
                steps={modelSteps}
                step={job?.progress >= 82 ? 2 : job?.progress >= 58 ? 1 : 0}
              />
            )}
            {awaitingReview && (
              <div className="roam-review-actions" ref={setReviewActionsHost} />
            )}
            <div className="roam-sidebar-actions">
              {!awaitingReview && (
                <button className="secondary-button" onClick={onProject}>
                  查看任务 <ArrowUpRight size={15} />
                </button>
              )}
              <button
                className="secondary-button"
                onClick={() => setHistoryOpen(true)}
              >
                <History size={15} /> 漫游历史
              </button>
            </div>
          </WorkspaceSidebar>
        </div>
      ) : (
        <div className="roam-layout">
          <div className="roam-stage">
            {(progressText || roomErrorMessage) && (
              <p className="roam-stage-status" role="status">
                {roomErrorMessage || progressText}
              </p>
            )}
            {panorama ? (
              <PanoramaView
                key={viewRoom?.id || historical?.id || roomId}
                src={panorama}
                initialHeading={
                  heading == null ? preferredHeading : (heading * Math.PI) / 180
                }
                initialPitch={compactRoom ? -Math.PI / 9 : -Math.PI / 30}
                label={showingResult ? "写实全景" : "白模全景"}
                smoothSeam={showingResult}
                doors={doors}
                onRoomChange={selectRoom}
              />
            ) : busy === "capture" || (!room && !roomError) ? (
              <div className="roam-placeholder roam-capture-progress">
                <LoadingProgress
                  indeterminate
                  label={busy === "capture" ? "正在取景" : "正在读取房间"}
                  detail={
                    busy === "capture"
                      ? "正在从室内站位采集白模全景。"
                      : undefined
                  }
                />
              </div>
            ) : (
              <div className="roam-placeholder">
                <Compass size={40} />
                <strong>{room ? "准备全景" : "暂时无法取景"}</strong>
                <p>{roomError || "查看白模，或直接生成写实全景。"}</p>
                {room && (
                  <button
                    className="secondary-button"
                    disabled={!!busy}
                    onClick={() => prepare(room)}
                  >
                    <Box size={16} /> 查看白模
                  </button>
                )}
              </div>
            )}
            <footer className="roam-viewbar">
              <span>
                <strong>{viewName || project.title}</strong>
                <small className="roam-gesture">
                  拖动环顾 · 点门口切换房间
                </small>
              </span>
              <div role="group" aria-label="全景视图">
                <button
                  type="button"
                  aria-pressed={!!white && !showingResult}
                  disabled={(!room || !!busy) && !white}
                  onClick={() => {
                    setMode("white");
                    if (!white) void prepare(room);
                  }}
                >
                  <Box size={15} /> 白模
                </button>
                <button
                  type="button"
                  aria-pressed={showingResult}
                  disabled={!displayed?.image_url}
                  onClick={() => setMode("result")}
                >
                  <Sparkles size={15} /> 写实
                </button>
              </div>
            </footer>
            {historical && (
              <div className="roam-version-bar">
                <span>
                  <History size={15} /> 历史版本 ·{" "}
                  {historyDate.format(new Date(historical.created_at))}
                </span>
                <div>
                  <button type="button" onClick={useHistoricalBrief}>
                    沿用设置
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVersionId("");
                      setMode("result");
                    }}
                  >
                    返回最新
                  </button>
                </div>
              </div>
            )}
          </div>
          <WorkspaceSidebar
            label="真实漫游侧栏"
            className="roam-sidebar"
            compactToggle={`房间与生成 · ${completed}/${rooms.length}`}
          >
            <div className="roam-room-panel">
              <h2>房间</h2>
              {rooms.length > 0 && (
                <div className="roam-rooms" role="group" aria-label="切换房间">
                  {roomStates.map(
                    ({
                      room: item,
                      latest: record,
                      active,
                      ready: complete,
                    }) => {
                      const status =
                        active?.status === "generating"
                          ? "生成中"
                          : active?.status === "queued"
                            ? "排队中"
                            : record?.status === "failed"
                              ? "可重试"
                              : complete
                                ? "已生成"
                                : "待生成";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-label={`${item.name} · ${status}`}
                          title={`${item.name} · ${status}`}
                          aria-pressed={item.id === roomId}
                          onClick={() => selectRoom(item.id)}
                        >
                          {item.name}{" "}
                          {status === "已生成" ? (
                            <Check size={13} aria-hidden="true" />
                          ) : (
                            <small data-status={status}>{status}</small>
                          )}
                        </button>
                      );
                    },
                  )}
                </div>
              )}

              <div className="roam-sidebar-actions">
                <button
                  type="button"
                  className="secondary-button"
                  aria-expanded={settingsOpen}
                  aria-controls="roam-settings"
                  onClick={() => setSettingsChoice(!settingsOpen)}
                >
                  <SlidersHorizontal size={15} /> 生成设置
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setHistoryOpen(true)}
                >
                  <History size={15} /> 漫游历史
                </button>
              </div>
            </div>
            <div id="roam-settings" hidden={!settingsOpen}>
              {roomStates.length > 0 && (
                <section
                  className="roam-batch"
                  aria-labelledby="roam-batch-title"
                >
                  <div className="roam-batch-heading">
                    <h2 id="roam-batch-title">
                      <Layers size={16} /> 整屋进度
                    </h2>
                    <span>
                      {completed} / {rooms.length}
                    </span>
                  </div>
                  {progressText ? (
                    <LoadingProgress
                      compact
                      indeterminate
                      label={progressText}
                      operationKey={project.id}
                      showSlow={false}
                    />
                  ) : (
                    <progress
                      aria-label="已生成房间"
                      max={rooms.length}
                      value={completed}
                    />
                  )}
                  {waiting.length > 0 && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={!!busy}
                      onClick={stopWaiting}
                    >
                      停止排队
                    </button>
                  )}
                </section>
              )}
              <form className="roam-form" onSubmit={generate}>
                <label htmlFor="roam-prompt">装修想法</label>
                <textarea
                  id="roam-prompt"
                  value={prompt}
                  onChange={(e) => {
                    briefSet.current = true;
                    setPrompt(e.target.value);
                  }}
                  maxLength={1200}
                  rows={5}
                  disabled={busy === "batch" || busy === "submit"}
                />
                <label htmlFor="roam-exterior">窗外景色</label>
                <select
                  id="roam-exterior"
                  value={exterior}
                  onChange={(e) => {
                    briefSet.current = true;
                    setExterior(e.target.value);
                  }}
                  disabled={busy === "batch" || busy === "submit"}
                >
                  {Object.entries(interiorExteriors).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {exterior === "custom" && (
                  <input
                    type="text"
                    aria-label="自定义窗外景色"
                    value={exteriorDescription}
                    maxLength={exteriorDescriptionLimit}
                    onChange={(e) => {
                      briefSet.current = true;
                      setExteriorDescription(e.target.value);
                    }}
                    placeholder="例如：远处是河岸和树冠"
                    disabled={busy === "batch" || busy === "submit"}
                  />
                )}
                {remaining.length > 0 && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!!busy || !hasBrief || !historyLoaded}
                    onClick={generateRemaining}
                  >
                    <Layers size={16} />{" "}
                    {completed ? "生成剩余房间" : "生成整屋全景"}（
                    {remaining.length}）
                  </button>
                )}
                <button
                  className={
                    remaining.length ? "secondary-button" : "primary-button"
                  }
                  disabled={
                    !canGenerateRoom ||
                    !!busy ||
                    !!running ||
                    !!waiting.length ||
                    !hasBrief ||
                    !historyLoaded
                  }
                >
                  <Sparkles size={16} />{" "}
                  {busy === "submit"
                    ? "正在提交…"
                    : ready
                      ? "重新生成本房间"
                      : "生成本房间"}
                </button>
                {roomErrorMessage && (
                  <p role="alert" className="roam-error">
                    {roomErrorMessage}
                  </p>
                )}
                {historyError && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => refresh((n) => n + 1)}
                  >
                    重新同步进度
                  </button>
                )}
                <p>生图时会将白模底图和装修描述发送给 ImageGen。</p>
              </form>
            </div>
          </WorkspaceSidebar>
        </div>
      )}
      {historyOpen && (
        <RoamHistory
          jobs={jobs}
          records={records}
          project={project}
          loading={!historyLoaded && !historyError}
          error={historyError}
          onRetry={() => refresh((n) => n + 1)}
          onClose={() => setHistoryOpen(false)}
          onOpen={async (target, item) => {
            if (target.id === project.id && item) openVersion(item);
            else {
              await onHistoryTask(target.id, item);
              setHistoryOpen(false);
            }
          }}
        />
      )}
    </section>
  );
}
