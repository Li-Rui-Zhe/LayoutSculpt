import { Check, X } from "lucide-react";
import "./floorplanExamples.css";

const examples = [
  ["clear", "清晰完整", "墙线、房间边界可辨认", true],
  ["blurred", "严重模糊", "主要墙线已无法分辨", false],
  ["cropped", "结构截断", "住宅边界缺失", false],
  ["landscape", "非户型图", "风景、人物照等不适用", false],
];

export default function FloorplanExamples() {
  return (
    <section className="floorplan-examples" aria-label="户型图上传正反示例">
      <header>
        <strong>什么样的图片更合适？</strong>
        <span>示意对照</span>
      </header>
      <div className="floorplan-example-grid">
        {examples.map(([id, title, note, good]) => (
          <figure key={id} className={`floorplan-example ${id}`}>
            <div className="floorplan-example-image" aria-hidden="true">
              {id === "landscape" ? (
                <svg viewBox="0 0 160 104">
                  <rect width="160" height="104" fill="#e6edf0" />
                  <circle cx="119" cy="28" r="11" fill="#e5c88d" />
                  <path d="M0 95 48 35 100 104H0Z" fill="#8aa79b" />
                  <path d="M45 104 112 49 160 91V104Z" fill="#b0c3b2" />
                </svg>
              ) : (
                <img src="/sample-floorplan.png" alt="" loading="lazy" />
              )}
              <span className={good ? "good" : "bad"}>
                {good ? <Check size={12} /> : <X size={12} />}
              </span>
            </div>
            <figcaption>
              <strong>{title}</strong>
              <small>{note}</small>
            </figcaption>
          </figure>
        ))}
      </div>
      <p>
        手绘、黑白、无尺寸也可以，主要结构清楚即可。无法辨认时会提示换图，保留设计偏好。
      </p>
    </section>
  );
}
