import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import {
  useAppearanceStore,
  applyUiScale,
  applyFontSize,
  applyAnimSpeed,
  applyAccentColor,
  applySidebarWidth,
  applyBgStyle,
} from "@/store/appearanceStore";


const s = useAppearanceStore.getState();
applyUiScale(s.uiScale);
applyFontSize(s.fontSize);
applyAnimSpeed(s.animSpeed);
applyAccentColor(s.accentColor);
applySidebarWidth(s.sidebarWidth);
applyBgStyle(s.bgStyle);

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