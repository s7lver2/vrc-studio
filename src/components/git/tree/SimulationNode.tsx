import type { SimulationCommit } from "./types";
import { NODE_W, NODE_H } from "./constants";

interface SimulationNodeProps {
  sim: SimulationCommit;
}

// El SVG de borde usa stroke-dashoffset animado.
// La animación marchingAnts debe existir en index.css (ver Task 6 Step 2).
export function SimulationNode({ sim }: SimulationNodeProps) {
  const rx = 10;

  return (
    <div
      style={{
        position: "absolute",
        left: sim.x,
        top: sim.y,
        width: NODE_W,
        height: NODE_H,
        borderRadius: rx,
        opacity: 0.75,
        animation: "simFadeIn 0.35s ease-out",
        pointerEvents: "none",
        zIndex: 15,
      }}
    >
      {/* Badge PREVIEW */}
      <div style={{
        position: "absolute",
        top: -18,
        left: 0,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: sim.color,
        opacity: 0.8,
      }}>
        ◆ preview
      </div>

      {/* Nodo con animación de pulso en borde */}
      <div style={{
        // ... estilos existentes del SimulationNode ...
        border: `1.5px dashed ${sim.color}`,
        animation: "sim-pulse 1.8s ease-in-out infinite",
        boxShadow: `0 0 12px ${sim.color}33`,
      }}></div>
      {/* SVG border con marching ants */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
      >
        <rect
          x={1} y={1}
          width={NODE_W - 2} height={NODE_H - 2}
          rx={rx} ry={rx}
          fill="none"
          stroke={sim.color}
          strokeWidth={1.5}
          strokeDasharray="8 5"
          style={{ animation: "marchingAnts 0.8s linear infinite" }}
        />
      </svg>

      {/* Header */}
      <div style={{
        height: 26,
        background: `${sim.color}22`,
        borderRadius: `${rx}px ${rx}px 0 0`,
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        gap: 6,
      }}>
        <span style={{
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: "0.1em",
          color: sim.color,
          background: `${sim.color}22`,
          borderRadius: 3,
          padding: "1px 5px",
          border: `1px solid ${sim.color}55`,
        }}>
          SIM
        </span>
        <span style={{ fontSize: 9, color: `${sim.color}99`, fontFamily: "monospace" }}>
          preview
        </span>
      </div>

      {/* Body */}
      <div style={{
        height: NODE_H - 26,
        background: "#12121588",
        borderRadius: `0 0 ${rx}px ${rx}px`,
        backdropFilter: "blur(2px)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "4px 10px",
      }}>
        <p style={{
          fontSize: 10,
          color: `${sim.color}bb`,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          margin: 0,
          fontStyle: "italic",
        }}>
          {sim.message}
        </p>
        <p style={{ fontSize: 8, color: "#52525b", margin: 0 }}>simulated result</p>
      </div>
    </div>
  );
}