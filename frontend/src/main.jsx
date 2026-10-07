import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { ViewportProvider } from "./viewer/ViewportRuntime.jsx";
import "./styles/factory.css";
import "./styles/editor.css";
import "./styles/result.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
    <ViewportProvider>
      <App />
    </ViewportProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
