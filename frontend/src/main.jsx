import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { ViewportProvider } from "./viewer/ViewportRuntime.jsx";
import "./styles/factory.css";
import "./styles/editor.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ViewportProvider>
      <App />
    </ViewportProvider>
  </React.StrictMode>,
);
