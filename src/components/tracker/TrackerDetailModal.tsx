// src/components/tracker/TrackerDetailModal.tsx
import { useEffect, useState } from "react";
import { X, ExternalLink, TrendingDown, TrendingUp, Clock, Package, BarChart2, Minus } from "lucide-react";
import { useTrackerStore } from "@/store/trackerStore";
import type { TrackerItem, TrackerEvent } from "@/lib/tauri";

interface Props {
  item: TrackerItem;
  onClose: () => void;
}

interface PricePoint {
  date: string;
  fullDate: string;
  price: number;
}

function parsePriceFromEvent(ev: TrackerEvent): number | null {
  try {
    const payload = JSON.parse(ev.payload);
    const raw: string | number = payload.new_price ?? payload.price ?? payload.amount ?? "";
    if (typeof raw === "number") return raw;
    const num = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const EVENT_LABELS: Record<TrackerEvent["event_type"], string> = {
  price_drop: "Price drop",
  price_change: "Price change",
  back_in_stock: "Back in stock",
  new_item: "New item",
};

const EVENT_COLORS: Record<TrackerEvent["event_type"], string> = {
  price_drop: "text-emerald-400",
  price_change: "text-amber-400",
  back_in_stock: "text-blue-400",
  new_item: "text-violet-400",
};

const EVENT_DOT_COLORS: Record<TrackerEvent["event_type"], string> = {
  price_drop: "bg-emerald-500",
  price_change: "bg-amber-500",
  back_in_stock: "bg-blue-500",
  new_item: "bg-violet-500",
};

export function TrackerDetailModal({ item, onClose }: Props) {
  const { events, loadEvents, markRead } = useTrackerStore();
  const [itemEvents, setItemEvents] = useState<TrackerEvent[]>([]);

  useEffect(() => {
    loadEvents(item.id).then(() => {
      const evs = useTrackerStore.getState().events.filter((e) => e.tracker_item_id === item.id);
      setItemEvents(evs);
      const unread = evs.filter((e) => !e.is_read).map((e) => e.id);
      if (unread.length > 0) markRead(unread);
    });
  }, [item.id]);

  const priceHistory: PricePoint[] = itemEvents
    .filter((e) => e.event_type === "price_drop" || e.event_type === "price_change")
    .map((e) => ({
      date: formatDate(e.detected_at),
      fullDate: formatDateTime(e.detected_at),
      price: parsePriceFromEvent(e) ?? 0,
    }))
    .filter((p) => p.price > 0)
    .reverse();

  if (item.last_known_price) {
    const current = parseFloat(item.last_known_price.replace(/[^0-9.]/g, ""));
    if (!isNaN(current)) priceHistory.push({ date: "Now", fullDate: "Current price", price: current });
  }

  const minPrice = priceHistory.length > 0 ? Math.min(...priceHistory.map((p) => p.price)) : 0;
  const maxPrice = priceHistory.length > 0 ? Math.max(...priceHistory.map((p) => p.price)) : 0;
  const firstPrice = priceHistory.length > 0 ? priceHistory[0].price : 0;
  const lastPrice = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1].price : 0;
  const priceDelta = lastPrice - firstPrice;
  const priceDeltaPct = firstPrice > 0 ? ((priceDelta / firstPrice) * 100).toFixed(1) : null;

  const dropCount = itemEvents.filter((e) => e.event_type === "price_drop").length;
  const priceDropEvents = itemEvents.filter((e) => e.event_type === "price_drop" || e.event_type === "price_change");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[720px] max-h-[90vh] flex flex-col rounded-2xl bg-zinc-950 border border-zinc-800 overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-4 p-5 border-b border-zinc-800/80 shrink-0">
          {item.item_thumbnail_url ? (
            <img
              src={item.item_thumbnail_url}
              alt=""
              className="w-16 h-16 rounded-xl object-cover border border-zinc-800 shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <Package className="w-7 h-7 text-zinc-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-zinc-100 truncate">
              {item.item_name ?? item.author_name ?? "Tracked item"}
            </h2>
            {item.item_author && <p className="text-sm text-zinc-500 mt-0.5">{item.item_author}</p>}

            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {item.last_known_price && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-sm font-semibold text-emerald-400">
                  <TrendingDown className="w-3.5 h-3.5" />
                  {item.last_known_price}
                </span>
              )}
              {priceDeltaPct && (
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${priceDelta < 0 ? "text-emerald-500" : priceDelta > 0 ? "text-red-400" : "text-zinc-500"}`}>
                  {priceDelta < 0 ? <TrendingDown className="w-3 h-3" /> : priceDelta > 0 ? <TrendingUp className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                  {priceDelta < 0 ? "" : "+"}{priceDeltaPct}% since tracking
                </span>
              )}
              {item.item_url && (
                <a
                  href={item.item_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-violet-400 transition-colors ml-auto"
                >
                  <ExternalLink className="w-3 h-3" /> View on Booth
                </a>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ── Summary stats ──────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-px bg-zinc-800/60 border-b border-zinc-800/60">
            {[
              {
                label: "Lowest price",
                value: minPrice > 0 ? `¥${minPrice.toLocaleString()}` : "—",
                sub: "All-time low",
                color: "text-emerald-400",
              },
              {
                label: "Highest price",
                value: maxPrice > 0 ? `¥${maxPrice.toLocaleString()}` : "—",
                sub: "All-time high",
                color: "text-zinc-300",
              },
              {
                label: "Price drops",
                value: String(dropCount),
                sub: `of ${itemEvents.length} events`,
                color: "text-violet-400",
              },
              {
                label: "Check interval",
                value: item.check_interval_minutes >= 60 ? `${item.check_interval_minutes / 60}h` : `${item.check_interval_minutes}m`,
                sub: "Polling rate",
                color: "text-zinc-300",
              },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col px-4 py-3 bg-zinc-950">
                <p className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold">{stat.label}</p>
                <p className={`text-lg font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
                <p className="text-[9px] text-zinc-700 mt-0.5">{stat.sub}</p>
              </div>
            ))}
          </div>

          {/* ── Price chart ────────────────────────────────────────────── */}
          <div className="px-5 pt-5 pb-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold flex items-center gap-1.5">
                <BarChart2 className="w-3 h-3" /> Price History
              </p>
              {priceHistory.length >= 2 && (
                <p className="text-[9px] text-zinc-700">{priceHistory.length} data points</p>
              )}
            </div>
            {priceHistory.length < 2 ? (
              <div className="h-36 flex flex-col items-center justify-center gap-2 rounded-xl border border-zinc-900 bg-zinc-900/20">
                <BarChart2 className="w-6 h-6 text-zinc-800" />
                <p className="text-xs text-zinc-700">Not enough price events to render a chart yet.</p>
                <p className="text-[9px] text-zinc-800">Price change events will appear here over time.</p>
              </div>
            ) : (
              <PriceLineChart data={priceHistory} />
            )}
          </div>

          {/* ── Volume bar chart — price change frequency ───────────────── */}
          {priceDropEvents.length > 0 && (
            <div className="px-5 pb-4">
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold mb-2">
                Change Frequency
              </p>
              <PriceFrequencyChart events={priceDropEvents} />
            </div>
          )}

          {/* ── Events timeline ────────────────────────────────────────── */}
          <div className="px-5 pb-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Event History
              </p>
              <p className="text-[9px] text-zinc-700">{itemEvents.length} total</p>
            </div>
            {itemEvents.length === 0 ? (
              <p className="text-xs text-zinc-700 italic py-4 text-center">No events recorded yet — check back later.</p>
            ) : (
              <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
                {itemEvents.map((ev) => {
                  let detail = "";
                  try {
                    const p = JSON.parse(ev.payload);
                    if (p.old_price && p.new_price) detail = `${p.old_price} → ${p.new_price}`;
                    else if (p.item_name) detail = p.item_name;
                  } catch {}
                  return (
                    <div
                      key={ev.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                        ev.is_read
                          ? "border border-transparent hover:bg-zinc-900/30"
                          : "border border-zinc-800/60 bg-zinc-900/30"
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${ev.is_read ? "bg-zinc-800" : EVENT_DOT_COLORS[ev.event_type]}`} />
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className={`text-[11px] font-medium ${EVENT_COLORS[ev.event_type]}`}>
                          {EVENT_LABELS[ev.event_type]}
                        </span>
                        {detail && (
                          <span className="text-[10px] text-zinc-500 font-mono truncate">{detail}</span>
                        )}
                      </div>
                      <p className="text-[9px] text-zinc-700 shrink-0">{formatDateTime(ev.detected_at)}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PriceLineChart — SVG, no external deps, enhanced design
// ─────────────────────────────────────────────────────────────────────────────
interface PriceLineChartProps {
  data: PricePoint[];
}

function PriceLineChart({ data }: PriceLineChartProps) {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    point: PricePoint;
    index: number;
  } | null>(null);

  const W = 620;
  const H = 150;
  const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

  const prices = data.map((d) => d.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  // Add 10% padding top/bottom
  const padded = range * 0.1;

  const toX = (i: number) =>
    PAD.left + (i / Math.max(data.length - 1, 1)) * (W - PAD.left - PAD.right);
  const toY = (p: number) =>
    PAD.top + (1 - (p - (minP - padded)) / (range + padded * 2)) * (H - PAD.top - PAD.bottom);

  // Smooth cubic bezier path
  function smoothPath(pts: [number, number][]): string {
    if (pts.length < 2) return `M ${pts[0][0]},${pts[0][1]}`;
    let d = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cpX = (prev[0] + curr[0]) / 2;
      d += ` C ${cpX},${prev[1]} ${cpX},${curr[1]} ${curr[0]},${curr[1]}`;
    }
    return d;
  }

  const coords: [number, number][] = data.map((d, i) => [toX(i), toY(d.price)]);
  const linePath = smoothPath(coords);

  const areaPath =
    linePath +
    ` L ${toX(data.length - 1)},${H - PAD.bottom} L ${toX(0)},${H - PAD.bottom} Z`;

  // Y-axis ticks (4 levels)
  const yTicks = [minP, minP + range / 3, minP + (range * 2) / 3, maxP];

  // Whether price is currently below starting price (good for buyer)
  const isFalling = lastPrice(data) <= firstPrice(data);

  function lastPrice(d: PricePoint[]) { return d[d.length - 1].price; }
  function firstPrice(d: PricePoint[]) { return d[0].price; }

  const lineColor = isFalling ? "#34d399" : "#f87171"; // emerald if falling, red if rising
  const gradId = `pGrad_${Math.random().toString(36).slice(2, 7)}`;

  return (
    <div className="relative rounded-xl border border-zinc-800/60 bg-zinc-900/10 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 168 }}
        onMouseLeave={() => setTooltip(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
          {/* Clip area above the bottom */}
          <clipPath id="chartClip">
            <rect x={PAD.left} y={PAD.top} width={W - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom} />
          </clipPath>
        </defs>

        {/* Grid lines */}
        {yTicks.map((tick, i) => (
          <line
            key={i}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={toY(tick)}
            y2={toY(tick)}
            stroke="#27272a"
            strokeDasharray="3 5"
            strokeWidth={0.8}
          />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((tick, i) => (
          <text
            key={i}
            x={PAD.left - 6}
            y={toY(tick) + 3.5}
            fill="#3f3f46"
            fontSize={8}
            textAnchor="end"
            fontFamily="monospace"
          >
            ¥{tick >= 1000 ? `${(tick / 1000).toFixed(1)}k` : tick.toLocaleString()}
          </text>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) => {
          if (data.length > 8 && i !== 0 && i !== data.length - 1 && i % Math.ceil(data.length / 6) !== 0) return null;
          return (
            <text
              key={i}
              x={toX(i)}
              y={H - 6}
              fill="#3f3f46"
              fontSize={8}
              textAnchor="middle"
            >
              {d.date}
            </text>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradId})`} clipPath="url(#chartClip)" />

        {/* Main line */}
        <path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data point dots + hover zones */}
        {data.map((d, i) => (
          <g key={i}>
            <circle
              cx={toX(i)}
              cy={toY(d.price)}
              r={tooltip?.index === i ? 4.5 : 2.5}
              fill={tooltip?.index === i ? "#e4e4e7" : lineColor}
              style={{ transition: "r 0.1s" }}
            />
            <rect
              x={toX(i) - 18}
              y={PAD.top}
              width={36}
              height={H - PAD.top - PAD.bottom}
              fill="transparent"
              onMouseEnter={(e) => {
                const svgEl = (e.target as SVGElement).closest("svg")!;
                const rect = svgEl.getBoundingClientRect();
                const scaleX = rect.width / W;
                const scaleY = rect.height / H;
                setTooltip({ x: toX(i) * scaleX, y: toY(d.price) * scaleY, point: d, index: i });
              }}
            />
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-zinc-700 bg-zinc-950/95 backdrop-blur-sm px-3 py-2 text-[10px] shadow-xl"
          style={{
            left: Math.min(tooltip.x + 10, (620 * (tooltip.x / 620)) - 10),
            top: Math.max(tooltip.y - 44, 4),
          }}
        >
          <p className="text-zinc-200 font-mono font-semibold">¥{tooltip.point.price.toLocaleString()}</p>
          <p className="text-zinc-500 mt-0.5">{tooltip.point.fullDate}</p>
          {tooltip.index > 0 && (() => {
            const delta = tooltip.point.price - data[tooltip.index - 1].price;
            const pct = ((delta / data[tooltip.index - 1].price) * 100).toFixed(1);
            return (
              <p className={`mt-0.5 font-medium ${delta < 0 ? "text-emerald-400" : "text-red-400"}`}>
                {delta < 0 ? "▼" : "▲"} {Math.abs(delta).toLocaleString()} ({delta > 0 ? "+" : ""}{pct}%)
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PriceFrequencyChart — monthly bar chart of price change events
// ─────────────────────────────────────────────────────────────────────────────
function PriceFrequencyChart({ events }: { events: TrackerEvent[] }) {
  // Group by month
  const counts = new Map<string, number>();
  for (const ev of events) {
    const d = new Date(ev.detected_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (sorted.length === 0) return null;

  const maxCount = Math.max(...sorted.map(([, c]) => c));
  const W = 620;
  const H = 48;
  const barW = Math.min(28, (W / sorted.length) - 4);

  return (
    <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 overflow-hidden px-3 pt-2 pb-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 60 }}>
        {sorted.map(([month, count], i) => {
          const barH = (count / maxCount) * (H - 16);
          const x = (W / sorted.length) * i + (W / sorted.length - barW) / 2;
          const label = month.slice(5); // "MM"
          return (
            <g key={month}>
              <rect
                x={x}
                y={H - 14 - barH}
                width={barW}
                height={barH}
                rx={3}
                fill="#6d28d9"
                opacity={0.6 + (count / maxCount) * 0.4}
              />
              <text x={x + barW / 2} y={H - 2} fill="#3f3f46" fontSize={7} textAnchor="middle">
                {label}
              </text>
              <text x={x + barW / 2} y={H - 14 - barH - 3} fill="#52525b" fontSize={7} textAnchor="middle">
                {count > 1 ? count : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}