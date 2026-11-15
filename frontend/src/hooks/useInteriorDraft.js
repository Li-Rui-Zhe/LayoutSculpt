import { useEffect, useRef, useState } from "react";
import { readInteriorDraft, writeInteriorDraft } from "./interiorDraft.js";

const empty = {
  reference: null,
  prompt: "",
  exterior: "auto",
  exteriorDescription: "",
  submissionId: null,
};
export default function useInteriorDraft() {
  const [value, setValue] = useState(empty);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const touched = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    let alive = true;
    readInteriorDraft()
      .then((saved) => {
        if (alive && !touched.current && saved) {
          setValue(saved);
          setStatus("已恢复上次取景与描述");
        }
      })
      .catch(() => {
        if (alive) setStatus("浏览器暂时无法读取草稿，请保持页面打开");
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded || !touched.current) return;
    const id = ++sequence.current;
    setStatus("正在保存草稿…");
    writeInteriorDraft(value)
      .then(() => {
        if (sequence.current === id)
          setStatus(value.reference ? "取景与描述已保存到本机" : "");
      })
      .catch(() => {
        if (sequence.current === id)
          setStatus("草稿未能保存，请保持页面打开后重试");
      });
    return () => {
      sequence.current++;
    };
  }, [value, loaded]);
  function update(patch) {
    touched.current = true;
    setValue((v) => ({ ...v, ...patch }));
  }
  function choose(reference, options) {
    touched.current = true;
    setValue((v) => ({
      ...(v.reference?.projectId === reference?.projectId ? v : empty),
      ...options,
      reference,
      submissionId: null,
    }));
  }
  function submitted(reference, id) {
    touched.current = true;
    setValue((v) =>
      v.reference === reference ? { ...v, submissionId: id } : v,
    );
  }
  return { ...value, loaded, status, update, choose, submitted };
}
