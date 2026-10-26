import { useEffect, useState } from "react";
import { api } from "../api.js";
import OperationStatus from "../components/OperationStatus.jsx";

const size = (bytes = 0) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
export default function DataManagement() {
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""),
    [restore, setRestore] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api("/maintenance", { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setMessage(e.message);
      });
    return () => controller.abort();
  }, []);
  async function reload() {
    setBusy(true);
    setMessage("");
    try {
      setData(await api("/maintenance"));
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function schedule(action, id) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: id || null }),
      });
      setMessage(result.message);
      setRestore("");
      setData(await api("/maintenance"));
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function cleanCache() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api("/maintenance/cache", { method: "POST" });
      setMessage(result.message);
      setData(await api("/maintenance"));
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="本机数据管理">
      <p>
        {data
          ? `项目 ${size(data.project_bytes)} · 可重建缓存 ${size(data.cache_bytes)}`
          : "正在读取本机数据占用…"}
      </p>
      {!data && message && (
        <button className="secondary-button" disabled={busy} onClick={reload}>
          重试读取
        </button>
      )}
      <p>
        升级前自动备份，保留最近 3 份。包含已同步草稿、任务和自制素材，不含 API
        密钥与 Codex 登录。未同步的浏览器草稿请先保存。
      </p>
      {data?.pending?.action && (
        <p role="status">
          下次启动将
          {data.pending.action === "restore" ? "恢复所选备份" : "创建备份"}。
          <button
            disabled={busy}
            className="text-button"
            onClick={() => schedule("cancel")}
          >
            取消安排
          </button>
        </p>
      )}
      <button
        className="secondary-button"
        disabled={busy || !data}
        onClick={() => schedule("backup")}
      >
        下次启动备份
      </button>
      <button
        className="text-button"
        disabled={busy || !data?.cache_bytes}
        onClick={cleanCache}
      >
        清理可重建缓存
      </button>
      <p>
        AI 缓存最多保留 30 天、512 MB，定期自动清理；清理后首次生成可能稍慢。
      </p>
      <p>
        备份默认保存在本机。可下载到移动硬盘等其他位置；备份代表下方标注时间点的数据。
      </p>
      <OperationStatus active={busy} label="正在处理本机数据操作" />
      {message && (
        <p role="status">
          {message}
          <button className="text-button" onClick={() => setMessage("")}>
            关闭
          </button>
        </p>
      )}
      {data?.backups.map((item) => (
        <div key={item.id} className="workspace-note">
          <span>
            {new Date(item.created_at).toLocaleString("zh-CN")} ·{" "}
            {size(item.bytes)}
          </span>
          <a
            href={`/api/maintenance/backups/${item.id}/download`}
            download
            onClick={() =>
              setMessage(
                "正在校验并准备备份下载，请在浏览器下载记录中查看。备份不含账号密钥。",
              )
            }
          >
            下载备份
          </a>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setRestore(item.id)}
          >
            恢复
          </button>
          {restore === item.id && (
            <div>
              <p>
                下次启动将恢复到此时间点；恢复前会备份当前数据。密钥和登录保持当前设置。
              </p>
              <button
                disabled={busy}
                className="secondary-button"
                onClick={() => schedule("restore", item.id)}
              >
                确认下次启动恢复
              </button>
              <button className="text-button" onClick={() => setRestore("")}>
                取消
              </button>
            </div>
          )}
        </div>
      ))}
      {data && !data.backups.length && (
        <p>暂无备份。首次升级已有项目或安排备份后，下次启动会创建。</p>
      )}
    </section>
  );
}
