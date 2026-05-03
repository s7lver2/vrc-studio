/**
 * FileIcon — SVG icons per file extension.
 * Each type has a distinctive shape, not just a color on a generic File icon.
 */

interface Props {
  ext: string | null;
  isDir?: boolean;
  open?: boolean;
  size?: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

type IconDef = { color: string; bg: string; label: string; path: string };

const icons: Record<string, IconDef> = {
  // ── Unity / 3D packages ──
  unitypackage: {
    color: "#60a5fa", bg: "#1e3a5f",
    label: "UPK",
    path: "M12 2L20 7V12L12 17L4 12V7L12 2ZM12 4.5L6 8V11.5L12 15L18 11.5V8L12 4.5Z M8 9.5L12 12L16 9.5",
  },
  prefab: {
    color: "#a78bfa", bg: "#2e1a5f",
    label: "PRE",
    path: "M12 3L20.5 8V16L12 21L3.5 16V8L12 3Z M12 7L17 10V14L12 17L7 14V10L12 7Z",
  },
  // ── 3D Mesh ──
  fbx: {
    color: "#fb923c", bg: "#431407",
    label: "FBX",
    path: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z M10 7h4M7 10v4M17 10v4M10 17h4",
  },
  obj: {
    color: "#f97316", bg: "#431407",
    label: "OBJ",
    path: "M12 3L21 8.5V15.5L12 21L3 15.5V8.5L12 3Z M12 3V21 M3 8.5L12 14L21 8.5",
  },
  blend: {
    color: "#f97316", bg: "#431407",
    label: "BLD",
    path: "M12 3C7 3 3 7 3 12S7 21 12 21 21 17 21 12 17 3 12 3Z M9 9L15 12L9 15V9Z",
  },
  dae: {
    color: "#f97316", bg: "#431407",
    label: "DAE",
    path: "M5 5l14 14M19 5L5 19 M12 3v18M3 12h18",
  },
  // ── VRM / GLB ──
  vrm: {
    color: "#34d399", bg: "#064e3b",
    label: "VRM",
    path: "M12 3C8 3 5 6 5 10C5 13 7 15.5 10 16.5V20H14V16.5C17 15.5 19 13 19 10C19 6 16 3 12 3Z M9 10C9 8.3 10.3 7 12 7S15 8.3 15 10 13.7 13 12 13 9 11.7 9 10Z",
  },
  glb: {
    color: "#4ade80", bg: "#052e16",
    label: "GLB",
    path: "M12 3C7 3 3 7.5 3 12S7 21 12 21 21 16.5 21 12 17 3 12 3Z M12 3C14.5 5.5 16 8.5 16 12S14.5 18.5 12 21M12 3C9.5 5.5 8 8.5 8 12S9.5 18.5 12 21M3 12H21",
  },
  gltf: {
    color: "#4ade80", bg: "#052e16",
    label: "GLT",
    path: "M12 3C7 3 3 7.5 3 12S7 21 12 21 21 16.5 21 12 17 3 12 3Z M12 3C14.5 5.5 16 8.5 16 12S14.5 18.5 12 21M12 3C9.5 5.5 8 8.5 8 12S9.5 18.5 12 21M3 12H21",
  },
  // ── Images ──
  png: {
    color: "#86efac", bg: "#052e16",
    label: "PNG",
    path: "M4 4h16v16H4V4Z M4 15l4-4 4 3 3-4 5 5 M14 9a1 1 0 110-2 1 1 0 010 2Z",
  },
  jpg: {
    color: "#6ee7b7", bg: "#052e16",
    label: "JPG",
    path: "M4 4h16v16H4V4Z M4 15l4-4 4 3 3-4 5 5 M14 9a1 1 0 110-2 1 1 0 010 2Z",
  },
  jpeg: {
    color: "#6ee7b7", bg: "#052e16",
    label: "JPG",
    path: "M4 4h16v16H4V4Z M4 15l4-4 4 3 3-4 5 5 M14 9a1 1 0 110-2 1 1 0 010 2Z",
  },
  webp: {
    color: "#6ee7b7", bg: "#052e16",
    label: "WBP",
    path: "M4 4h16v16H4V4Z M4 15l4-4 4 3 3-4 5 5 M14 9a1 1 0 110-2 1 1 0 010 2Z",
  },
  tga: {
    color: "#6ee7b7", bg: "#052e16",
    label: "TGA",
    path: "M4 4h16v16H4V4Z M4 15l4-4 4 3 3-4 5 5 M14 9a1 1 0 110-2 1 1 0 010 2Z",
  },
  psd: {
    color: "#38bdf8", bg: "#082f49",
    label: "PSD",
    path: "M4 4h16v16H4V4Z M8 8h4a2 2 0 010 4H8V8Z M8 12h5a3 3 0 010 6H8V12Z",
  },
  // ── Audio ──
  wav: {
    color: "#fbbf24", bg: "#451a03",
    label: "WAV",
    path: "M3 12h2M7 6v12M11 8v8M15 4v16M19 9v6M21 12h2",
  },
  mp3: {
    color: "#fcd34d", bg: "#451a03",
    label: "MP3",
    path: "M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0ZM21 16a3 3 0 11-6 0 3 3 0 016 0Z",
  },
  ogg: {
    color: "#fcd34d", bg: "#451a03",
    label: "OGG",
    path: "M3 12h2M7 6v12M11 8v8M15 4v16M19 9v6M21 12h2",
  },
  flac: {
    color: "#fcd34d", bg: "#451a03",
    label: "FLA",
    path: "M3 12h2M7 6v12M11 8v8M15 4v16M19 9v6M21 12h2",
  },
  // ── Code ──
  cs: {
    color: "#22d3ee", bg: "#083344",
    label: "C#",
    path: "M8 8L3 12L8 16 M16 8L21 12L16 16 M14 5L10 19",
  },
  shader: {
    color: "#f472b6", bg: "#4a044e",
    label: "SHD",
    path: "M12 3L21 12L12 21L3 12L12 3Z M12 7L17 12L12 17L7 12L12 7Z",
  },
  hlsl: {
    color: "#ec4899", bg: "#4a044e",
    label: "HSL",
    path: "M12 3L21 12L12 21L3 12L12 3Z M12 7L17 12L12 17L7 12L12 7Z",
  },
  glsl: {
    color: "#ec4899", bg: "#4a044e",
    label: "GSL",
    path: "M12 3L21 12L12 21L3 12L12 3Z M12 7L17 12L12 17L7 12L12 7Z",
  },
  cginc: {
    color: "#ec4899", bg: "#4a044e",
    label: "CGI",
    path: "M12 3L21 12L12 21L3 12L12 3Z",
  },
  // ── Materials & Animation ──
  mat: {
    color: "#c084fc", bg: "#2e1065",
    label: "MAT",
    path: "M12 3C7 3 3 7 3 12S7 21 12 21 21 17 21 12 17 3 12 3Z M7 9C8.5 7 10.5 6 12 6 M6 14C7 17 9.5 19 12 19",
  },
  anim: {
    color: "#2dd4bf", bg: "#042f2e",
    label: "ANM",
    path: "M5 12H3M21 12H19 M12 5V3M12 21V19 M7 7L5.5 5.5M18.5 18.5L17 17M17 7L18.5 5.5M5.5 18.5L7 17 M12 9v3l2 2",
  },
  controller: {
    color: "#14b8a6", bg: "#042f2e",
    label: "CTL",
    path: "M4 8h16a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1Z M8 12h2M11 11v2 M16 12h.01M14.5 11.5l1 1-1 1",
  },
  overridecontroller: {
    color: "#14b8a6", bg: "#042f2e",
    label: "OVC",
    path: "M4 8h16v10H4V8Z M8 12h2M11 11v2 M16 12h.01",
  },
  // ── Data / Text ──
  json: {
    color: "#fbbf24", bg: "#1c1400",
    label: "JSN",
    path: "M8 3C6 3 5 4 5 6V10C5 11 4 12 3 12C4 12 5 13 5 14V18C5 20 6 21 8 21 M16 3C18 3 19 4 19 6V10C19 11 20 12 21 12C20 12 19 13 19 14V18C19 20 18 21 16 21",
  },
  xml: {
    color: "#fb923c", bg: "#1c0a00",
    label: "XML",
    path: "M4 8L8 12L4 16M20 8L16 12L20 16M12 5L10 19",
  },
  yaml: {
    color: "#fbbf24", bg: "#1c1400",
    label: "YML",
    path: "M8 3C6 3 5 4 5 6V10C5 11 4 12 3 12C4 12 5 13 5 14V18C5 20 6 21 8 21 M16 3C18 3 19 4 19 6V10C19 11 20 12 21 12C20 12 19 13 19 14V18C19 20 18 21 16 21",
  },
  yml: {
    color: "#fbbf24", bg: "#1c1400",
    label: "YML",
    path: "M8 3C6 3 5 4 5 6V10C5 11 4 12 3 12C4 12 5 13 5 14V18C5 20 6 21 8 21 M16 3C18 3 19 4 19 6V10C19 11 20 12 21 12C20 12 19 13 19 14V18C19 20 18 21 16 21",
  },
  txt: {
    color: "#a1a1aa", bg: "#18181b",
    label: "TXT",
    path: "M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1Z M7 7h10M7 11h10M7 15h6",
  },
  md: {
    color: "#94a3b8", bg: "#18181b",
    label: "MD",
    path: "M5 3h14v18H5V3Z M7 7h10M7 11h10M7 15h6 M9 17l2-4 2 4",
  },
  pdf: {
    color: "#f87171", bg: "#450a0a",
    label: "PDF",
    path: "M5 3h14v18H5V3Z M7 7h6a2 2 0 010 4H7V7Z M7 14h4M7 17h7",
  },
  // ── Archives ──
  zip: {
    color: "#fb923c", bg: "#1c0a00",
    label: "ZIP",
    path: "M12 3v9M9 9l3 3 3-3 M5 14h14v7H5V14Z M10 3h4M10 6h4M10 9h4",
  },
  rar: {
    color: "#fb923c", bg: "#1c0a00",
    label: "RAR",
    path: "M12 3v9M9 9l3 3 3-3 M5 14h14v7H5V14Z M10 3h4M10 6h4M10 9h4",
  },
  "7z": {
    color: "#fb923c", bg: "#1c0a00",
    label: "7Z",
    path: "M12 3v9M9 9l3 3 3-3 M5 14h14v7H5V14Z",
  },
  gz: {
    color: "#fb923c", bg: "#1c0a00",
    label: "GZ",
    path: "M12 3v9M9 9l3 3 3-3 M5 14h14v7H5V14Z",
  },
  // ── Unity meta/asset ──
  asset: {
    color: "#71717a", bg: "#18181b",
    label: "AST",
    path: "M12 3a9 9 0 100 18A9 9 0 0012 3Z M12 7v5l3 3",
  },
  meta: {
    color: "#3f3f46", bg: "#09090b",
    label: "MTA",
    path: "M5 3h14v18H5V3Z M7 7h10M7 11h10M7 15h10",
  },
};

const FOLDER_ICON = (open: boolean) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor" className="text-yellow-400">
    {open ? (
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
    ) : (
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    )}
  </svg>
);

