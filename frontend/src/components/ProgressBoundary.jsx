import {
  createContext,
  Suspense,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import OperationStatus from "./OperationStatus.jsx";

const PageLoadContext = createContext(null);
export function useBoundaryLoad(loading, label, error) {
  const report = useContext(PageLoadContext);
  useLayoutEffect(() => {
    report?.({ loading, label, error });
    return () => report?.(null);
  }, [report, loading, label, error]);
  return !!report;
}

function Pending({ report }) {
  useLayoutEffect(() => {
    report(true);
  }, [report]);
  return null;
}
function Ready({ report, children }) {
  useLayoutEffect(() => {
    report(false);
  }, [report]);
  return children;
}
// 进度条留在 Suspense 外，模块就绪时可以完成动画，内容无需等待动画才能使用。
export default function ProgressBoundary({ children, label }) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState(null);
  return (
    <>
      <OperationStatus
        active={loading || !!content?.loading}
        failed={!!content?.error}
        label={content?.loading ? content.label : label}
        successLabel="页面已就绪"
        className="route-load-status"
        delay={350}
      />
      <PageLoadContext.Provider value={setContent}>
        <Suspense fallback={<Pending report={setLoading} />}>
          <Ready report={setLoading}>{children}</Ready>
        </Suspense>
      </PageLoadContext.Provider>
    </>
  );
}
