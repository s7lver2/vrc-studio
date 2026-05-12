// src/components/settings/AppearanceSection.tsx
import {
  Palette, Monitor, Grid3X3, LayoutGrid,
  PanelLeft, Type, Zap, Moon
} from "lucide-react";
import { useAppearanceStore, ItemSize, UiScale } from "@/store/appearanceStore";

// Componente Toggle local (puedes reemplazar con el real si existe)
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`
        relative inline-flex h-5 w-9 items-center rounded-full transition-colors
        ${value ? "bg-violet-500" : "bg-zinc-700"}
      `}
    >
      <span
        className={`
          inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform
          ${value ? "translate-x-4" : "translate-x-1"}
        `}
      />
    </button>
  );
}

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      {children}
    </div>
  );
}

function CardRow({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("px-5 py-4", !last && "border-b border-zinc-800/80")}>
      {children}
    </div>
  );
}

const SIZE_OPTIONS: { value: ItemSize; label: string; desc: string }[] = [
  { value: "compact", label: "Compact", desc: "More items visible, smaller thumbnails" },
  { value: "normal", label: "Normal", desc: "Default size" },
  { value: "large", label: "Large", desc: "Bigger cards, easier to browse" },
];

const SCALE_OPTIONS: { value: UiScale; label: string }[] = [
  { value: 0.8, label: "80%" },
  { value: 0.9, label: "90%" },
  { value: 1.0, label: "100%" },
  { value: 1.1, label: "110%" },
  { value: 1.2, label: "120%" },
];

