/**
 * AppearanceSection — configuración de personalización visual.
 */
import { Palette, Monitor, Grid3X3, LayoutGrid } from "lucide-react";
import { useAppearanceStore, ItemSize, UiScale } from "@/store/appearanceStore";

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** Reutilizar los helpers de Settings.tsx (SettingsCard, CardRow, SectionHeader) */
// Importar desde Settings si se extraen a un módulo shared, o replicar inline:
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
  { value: "compact", label: "Compact",  desc: "More items visible, smaller thumbnails" },
  { value: "normal",  label: "Normal",   desc: "Default size" },
  { value: "large",   label: "Large",    desc: "Bigger cards, easier to browse" },
];

const SCALE_OPTIONS: { value: UiScale; label: string }[] = [
  { value: 0.8,  label: "80%" },
  { value: 0.9,  label: "90%" },
  { value: 1.0,  label: "100%" },
  { value: 1.1,  label: "110%" },
  { value: 1.2,  label: "120%" },
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
  } = useAppearanceStore();

  return (
    <>
      {/* SectionHeader — reutilizar de Settings.tsx o replicar inline */}
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

        {/* Futuras opciones — placeholder visual */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Grid3X3 className="h-3.5 w-3.5" /> Coming Soon
          </p>
          <SettingsCard>
            {[
              { label: "Sidebar width",     desc: "Narrow / Normal / Wide" },
              { label: "Font size",         desc: "Small / Normal / Large" },
              { label: "Animation speed",   desc: "Reduced / Normal / Fast" },
              { label: "Accent color",      desc: "Red (default) / Custom" },
            ].map((item, i, arr) => (
              <CardRow key={item.label} last={i === arr.length - 1}>
                <div className="flex items-center justify-between opacity-40 select-none">
                  <div>
                    <p className="text-sm text-zinc-300">{item.label}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">{item.desc}</p>
                  </div>
                  <span className="text-[9px] font-semibold uppercase tracking-wider bg-zinc-800 border border-zinc-700 text-zinc-600 px-1.5 py-0.5 rounded">
                    soon
                  </span>
                </div>
              </CardRow>
            ))}
          </SettingsCard>
        </div>

      </div>
    </>
  );
}