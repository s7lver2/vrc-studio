import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyUiScale } from "@/store/appearanceStore";

// Aplicar la escala guardada al arrancar
try {
  const raw = localStorage.getItem("app:appearance");
  if (raw) {
    const { uiScale } = JSON.parse(raw);
    if (uiScale !== undefined && uiScale !== null) {
      applyUiScale(uiScale as 0.8 | 0.9 | 1.0 | 1.1 | 1.2);
    }
  }
} catch {}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);