const DEFAULT_ICON: IconDef = {
  color: "#a1a1aa", bg: "#18181b",
  label: "???",
  path: "M5 3h9l5 5v13H5V3Z M14 3v5h5",
};

export function FileIcon({ ext, isDir, open, size = 16 }: Props) {
  if (isDir) {
    return (
      <span style={{ width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        {FOLDER_ICON(open ?? false)}
      </span>
    );
  }

  const key = ext?.toLowerCase() ?? "";
  const def = icons[key] ?? DEFAULT_ICON;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={def.color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {def.path.split(" M ").map((segment, i) => (
        <path key={i} d={i === 0 ? segment : `M ${segment}`} />
      ))}
    </svg>
  );
}

/** Small colored badge with extension label, for list rows */
export function ExtBadge({ ext }: { ext: string | null }) {
  const key = ext?.toLowerCase() ?? "";
  const def = icons[key] ?? DEFAULT_ICON;
  return (
    <span
      className="text-[9px] font-mono font-bold px-1 rounded shrink-0"
      style={{ color: def.color, background: def.bg, border: `1px solid ${def.color}33` }}
    >
      {key.toUpperCase() || "???"}
    </span>
  );
}

export function getExtColor(ext: string | null): string {
  const key = ext?.toLowerCase() ?? "";
  return (icons[key] ?? DEFAULT_ICON).color;
}