function SizeSelector({
  value,
  onChange,
  label,
  description,
}: {
  value: ItemSize;
  onChange: (v: ItemSize) => void;
  label: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-medium text-zinc-200">{label}</p>
        <p className="text-[10px] text-zinc-600 mt-0.5">{description}</p>
      </div>
      <div className="flex gap-1.5">
        {SIZE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.desc}
            className={cn(
              "flex-1 py-2 rounded-lg border text-xs font-medium transition-all",
              value === opt.value
                ? "border-violet-500/60 bg-violet-600/15 text-violet-300"
                : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppearanceSection() {
  const {
    shopItemSize,
    inventoryItemSize,
    uiScale,
    setShopItemSize,
    setInventoryItemSize,
    setUiScale,
    // Sidebar
    sidebarWidth,
    setSidebarWidth,
    // Font size
    fontSize,
    setFontSize,
    // Animation speed
    animSpeed,
    setAnimSpeed,
    // Accent color
    accentColor,
    setAccentColor,
    // Background style
    bgStyle,
    setBgStyle,
    // Grid & Layout
    defaultView,
    setDefaultView,
    showTagsInGrid,
    setShowTagsInGrid,
    showTypeIcons,
    setShowTypeIcons,
  } = useAppearanceStore();

  return (
    <>
      {/* Header */}
      <div className="flex items-start gap-4 pb-6 border-b border-zinc-800/60 mb-6">
        <div className="flex-shrink-0 p-2.5 rounded-xl bg-zinc-800 border border-zinc-700/50">
          <Palette className="h-5 w-5 text-zinc-300" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-zinc-100">Appearance</h1>
          <p className="text-sm text-zinc-500 mt-0.5 leading-relaxed">
            Customize the look and feel of VRC Studio
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* Item sizes */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" /> Item Size
          </p>
          <SettingsCard>
            <CardRow>
              <SizeSelector
                value={shopItemSize}
                onChange={setShopItemSize}
                label="Shop & Browse"
                description="Card size in the Shop page grid"
              />
            </CardRow>
            <CardRow last>
              <SizeSelector
                value={inventoryItemSize}
                onChange={setInventoryItemSize}
                label="Inventory"
                description="Card size in your Inventory grid"
              />
            </CardRow>
          </SettingsCard>
        </div>

        {/* UI Scale */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Monitor className="h-3.5 w-3.5" /> UI Scale
          </p>
          <SettingsCard>
            <CardRow last>
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Zoom Level</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">
                    Scales the entire interface — useful on high-DPI screens
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {SCALE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setUiScale(opt.value)}
                      className={cn(
                        "flex-1 py-2 rounded-lg border text-xs font-mono font-medium transition-all",
                        uiScale === opt.value
                          ? "border-violet-500/60 bg-violet-600/15 text-violet-300"
                          : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {uiScale !== 1.0 && (
                  <p className="text-[10px] text-amber-500/70">
                    ⚠ Non-default scale active. Reset to 100% if the UI looks off.
                  </p>
                )}
              </div>
            </CardRow>
          </SettingsCard>
        </div>

        {/* Sidebar Width */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <PanelLeft className="h-3.5 w-3.5" /> Sidebar Width
          </p>
          <SettingsCard>
            <CardRow last>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-zinc-200">Width</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">Narrow collapses the sidebar to icons only</p>
                <div className="flex gap-1.5">
                  {(["narrow", "normal", "wide"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setSidebarWidth(opt)}
                      className={cn(
                        "flex-1 py-2 rounded-lg border text-xs font-medium capitalize transition-all",
                        sidebarWidth === opt
                          ? "border-violet-500/60 bg-violet-600/15 text-violet-300"
                          : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </CardRow>
          </SettingsCard>
        </div>

        {/* Font Size */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Type className="h-3.5 w-3.5" /> Font Size
          </p>
          <SettingsCard>
            <CardRow last>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-zinc-200">Text size</p>
                <div className="flex gap-1.5">
                  {([
                    { value: "small", label: "Small", size: "13px" },
                    { value: "normal", label: "Normal", size: "14px" },
                    { value: "large", label: "Large", size: "15px" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setFontSize(opt.value)}
                      className={cn(
                        "flex-1 py-2 rounded-lg border text-xs font-medium transition-all",
                        fontSize === opt.value
                          ? "border-violet-500/60 bg-violet-600/15 text-violet-300"
                          : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                      )}
                    >
                      <span style={{ fontSize: opt.size }}>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </CardRow>
          </SettingsCard>
        </div>

        {/* Animation Speed */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" /> Animation Speed
          </p>
          <SettingsCard>
            <CardRow last>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-zinc-200">Motion</p>
                <p className="text-[10px] text-zinc-600">Set to Off to disable all transitions</p>
                <div className="flex gap-1.5">
                  {(["off", "slow", "normal", "fast"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setAnimSpeed(opt)}
                      className={cn(
                        "flex-1 py-2 rounded-lg border text-xs font-medium capitalize transition-all",
                        animSpeed === opt
                          ? "border-violet-500/60 bg-violet-600/15 text-violet-300"
                          : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </CardRow>
          </SettingsCard>
        </div>

        {/* Accent Color */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Palette className="h-3.5 w-3.5" /> Accent Color
          </p>
          <SettingsCard>
            <CardRow last>
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium text-zinc-200">Preset colors</p>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { id: "red", hex: "#ef4444", label: "Red (default)" },
                    { id: "violet", hex: "#8b5cf6", label: "Violet" },
                    { id: "blue", hex: "#3b82f6", label: "Blue" },
                    { id: "emerald", hex: "#10b981", label: "Emerald" },
                    { id: "amber", hex: "#f59e0b", label: "Amber" },
                    { id: "pink", hex: "#ec4899", label: "Pink" },
                  ] as const).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setAccentColor(c.id)}
                      title={c.label}
                      className={cn(
                        "w-8 h-8 rounded-full border-2 transition-all",
                        accentColor === c.id ? "border-white scale-110" : "border-transparent hover:border-zinc-400"
                      )}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] text-zinc-500">Custom hex</p>
                  <input
                    type="color"
                    value={accentColor.startsWith("#") ? accentColor : "#ef4444"}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border border-zinc-700"
                  />
                </div>
              </div>
            </CardRow>
          </SettingsCard>
        </div>

        {/* Background */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Moon className="h-3.5 w-3.5" /> Background
          </p>
          <SettingsCard>
            <CardRow last>
              <div className="flex gap-1.5">
                {([
                  { value: "zinc-950", label: "Dark", hex: "#09090b" },
                  { value: "black", label: "Pure Black", hex: "#000000" },
                  { value: "zinc-900", label: "Softer Dark", hex: "#18181b" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setBgStyle(opt.value)}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl border text-xs font-medium transition-all",
                      bgStyle === opt.value
                        ? "border-violet-500/60 bg-violet-600/10 text-violet-300"
                        : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                    )}
                  >
                    <div className="w-8 h-5 rounded border border-zinc-600" style={{ backgroundColor: opt.hex }} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </CardRow>
          </SettingsCard>
        </div>

        {/* Grid & Layout */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Grid3X3 className="h-3.5 w-3.5" /> Grid & Layout
          </p>
          <SettingsCard>
            <CardRow>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Default inventory view</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">Whether items open in grid or list view</p>
                </div>
                <div className="flex gap-1.5">
                  {(["grid", "list"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setDefaultView(v)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-all",
                        defaultView === v
                          ? "border-violet-500/60 bg-violet-600/15 text-violet-300"
                          : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </CardRow>
            <CardRow>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Show tags in grid</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">Display tag badges on inventory cards</p>
                </div>
                <Toggle value={showTagsInGrid} onChange={setShowTagsInGrid} />
              </div>
            </CardRow>
            <CardRow last>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Show type icons</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">Show avatar/outfit/accessory icon on cards</p>
                </div>
                <Toggle value={showTypeIcons} onChange={setShowTypeIcons} />
              </div>
            </CardRow>
          </SettingsCard>
        </div>
      </div>
    </>
  );
}