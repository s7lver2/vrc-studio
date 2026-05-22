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
        ${value ? "" : "bg-zinc-700"}
      `}
            style={value ? { background: "var(--accent-color)" } : {}}
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
                                ? "border-zinc-700"
                                : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                        )}
                        style={value === opt.value ? {
                            borderColor: "var(--accent-color)",
                            background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.12)",
                            color: "var(--accent-color)",
                        } : {}}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function AppearanceSection() {
    const store = useAppearanceStore();
    const {
        shopItemSize, inventoryItemSize, uiScale,
        setShopItemSize, setInventoryItemSize, setUiScale,
        sidebarWidth, setSidebarWidth,
        fontSize, setFontSize,
        animSpeed, setAnimSpeed,
        accentColor, setAccentColor,
        bgStyle, setBgStyle,
        defaultView, setDefaultView,
        showTagsInGrid, setShowTagsInGrid,
        showTypeIcons, setShowTypeIcons,
    } = store;

    const accentBorder = { borderColor: "var(--accent-color)" } as React.CSSProperties;
    const accentBg = { borderColor: "var(--accent-color)", background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.12)" } as React.CSSProperties;
    const accentText = { color: "var(--accent-color)" } as React.CSSProperties;

    const ACCENT_PALETTE = [
        { id: "violet", hex: "#8b5cf6", label: "Violet" },
        { id: "blue", hex: "#3b82f6", label: "Blue" },
        { id: "emerald", hex: "#10b981", label: "Emerald" },
        { id: "red", hex: "#ef4444", label: "Red" },
        { id: "amber", hex: "#f59e0b", label: "Amber" },
        { id: "pink", hex: "#ec4899", label: "Pink" },
        { id: "cyan", hex: "#06b6d4", label: "Cyan" },
        { id: "rose", hex: "#f43f5e", label: "Rose" },
    ] as const;

    const activeAccent = ACCENT_PALETTE.find(c => c.id === accentColor) ?? ACCENT_PALETTE[0];

    return (
        <div className="flex flex-col gap-8">
            {/* ACCENT COLOR — protagonista, grande */}
            <div className="rounded-2xl overflow-hidden border border-zinc-800"
                style={{ background: `linear-gradient(135deg, ${activeAccent.hex}18, #09090b 60%)` }}
            >
                <div className="p-6 flex flex-col gap-5">
                    <div className="flex items-center gap-2">
                        <Palette className="h-4 w-4" style={{ color: activeAccent.hex }} />
                        <p className="text-sm font-bold text-zinc-100">Accent</p>
                        <span className="ml-auto text-[10px] font-mono text-zinc-500">{activeAccent.hex}</span>
                    </div>

                    {/* Selector de colores — círculos grandes */}
                    <div className="flex gap-3 flex-wrap">
                        {ACCENT_PALETTE.map((c) => (
                            <button
                                key={c.id}
                                onClick={() => setAccentColor(c.id)}
                                title={c.label}
                                className="relative group"
                            >
                                <div
                                    className="w-10 h-10 rounded-full transition-all duration-200"
                                    style={{
                                        background: c.hex,
                                        boxShadow: accentColor === c.id ? `0 0 0 3px #09090b, 0 0 0 5px ${c.hex}, 0 0 16px ${c.hex}66` : "none",
                                        transform: accentColor === c.id ? "scale(1.15)" : "scale(1)",
                                    }}
                                />
                                <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[8px] text-zinc-600 opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity">
                                    {c.label}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Mini preview de la UI con el color seleccionado */}
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 flex items-center gap-3">
                        <div className="w-2 h-8 rounded-full" style={{ background: activeAccent.hex }} />
                        <div className="flex-1 flex flex-col gap-1">
                            <div className="h-2 rounded-full w-24" style={{ background: activeAccent.hex + "40" }} />
                            <div className="h-1.5 rounded-full w-16 bg-zinc-800" />
                        </div>
                        <div className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: activeAccent.hex, color: "#fff" }}>
                            Button
                        </div>
                    </div>
                </div>
            </div>

            {/* BACKGROUND */}
            <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <Moon className="h-3.5 w-3.5" /> Background
                </p>
                <div className="grid grid-cols-3 gap-2">
                    {([
                        { value: "zinc-950", label: "Dark", hex: "#09090b", desc: "Default" },
                        { value: "black", label: "Pure Black", hex: "#000000", desc: "big contrast" },
                        { value: "zinc-900", label: "Softer Dark", hex: "#18181b", desc: "more soft" },
                    ] as const).map((opt) => (
                        <button
                            key={opt.value}
                            onClick={() => setBgStyle(opt.value)}
                            className={cn(
                                "flex flex-col items-start gap-2 p-3 rounded-xl border-2 transition-all",
                                bgStyle === opt.value
                                    ? "border-zinc-700"          // el color real viene del style={}
                                    : "border-zinc-800 hover:border-zinc-700"
                            )}
                            style={bgStyle === opt.value ? {
                                ...accentBorder,
                                boxShadow: `0 0 12px hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.25)`,
                                background: opt.hex,
                            } : { background: opt.hex }}
                        >
                            <div className="w-full h-8 rounded-lg border border-white/5 flex items-center justify-center">
                                <div className="w-8 h-2 rounded-full bg-white/10" />
                            </div>
                            <div className="text-left">
                                <p className="text-xs font-semibold text-zinc-200">{opt.label}</p>
                                <p className="text-[9px] text-zinc-600">{opt.desc}</p>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* UI SCALE — slider bonito */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                        <Monitor className="h-3.5 w-3.5" /> UI scale
                    </p>
                    <span className="text-sm font-mono font-bold" style={{ color: activeAccent.hex }}>
                        {Math.round(uiScale * 100)}%
                    </span>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                    <input
                        type="range"
                        min={80} max={120} step={5}
                        value={uiScale * 100}
                        onChange={(e) => setUiScale(Number(e.target.value) / 100 as any)}
                        className="w-full cursor-pointer h-1.5 rounded-full appearance-none"
                        style={{ accentColor: activeAccent.hex }}
                    />
                    <div className="flex justify-between text-[9px] text-zinc-700 mt-2">
                        <span>80% — compact</span>
                        <span>100%</span>
                        <span>120% — big</span>
                    </div>
                    {uiScale !== 1.0 && (
                        <p className="text-[10px] text-amber-500/70 mt-3 flex items-center gap-1">
                            <span>⚠</span> Not Default Scale Active
                        </p>
                    )}
                </div>
            </div>

            {/* FONT SIZE — preview en vivo */}
            <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <Type className="h-3.5 w-3.5" /> Font Size
                </p>
                <div className="grid grid-cols-3 gap-2">
                    {([
                        { value: "small", label: "Small", size: "11px", demo: "Aa" },
                        { value: "normal", label: "Normal", size: "13px", demo: "Aa" },
                        { value: "large", label: "Big", size: "15px", demo: "Aa" },
                    ] as const).map((opt) => (
                        <button
                            key={opt.value}
                            onClick={() => setFontSize(opt.value)}
                            className={cn(
                                "flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all",
                                fontSize === opt.value
                                    ? "border-zinc-700"
                                    : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                            )}
                            style={fontSize === opt.value ? accentBg : {}}
                        >
                            <span style={{ fontSize: opt.size }} className="font-bold text-zinc-200">
                                {opt.demo}
                            </span>
                            <span className="text-[10px] text-zinc-500">{opt.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* ITEM SIZE */}
            <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5" /> Card Sizes
                </p>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800">
                    {([
                        { key: "shop", value: shopItemSize, setter: setShopItemSize, label: "Shop" },
                        { key: "inventory", value: inventoryItemSize, setter: setInventoryItemSize, label: "Inventory" },
                    ] as const).map(({ key, value, setter, label }) => (
                        <div key={key} className="flex items-center gap-4 px-5 py-4">
                            <p className="text-sm font-medium text-zinc-300 w-24 shrink-0">{label}</p>
                            <div className="flex gap-1.5 flex-1">
                                {(["compact", "normal", "large"] as const).map((size) => (
                                    <button
                                        key={size}
                                        onClick={() => setter(size)}
                                        className={cn(
                                            "flex-1 py-2 rounded-lg border text-xs font-medium capitalize transition-all",
                                            value === size
                                                ? "text-zinc-100 border-zinc-600"
                                                : "border-zinc-700 bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                                        )}
                                        style={value === size ? { borderColor: activeAccent.hex, background: activeAccent.hex + "18", color: activeAccent.hex } : {}}
                                    >
                                        {size === "compact" ? "S" : size === "normal" ? "M" : "L"}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ANIMATION SPEED */}
            <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5" /> Animation Speed
                </p>
                <div className="flex gap-2">
                    {(["off", "slow", "normal", "fast"] as const).map((opt) => {
                        const emoji = { off: "🚫", slow: "🐢", normal: "⚡", fast: "🚀" }[opt];
                        return (
                            <button
                                key={opt}
                                onClick={() => setAnimSpeed(opt)}
                                className={cn(
                                    "flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all capitalize",
                                    animSpeed === opt
                                        ? "border-zinc-700"
                                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                                )}
                                style={animSpeed === opt ? accentBg : {}}
                            >
                                <span className="text-xl">{emoji}</span>
                                <span className="text-[10px] text-zinc-500 font-medium">{opt}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* GRID & LAYOUT — toggles elegantes */}
            <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <Grid3X3 className="h-3.5 w-3.5" /> Grid and Layout
                </p>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden divide-y divide-zinc-800">
                    <div className="flex items-center gap-4 px-5 py-4">
                        <div className="flex-1">
                            <p className="text-sm font-medium text-zinc-200">Default View Mode</p>
                            <p className="text-[10px] text-zinc-600 mt-0.5">Grid or list</p>
                        </div>
                        <div className="flex gap-1.5">
                            {(["grid", "list"] as const).map((v) => (
                                <button
                                    key={v}
                                    onClick={() => setDefaultView(v)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-all",
                                        defaultView === v
                                            ? "border-zinc-700"
                                            : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                                    )}
                                    style={defaultView === v ? { ...accentBg, ...accentText } : {}}
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-4 px-5 py-4">
                        <div className="flex-1">
                            <p className="text-sm font-medium text-zinc-200">Show tags on grid</p>
                            <p className="text-[10px] text-zinc-600 mt-0.5">Show the tag badges on the grid</p>
                        </div>
                        <Toggle value={showTagsInGrid} onChange={setShowTagsInGrid} />
                    </div>
                    <div className="flex items-center gap-4 px-5 py-4">
                        <div className="flex-1">
                            <p className="text-sm font-medium text-zinc-200">Show type mockup icons</p>
                            <p className="text-[10px] text-zinc-600 mt-0.5">Avatar/outfit/accessories on cards in case the images don't load</p>
                        </div>
                        <Toggle value={showTypeIcons} onChange={setShowTypeIcons} />
                    </div>
                </div>
            </div>
        </div>
    );
}