import { createContext, useContext, useEffect, useRef } from "react";

const RuntimeContext = createContext(null);

// 任务状态仍各自保存，只有昂贵的 WebGL 渲染器由应用持有。
export function ViewportProvider({ children }) {
  const runtime = useRef({ scene: null });
  useEffect(() => {
    const holder = runtime.current;
    return () => {
      holder.scene?.dispose();
      holder.scene = null;
    };
  }, []);
  return (
    <RuntimeContext.Provider value={runtime.current}>
      {children}
    </RuntimeContext.Provider>
  );
}

export const useViewportRuntime = () => useContext(RuntimeContext);
