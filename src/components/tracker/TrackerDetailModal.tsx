import React, { useEffect, useState } from "react";
import {
  X, ExternalLink, TrendingDown, Clock, Package, BarChart2,
  Loader2, Zap, AlertTriangle, Activity
} from "lucide-react";
import { useTrackerStore } from "@/store/trackerStore";
import type { TrackerItem, TrackerEvent } from "@/lib/tauri";

interface Props {
  item: TrackerItem;
  onClose: () => void;
}

interface PricePoint {
  date: string;
  fullDate: string;
  price: number; // siempre numérico
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

// ── PriceLineChart (mejorado para un solo punto) ─────────────────────────────

function PriceLineChart({ data }: { data: PricePoint[] }) {
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; point: PricePoint; index: number;
  } | null>(null);

  const W = 900;
  const H = 200;
  const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

  // Si solo hay un punto, crear un segundo punto duplicado para que la línea sea visible (opcional)
  const chartData = data.length === 1 ? [data[0], { ...data[0] }] : data;

  const prices = chartData.map((d) => d.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const padded = range * 0.1;

  const toX = (i: number) =>
    PAD.left + (i / Math.max(chartData.length - 1, 1)) * (W - PAD.left - PAD.right);
  const toY = (p: number) =>
    PAD.top + (1 - (p - (minP - padded)) / (range + padded * 2)) * (H - PAD.top - PAD.bottom);

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

  const coords: [number, number][] = chartData.map((d, i) => [toX(i), toY(d.price)]);
  const linePath = smoothPath(coords);

  const areaPath =
    linePath +
    ` L ${toX(chartData.length - 1)},${H - PAD.bottom} L ${toX(0)},${H - PAD.bottom} Z`;

  const yTicks = [minP, minP + range / 3, minP + (range * 2) / 3, maxP];

  const isFalling = chartData[chartData.length - 1].price <= chartData[0].price;
  const lineColor = isFalling ? "#34d399" : "#f87171";
  const gradId = `pGrad_${Math.random().toString(36).slice(2, 7)}`;

  return (
    <div className="relative rounded-xl border border-zinc-800/60 bg-zinc-900/10 overflow-hidden">
      {data.length === 1 && (
        <div className="absolute top-2 left-4 text-[9px] text-amber-400/80 z-10">
          Only one price point recorded – more scans needed for a line.
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 240 }}
        onMouseLeave={() => setTooltip(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
          <clipPath id="chartClip">
            <rect x={PAD.left} y={PAD.top} width={W - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom} />
          </clipPath>
        </defs>

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

        {chartData.map((d, i) => (
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
        ))}

        <path d={areaPath} fill={`url(#${gradId})`} clipPath="url(#chartClip)" />
        <path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {chartData.map((d, i) => (
          <g key={i}>
            <circle
              cx={toX(i)}
              cy={toY(d.price)}
              r={i === tooltip?.index ? 4.5 : 2.5}
              fill={i === tooltip?.index ? "#e4e4e7" : lineColor}
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
            const delta = tooltip.point.price - chartData[tooltip.index - 1].price;
            const pct = ((delta / chartData[tooltip.index - 1].price) * 100).toFixed(1);
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

// ── PriceFrequencyChart (versión compacta) ────────────────────────────────────

function PriceFrequencyChart({ events }: { events: TrackerEvent[] }) {
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
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/10 overflow-hidden px-3 pt-2 pb-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 60 }}>
        {sorted.map(([month, count], i) => {
          const barH = (count / maxCount) * (H - 16);
          const x = (W / sorted.length) * i + (W / sorted.length - barW) / 2;
          const label = month.slice(5);
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

// ── Main component ────────────────────────────────────────────────────────────

export function TrackerDetailModal({ item, onClose }: Props) {
  type Tab = "overview" | "chart" | "events";
  const [tab, setTab] = useState<Tab>("overview");
  const { events, loadEvents, runNow, scanning } = useTrackerStore();
  const [itemEvents, setItemEvents] = useState<TrackerEvent[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    loadEvents(item.id).then(() => {
      const evs = useTrackerStore.getState().events.filter(
        (e) => e.tracker_item_id === item.id
      );
      setItemEvents(evs);
      const unread = evs.filter((e) => !e.is_read).map((e) => e.id);
      if (unread.length > 0) markRead(unread);
    });
  }, [item.id]);

  const { markRead } = useTrackerStore();

  // Construir historial de precios siempre con al menos el precio actual
  const priceHistory: PricePoint[] = React.useMemo(() => {
    const events = itemEvents
      .filter((e) => e.event_type === "price_drop" || e.event_type === "price_change")
      .map((e) => {
        const price = parsePriceFromEvent(e) ?? 0;
        return {
          date: formatDate(e.detected_at),
          fullDate: formatDateTime(e.detected_at),
          price,
        };
      })
      .reverse();

    // Agregar precio actual si existe y no está ya
    if (item.last_known_price) {
      const current = parseFloat(item.last_known_price.replace(/[^0-9.]/g, ""));
      if (!isNaN(current)) {
        const lastEventPrice =
          events.length > 0 ? events[events.length - 1].price : null;
        if (lastEventPrice !== current) {
          events.push({ date: "Now", fullDate: "Current price", price: current });
        }
      }
    }
    return events;
  }, [itemEvents, item.last_known_price]);

  const dropCount = itemEvents.filter((e) => e.event_type === "price_drop").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[min(92vw,1000px)] max-h-[88vh] flex flex-col rounded-2xl bg-zinc-950 border border-zinc-800 overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-start gap-4 p-5 border-b border-zinc-800/80 shrink-0 bg-zinc-950/80 backdrop-blur-sm">
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
          <button
            onClick={async () => {
              try {
                setScanError(null);
                await runNow(item.id);
                await loadEvents(item.id);
                const evs = useTrackerStore.getState().events.filter(
                  (e) => e.tracker_item_id === item.id
                );
                setItemEvents(evs);
              } catch (e) {
                setScanError(String(e));
              }
            }}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white transition-colors disabled:opacity-50"
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {scanning ? "Scanning…" : "Run now"}
          </button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {scanError && (
          <div className="flex items-start gap-2 mx-5 mt-3 rounded-lg bg-red-950/30 border border-red-900/50 px-3 py-2 text-xs text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
            {scanError}
          </div>
        )}

        {/* ── Tab Bar ── */}
        <div className="flex items-center gap-1 px-5 pb-0 border-b border-zinc-800/80 bg-zinc-950/50">
          {([
            { id: "overview", label: "Overview", icon: Activity },
            { id: "chart", label: "Price Chart", icon: BarChart2 },
            { id: "events", label: "Events", icon: Clock },
          ] as { id: Tab; label: string; icon: React.ElementType }[]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-all -mb-px ${
                tab === t.id
                  ? "border-red-500 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div className="flex-1 overflow-y-auto">
          {tab === "overview" && (
            <div className="grid grid-cols-5 gap-px bg-zinc-800/60 border-b border-zinc-800/60">
              {[
                {
                  label: "Lowest",
                  value: priceHistory.length > 0
                    ? `¥${Math.min(...priceHistory.map(p => p.price)).toLocaleString()}`
                    : "—",
                  sub: "All-time low",
                  color: "text-emerald-400",
                },
                {
                  label: "Highest",
                  value: priceHistory.length > 0
                    ? `¥${Math.max(...priceHistory.map(p => p.price)).toLocaleString()}`
                    : "—",
                  sub: "All-time high",
                  color: "text-zinc-300",
                },
                {
                  label: "Drops",
                  value: String(dropCount),
                  sub: `of ${itemEvents.length} events`,
                  color: "text-violet-400",
                },
                {
                  label: "Interval",
                  value: item.check_interval_minutes >= 60
                    ? `${item.check_interval_minutes / 60}h`
                    : `${item.check_interval_minutes}m`,
                  sub: "Polling rate",
                  color: "text-zinc-300",
                },
                {
                  label: "Last checked",
                  value: item.last_checked_at
                    ? new Date(item.last_checked_at).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Never",
                  sub: "Most recent poll",
                  color: "text-zinc-400",
                },
              ].map((stat) => (
                <div key={stat.label} className="flex flex-col px-4 py-3 bg-zinc-950">
                  <p className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold">
                    {stat.label}
                  </p>
                  <p className={`text-lg font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
                  <p className="text-[9px] text-zinc-700 mt-0.5">{stat.sub}</p>
                </div>
              ))}
            </div>
          )}

          {tab === "chart" && (
            <div className="p-5 flex flex-col gap-5">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-2">
                  Price History
                </p>
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
              {priceHistory.length > 0 && (
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-2">
                    Change Frequency
                  </p>
                  <PriceFrequencyChart events={itemEvents.filter(e => e.event_type === 'price_change' || e.event_type === 'price_drop')} />
                </div>
              )}
            </div>
          )}

          {tab === "events" && (
            <div className="p-5 flex flex-col gap-2">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">
                Event Log ({itemEvents.length})
              </p>
              {itemEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                  <div className="p-3 rounded-full bg-zinc-900 border border-zinc-800">
                    <Clock className="w-5 h-5 text-zinc-600" />
                  </div>
                  <p className="text-sm text-zinc-400 font-medium">No events yet</p>
                  <p className="text-xs text-zinc-600">
                    Click <strong className="text-zinc-500">Run now</strong> to fetch initial data.
                  </p>
                </div>
              ) : (
                itemEvents.map((ev) => {
                  const payload = JSON.parse(ev.payload);
                  return (
                    <div
                      key={ev.id}
                      className="flex items-start gap-3 p-3 rounded-xl border border-zinc-800/60 bg-zinc-800/20 hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className={`w-2 h-2 mt-1.5 rounded-full ${EVENT_DOT_COLORS[ev.event_type]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${EVENT_COLORS[ev.event_type]}`}>
                            {EVENT_LABELS[ev.event_type]}
                          </span>
                          <span className="text-[10px] text-zinc-600">{formatDateTime(ev.detected_at)}</span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {ev.event_type === "price_change" || ev.event_type === "price_drop"
                            ? `Price: ¥${payload.new_price ?? "unknown"}`
                            : ev.event_type === "new_item"
                              ? `New item: ${payload.name ?? ""}`
                              : payload.reason || JSON.stringify(payload)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}