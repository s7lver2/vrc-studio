import React, { useEffect, useState } from "react";
import {
  ExternalLink, TrendingDown, Clock, Package, BarChart2,
  Loader2, Zap, AlertTriangle, Activity, Info, Settings2,
  ChevronLeft, Play, Pause, Trash2, Bell, BellOff
} from "lucide-react";
import { useTrackerStore } from "@/store/trackerStore";
import {
  tauriGetBoothProductDetail, type TrackerItem, type TrackerEvent,
  type BoothProductDetail
} from "@/lib/tauri";

// ── reutilizar helpers de precio del modal antiguo ────────────────────────────

function parsePriceFromEvent(ev: TrackerEvent): number | null {
  try {
    const payload = JSON.parse(ev.payload);
    const raw: string | number = payload.new_price ?? payload.price ?? payload.amount ?? "";
    if (typeof raw === "number") return raw;
    const num = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
    return isNaN(num) ? null : num;
  } catch { return null; }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const EVENT_LABELS: Record<string, string> = {
  price_drop: "Price drop",
  price_change: "Price change",
  back_in_stock: "Back in stock",
  new_item: "New item",
};

const EVENT_DOT: Record<string, string> = {
  price_drop: "bg-emerald-500",
  price_change: "bg-amber-500",
  back_in_stock: "bg-blue-500",
  new_item: "bg-violet-500",
};

const EVENT_TEXT: Record<string, string> = {
  price_drop: "text-emerald-400",
  price_change: "text-amber-400",
  back_in_stock: "text-blue-400",
  new_item: "text-violet-400",
};

// ── Galería de imágenes (igual que en ProductModal) ───────────────────────────

function Gallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [images[0]]);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-800/60 border border-white/5 group">
        {images[active] ? (
          <img key={images[active]} src={images[active]} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">No image</div>
        )}
        {images.length > 1 && (
          <>
            <button
              onClick={() => setActive((i) => (i - 1 + images.length) % images.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity text-lg"
            >‹</button>
            <button
              onClick={() => setActive((i) => (i + 1) % images.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity text-lg"
            >›</button>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${i === active ? "border-zinc-300 opacity-100" : "border-zinc-700 opacity-40 hover:opacity-70"}`}
            >
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PriceLineChart (copiado de TrackerDetailModal, sin cambios) ───────────────

interface PricePoint { date: string; fullDate: string; price: number; }

function PriceLineChart({ data }: { data: PricePoint[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; point: PricePoint; index: number } | null>(null);
  const W = 900; const H = 180;
  const PAD = { top: 12, right: 12, bottom: 28, left: 52 };
  const chartData = data.length === 1 ? [data[0], { ...data[0] }] : data;
  const prices = chartData.map((d) => d.price);
  const minP = Math.min(...prices); const maxP = Math.max(...prices);
  const range = maxP - minP || 1; const padded = range * 0.1;
  const toX = (i: number) => PAD.left + (i / Math.max(chartData.length - 1, 1)) * (W - PAD.left - PAD.right);
  const toY = (p: number) => PAD.top + (1 - (p - (minP - padded)) / (range + padded * 2)) * (H - PAD.top - PAD.bottom);
  function smoothPath(pts: [number, number][]): string {
    if (pts.length < 2) return `M ${pts[0][0]},${pts[0][1]}`;
    let d = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]; const curr = pts[i];
      const cpX = (prev[0] + curr[0]) / 2;
      d += ` C ${cpX},${prev[1]} ${cpX},${curr[1]} ${curr[0]},${curr[1]}`;
    }
    return d;
  }
  const coords: [number, number][] = chartData.map((d, i) => [toX(i), toY(d.price)]);
  const linePath = smoothPath(coords);
  const areaPath = linePath + ` L ${toX(chartData.length - 1)},${H - PAD.bottom} L ${toX(0)},${H - PAD.bottom} Z`;
  const yTicks = [minP, minP + range / 3, minP + (range * 2) / 3, maxP];
  const isFalling = chartData[chartData.length - 1].price <= chartData[0].price;
  const lineColor = isFalling ? "#34d399" : "#f87171";
  const gradId = `pGrad_${Math.random().toString(36).slice(2, 7)}`;
  return (
    <div className="relative rounded-xl border border-zinc-800/60 bg-zinc-900/10 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }} onMouseLeave={() => setTooltip(null)}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((tick, i) => (
          <line key={i} x1={PAD.left} x2={W - PAD.right} y1={toY(tick)} y2={toY(tick)} stroke="#27272a" strokeDasharray="3 5" strokeWidth={0.8} />
        ))}
        {yTicks.map((tick, i) => (
          <text key={i} x={PAD.left - 6} y={toY(tick) + 3.5} fill="#3f3f46" fontSize={8} textAnchor="end" fontFamily="monospace">
            ¥{tick >= 1000 ? `${(tick / 1000).toFixed(1)}k` : tick.toLocaleString()}
          </text>
        ))}
        {chartData.map((d, i) => (
          <text key={i} x={toX(i)} y={H - 6} fill="#3f3f46" fontSize={8} textAnchor="middle">{d.date}</text>
        ))}
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
        {chartData.map((d, i) => (
          <g key={i}>
            <circle cx={toX(i)} cy={toY(d.price)} r={i === tooltip?.index ? 4.5 : 2.5} fill={i === tooltip?.index ? "#e4e4e7" : lineColor} style={{ transition: "r 0.1s" }} />
            <rect x={toX(i) - 18} y={PAD.top} width={36} height={H - PAD.top - PAD.bottom} fill="transparent"
              onMouseEnter={(e) => {
                const svgEl = (e.target as SVGElement).closest("svg")!;
                const rect = svgEl.getBoundingClientRect();
                setTooltip({ x: toX(i) * (rect.width / W), y: toY(d.price) * (rect.height / H), point: d, index: i });
              }}
            />
          </g>
        ))}
      </svg>
      {tooltip && (
        <div className="pointer-events-none absolute z-10 rounded-lg border border-zinc-700 bg-zinc-950/95 backdrop-blur-sm px-3 py-2 text-[10px] shadow-xl"
          style={{ left: tooltip.x + 10, top: Math.max(tooltip.y - 44, 4) }}>
          <p className="text-zinc-200 font-mono font-semibold">¥{tooltip.point.price.toLocaleString()}</p>
          <p className="text-zinc-500 mt-0.5">{tooltip.point.fullDate}</p>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Tab = "info" | "chart" | "events" | "settings";

interface Props {
  item: TrackerItem;
  onBack: () => void;
}

export function TrackerDetailPanel({ item, onBack }: Props) {
  const [tab, setTab] = useState<Tab>("info");
  const { events, loadEvents, runNow, scanning, updateItem, deleteItem } = useTrackerStore();
  const [itemEvents, setItemEvents] = useState<TrackerEvent[]>([]);
  const [boothDetail, setBoothDetail] = useState<BoothProductDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const { markRead } = useTrackerStore();

  useEffect(() => {
    loadEvents(item.id).then(() => {
      const evs = useTrackerStore.getState().events.filter((e) => e.tracker_item_id === item.id);
      setItemEvents(evs);
      const unread = evs.filter((e) => !e.is_read).map((e) => e.id);
      if (unread.length > 0) markRead(unread);
    });

    // Cargar detalle de Booth si es un item con booth_id
    if (item.kind === "item" && item.booth_id) {
      setLoadingDetail(true);
      tauriGetBoothProductDetail(item.booth_id)
        .then(setBoothDetail)
        .catch(() => setBoothDetail(null))
        .finally(() => setLoadingDetail(false));
    }
  }, [item.id, item.booth_id]);

  const priceHistory: PricePoint[] = React.useMemo(() => {
    const pts = itemEvents
      .filter((e) => e.event_type === "price_drop" || e.event_type === "price_change")
      .map((e) => {
        const price = parsePriceFromEvent(e) ?? 0;
        const d = new Date(e.detected_at);
        return {
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          fullDate: formatDateTime(e.detected_at),
          price,
        };
      })
      .reverse();
    if (item.last_known_price) {
      const current = parseFloat(item.last_known_price.replace(/[^0-9.]/g, ""));
      if (!isNaN(current) && (pts.length === 0 || pts[pts.length - 1].price !== current)) {
        pts.push({ date: "Now", fullDate: "Current price", price: current });
      }
    }
    return pts;
  }, [itemEvents, item.last_known_price]);

  const dropCount = itemEvents.filter((e) => e.event_type === "price_drop").length;
  const title = item.item_name ?? item.author_name ?? item.search_keyword ?? "Tracked item";
  const thumbnail = item.item_thumbnail_url ?? boothDetail?.images?.[0] ?? null;

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "info",     label: "Info",       icon: Info },
    { id: "chart",    label: "Price",      icon: BarChart2 },
    { id: "events",   label: "Events",     icon: Clock },
    { id: "settings", label: "Settings",   icon: Settings2 },
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800/60">
        <div className="flex items-start gap-3 px-5 py-4">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors shrink-0 mt-0.5"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {thumbnail ? (
            <img src={thumbnail} className="w-12 h-12 rounded-xl object-cover border border-zinc-800 shrink-0" alt="" />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 text-zinc-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100 truncate">{title}</h2>
            {item.item_author && <p className="text-xs text-zinc-500 mt-0.5 truncate">{item.item_author}</p>}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {item.last_known_price && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs font-semibold text-emerald-400">
                  <TrendingDown className="w-3 h-3" />{item.last_known_price}
                </span>
              )}
              {item.item_url && (
                <a href={item.item_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-violet-400 transition-colors">
                  <ExternalLink className="w-2.5 h-2.5" /> Booth
                </a>
              )}
            </div>
          </div>
          <button
            onClick={async () => {
              try {
                setScanError(null);
                await runNow(item.id);
                const evs = useTrackerStore.getState().events.filter((e) => e.tracker_item_id === item.id);
                setItemEvents(evs);
              } catch (e) { setScanError(String(e)); }
            }}
            disabled={scanning}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white transition-colors disabled:opacity-50 shrink-0"
          >
            {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {scanning ? "…" : "Run"}
          </button>
        </div>

        {scanError && (
          <div className="flex items-start gap-2 mx-5 mb-3 rounded-lg bg-red-950/30 border border-red-900/50 px-3 py-2 text-xs text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />{scanError}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex items-center gap-0.5 px-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all -mb-px ${tab === t.id ? "border-red-500 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}
            >
              <t.icon className="h-3 w-3" />{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── INFO TAB ── */}
        {tab === "info" && (
          <div className="p-5 flex flex-col gap-5">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Lowest", value: priceHistory.length > 0 ? `¥${Math.min(...priceHistory.map(p => p.price)).toLocaleString()}` : "—", color: "text-emerald-400" },
                { label: "Drops", value: String(dropCount), color: "text-violet-400" },
                { label: "Checked", value: item.last_checked_at ? formatRelative(item.last_checked_at) : "Never", color: "text-zinc-300" },
              ].map((stat) => (
                <div key={stat.label} className="flex flex-col px-4 py-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40">
                  <p className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold">{stat.label}</p>
                  <p className={`text-base font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Image gallery (Booth detail) */}
            {item.kind === "item" && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-2">Gallery</p>
                {loadingDetail ? (
                  <div className="h-32 rounded-xl bg-zinc-800/40 animate-pulse" />
                ) : boothDetail?.images?.length ? (
                  <Gallery images={boothDetail.images} name={title} />
                ) : (
                  thumbnail ? (
                    <div className="aspect-video rounded-xl overflow-hidden bg-zinc-800 border border-zinc-800">
                      <img src={thumbnail} className="w-full h-full object-cover" alt="" />
                    </div>
                  ) : (
                    <div className="h-24 rounded-xl bg-zinc-900/40 border border-zinc-800 flex items-center justify-center">
                      <p className="text-xs text-zinc-600">No images available</p>
                    </div>
                  )
                )}
              </div>
            )}

            {/* Description */}
            {boothDetail?.description && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-2">Description</p>
                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/20 px-4 py-3">
                  <p className="text-xs text-zinc-400 leading-relaxed line-clamp-6 whitespace-pre-line">
                    {boothDetail.description}
                  </p>
                </div>
              </div>
            )}

            {/* Tags */}
            {boothDetail?.tags && boothDetail.tags.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {boothDetail.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-700/60 bg-zinc-800/60 text-zinc-400">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Keyword tracker info */}
            {item.kind === "keyword" && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 flex flex-col gap-1">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">Keyword search</p>
                <p className="text-sm font-medium text-violet-300 mt-1">"{item.search_keyword}"</p>
                {item.search_category && <p className="text-xs text-zinc-500">Category: {item.search_category}</p>}
                <p className="text-xs text-zinc-600 mt-1">Monitoring Booth for new items matching this query.</p>
              </div>
            )}
          </div>
        )}

        {/* ── CHART TAB ── */}
        {tab === "chart" && (
          <div className="p-5 flex flex-col gap-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">Price History</p>
            {priceHistory.length === 0 ? (
              <div className="h-36 flex items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900/20">
                <div className="text-center">
                  <BarChart2 className="w-6 h-6 text-zinc-800 mx-auto mb-1" />
                  <p className="text-xs text-zinc-700">No price data yet.</p>
                </div>
              </div>
            ) : (
              <PriceLineChart data={priceHistory} />
            )}
          </div>
        )}

        {/* ── EVENTS TAB ── */}
        {tab === "events" && (
          <div className="p-5 flex flex-col gap-2">
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">
              Event Log ({itemEvents.filter(e => e.event_type !== 'keyword_seen').length})
            </p>
            {itemEvents.filter(e => e.event_type !== 'keyword_seen').length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <div className="p-3 rounded-full bg-zinc-900 border border-zinc-800">
                  <Clock className="w-5 h-5 text-zinc-600" />
                </div>
                <p className="text-sm text-zinc-400 font-medium">No events yet</p>
                <p className="text-xs text-zinc-600">Click <strong className="text-zinc-500">Run</strong> to fetch initial data.</p>
              </div>
            ) : (
              itemEvents
                .filter(e => e.event_type !== 'keyword_seen')
                .map((ev) => {
                  let payload: Record<string, unknown> = {};
                  try { payload = JSON.parse(ev.payload); } catch { }
                  return (
                    <div key={ev.id} className="flex items-start gap-3 p-3 rounded-xl border border-zinc-800/60 bg-zinc-800/20 hover:bg-zinc-800/30 transition-colors">
                      <div className={`w-2 h-2 mt-1.5 rounded-full ${EVENT_DOT[ev.event_type] ?? "bg-zinc-500"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${EVENT_TEXT[ev.event_type] ?? "text-zinc-400"}`}>
                            {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                          </span>
                          <span className="text-[10px] text-zinc-600">{formatDateTime(ev.detected_at)}</span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">
                        {ev.event_type === "price_change" || ev.event_type === "price_drop"
                            ? `Price: ¥${payload.new_price ?? "unknown"}`
                            : ev.event_type === "new_item"
                            ? `Booth ID: ${payload.booth_id ?? payload.name ?? ""}`
                            : (typeof payload.reason === "string" ? payload.reason : JSON.stringify(payload))}
                        </p>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {tab === "settings" && (
          <div className="p-5 flex flex-col gap-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">Tracking settings</p>

            {/* Interval */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">Check interval</p>
                <p className="text-xs text-zinc-500 mt-0.5">How often to poll for updates</p>
              </div>
              <select
                value={item.check_interval_minutes}
                onChange={(e) => updateItem(item.id, { check_interval_minutes: Number(e.target.value) })}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                {[15, 30, 60, 180, 360, 720, 1440].map((v) => (
                  <option key={v} value={v}>{v >= 60 ? `${v / 60}h` : `${v}m`}</option>
                ))}
              </select>
            </div>

            {/* Toggles por kind */}
            {item.kind === "item" && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800">
                {[
                  { key: "track_price_drops" as const, label: "Track price changes" },
                  { key: "track_availability" as const, label: "Track availability" },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
                    <span className="text-sm text-zinc-300">{label}</span>
                    <input
                      type="checkbox"
                      checked={item[key]}
                      onChange={(e) => updateItem(item.id, { [key]: e.target.checked })}
                      className="accent-violet-500 w-4 h-4"
                    />
                  </label>
                ))}
              </div>
            )}

            {item.kind === "author" && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900">
                <label className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
                  <span className="text-sm text-zinc-300">Track new items</span>
                  <input
                    type="checkbox"
                    checked={item.track_new_items}
                    onChange={(e) => updateItem(item.id, { track_new_items: e.target.checked })}
                    className="accent-violet-500 w-4 h-4"
                  />
                </label>
              </div>
            )}

            {/* Pause / Delete */}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => updateItem(item.id, { is_active: !item.is_active })}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-700 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {item.is_active ? <><Pause className="w-3.5 h-3.5" /> Pause</> : <><Play className="w-3.5 h-3.5" /> Resume</>}
              </button>
              <button
                onClick={() => { deleteItem(item.id); onBack(); }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-900/40 bg-red-950/20 text-sm text-red-400 hover:bg-red-950/40 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}