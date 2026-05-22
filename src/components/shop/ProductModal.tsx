import { useEffect, useRef, useState, useCallback } from "react";
import {
  X, ExternalLink, Download, Loader2, ShoppingCart,
  CheckCircle2, AlertCircle, Store,
  Link2, ScanSearch, ChevronRight, Package,
  Bell,
} from "lucide-react";
import { useShopStore } from "../../store/shopStore";
import { useInventoryStore } from "../../store/inventoryStore";
import { useAppStore } from "../../store/app";
import { useDownloadProgress } from "../../hooks/useDownloadProgress";
import { AddTrackerModal } from "@/components/tracker/AddTrackerModal";
import {
  ShopProduct, BoothProductDetail, DownloadLinkContext,
  tauriStartDownload, tauriGetBoothProductDetail, tauriRipperGetTopicDetail,
  tauriRipperScrapeDeep, tauriRipperSearch, tauriRipperIsAuthenticated,
  tauriRipperResolveHidelink, tauriDownloadDirectUrl, tauriBoothDownloadFreeItem,
} from "../../lib/tauri";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { useT } from "@/i18n";

// ── Gallery ────────────────────────────────────────────────────────────────────

function Gallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [images[0]]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-zinc-800/60 border border-white/5 group">
        {images[active] ? (
          <img key={images[active]} src={images[active]} alt={name} className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">No image</div>
        )}
        {images.length > 1 && (
          <>
            <button onClick={() => setActive(i => (i - 1 + images.length) % images.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity text-lg leading-none">
              ‹
            </button>
            <button onClick={() => setActive(i => (i + 1) % images.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity text-lg leading-none">
              ›
            </button>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button key={i} onClick={() => setActive(i)}
              className={["shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all",
                i === active ? "border-zinc-300 opacity-100" : "border-zinc-700 opacity-40 hover:opacity-70"].join(" ")}>
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GallerySkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-square rounded-xl bg-zinc-800 animate-pulse" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map(i => <div key={i} className="w-20 h-20 rounded-lg bg-zinc-800 animate-pulse shrink-0" />)}
      </div>
    </div>
  );
}

// ── Similar card ───────────────────────────────────────────────────────────────

function SimilarCard({ product, onClick }: { product: ShopProduct; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="group flex flex-col rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 bg-zinc-900/60 transition-all text-left">
      <div className="aspect-square overflow-hidden bg-zinc-800">
        {product.thumbnail_url
          ? <img src={product.thumbnail_url} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs">—</div>
        }
      </div>
      <div className="p-2 flex flex-col gap-0.5">
        <p className="text-[11px] font-medium text-zinc-200 leading-tight line-clamp-2">{product.name}</p>
        <p className="text-[10px] text-zinc-500 truncate">{product.author}</p>
        <p className="text-[10px] font-bold text-zinc-300 mt-0.5">{product.price_display}</p>
      </div>
    </button>
  );
}

// ── Download link extraction ───────────────────────────────────────────────────

interface ExtractedLink {
  url: string;
  label: string;
  icon: string;
}

// ── Download link validation ───────────────────────────────────────────────────
// Filtra los falsos positivos que devuelve el deep scrape:
// redes sociales, CDNs de imágenes, páginas de producto de Booth, iconos, etc.

const NEVER_DL_HOSTS = [
  "x.com", "twitter.com", "t.co", "fxtwitter.com",
  "pbs.twimg.com", "abs.twimg.com", "twimg.com",
  "booth.pm", "booth.pximg.net", "asset.booth.pm",
  "youtube.com", "youtu.be",
  "instagram.com", "tiktok.com",
  "discord.gg",
  "nicovideo.jp", "nico.ms",
  "sketchfab.com",
  "lit.link",
];
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|ico|svg|bmp|avif|tiff?)(\?|$)/i;

function isGoodDownloadLink(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    // Riperstore: solo los /hidelinks/r/ son links de descarga real
    if (host === "forum.ripper.store") return u.pathname.startsWith("/hidelinks/r/");
    // Resto del dominio ripper.store → nav del foro
    if (host === "ripper.store" || host.endsWith(".ripper.store")) return false;
    // Imágenes/iconos no son assets
    if (IMAGE_EXT_RE.test(u.pathname)) return false;
    // Redes sociales y CDNs
    if (NEVER_DL_HOSTS.some(h => host === h || host.endsWith("." + h))) return false;
    return true;
  } catch { return false; }
}

function labelLink(url: string): ExtractedLink {
  let label = "Direct Link";
  let icon  = "🔗";
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname.replace("www.", "");
    // Riperstore /hidelinks/r/... are redirect wrappers for real external DL links
    if (host.includes("ripper.store") && urlObj.pathname.startsWith("/hidelinks/r/")) {
      label = "Download Link"; icon = "🔗";
    } else if (host.includes("mega.nz") || host.includes("mega.co.nz")) { label = "Mega"; icon = "☁️"; }
    else if (host.includes("drive.google"))   { label = "Google Drive"; icon = "📁"; }
    else if (host.includes("dropbox"))        { label = "Dropbox";      icon = "📦"; }
    else if (host.includes("mediafire"))      { label = "MediaFire";    icon = "🔥"; }
    else if (host.includes("discord"))        { label = "Discord";      icon = "💬"; }
    else if (host.includes("github"))         { label = "GitHub";       icon = "🐙"; }
    else if (host.includes("pixeldrain") || host.includes("gofile") || host.includes("anonfiles")) {
      label = "File Host"; icon = "📂";
    }
    else if (host.includes("booth.pm"))       { label = "Booth.pm";     icon = "🛒"; }
    else if (host.includes("modular-avatar")) { label = "Modular Avatar"; icon = "🧩"; }
    else { label = host; }
  } catch { /* ignore */ }
  return { url, label, icon };
}

function extractDownloadLinks(text: string): ExtractedLink[] {
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
  const raw = [...new Set(text.match(urlRegex) ?? [])];

  return raw
    .filter(url => !url.includes("forum.ripper.store") && !url.includes("booth.pm"))
    .map(url => {
      let label = "Direct Link";
      let icon  = "🔗";
      try {
        const host = new URL(url).hostname.replace("www.", "");
        if (host.includes("mega.nz") || host.includes("mega.co.nz")) { label = "Mega"; icon = "☁️"; }
        else if (host.includes("drive.google"))   { label = "Google Drive"; icon = "📁"; }
        else if (host.includes("dropbox"))        { label = "Dropbox";      icon = "📦"; }
        else if (host.includes("mediafire"))      { label = "MediaFire";    icon = "🔥"; }
        else if (host.includes("discord"))        { label = "Discord";      icon = "💬"; }
        else if (host.includes("github"))         { label = "GitHub";       icon = "🐙"; }
        else if (host.includes("pixeldrain") || host.includes("gofile") || host.includes("anonfiles")) {
          label = "File Host"; icon = "📂";
        }
        else if (host.includes("booth.pm"))       { label = "Booth.pm";     icon = "🛒"; }
        else { label = host; }
      } catch { /* ignore */ }
      return { url, label, icon };
    });
}

// ── Hosts que admiten descarga directa (sin auth de terceros) ──────────────────
const DIRECT_DL_HOSTS = [
  "workupload.com", "pixeldrain.com", "gofile.io", "catbox.moe",
  "files.catbox.moe", "litterbox.catbox.moe", "filebin.net",
  "sendgb.com", "wetransfer.com", "anonfiles.com",
  "cdn.discordapp.com",
];

function canDownloadDirect(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return DIRECT_DL_HOSTS.some(h => host === h || host.endsWith("." + h));
  } catch { return false; }
}

// ── Riperstore download options sheet ─────────────────────────────────────────

interface RichLink {
  url: string;
  label: string;
  icon: string;
  password: string | null;
  avatars: string[];
}

interface DownloadSheetProps {
  /** Nombre del hilo de Riperstore (siempre el del hilo, nunca Booth). */
  threadName: string;
  /** URL del hilo de Riperstore. */
  threadUrl: string;
  p: ShopProduct;
  links: DownloadLinkContext[];
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}

function hostLabel(host: string): string {
  if (host.includes("workupload")) return "Workupload";
  if (host.includes("mega")) return "MEGA";
  if (host.includes("mediafire")) return "MediaFire";
  if (host.includes("pixeldrain")) return "Pixeldrain";
  if (host.includes("gofile")) return "GoFile";
  if (host.includes("catbox")) return "Catbox";
  if (host.includes("drive.google")) return "Google Drive";
  if (host.includes("onedrive") || host.includes("1drv")) return "OneDrive";
  if (host.includes("dropbox")) return "Dropbox";
  return host;
}

// Per-link download state
type LinkPhase =
  | { kind: "idle" }
  | { kind: "resolving"; progress: number }
  | { kind: "downloading"; progress: number }
  | { kind: "done" }
  | { kind: "error"; msg: string };

function DownloadSourceButton({
  link,
  productName,
  productAuthor,
  productThumb,
  sourceId,
  onOpenUrl,
}: {
  link: RichLink;
  productName: string;
  productAuthor: string;
  productThumb: string;
  sourceId: string;
  onOpenUrl: (url: string) => void;
}) {
  const [phase, setPhase] = useState<LinkPhase>({ kind: "idle" });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isHidelink = (url: string) =>
    url.includes("forum.ripper.store") && url.includes("/hidelinks/");

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const tryDirectDownload = async (url: string) => {
    if (!canDownloadDirect(url)) {
      // Browser fallback para hosts que requieren autenticación (Mega, GDrive, etc.)
      setPhase({ kind: "done" });
      onOpenUrl(url);
      return;
    }
    // Descarga interna vía Tauri
    let p = 0;
    timerRef.current = setInterval(() => {
      p = Math.min(p + 1.2, 88);
      setPhase({ kind: "downloading", progress: p });
    }, 100);
    try {
      await tauriDownloadDirectUrl({
        url,
        name: productName,
        author: productAuthor,
        thumbnail_url: productThumb,
        source_id: sourceId,
      });
      clearInterval(timerRef.current!);
      setPhase({ kind: "done" });
    } catch (e) {
      clearInterval(timerRef.current!);
      console.error("[direct download]", e);
      // Fallback al navegador
      setPhase({ kind: "done" });
      onOpenUrl(url);
    }
  };

  const handleClick = async () => {
    if (phase.kind === "resolving" || phase.kind === "downloading") return;

    if (!isHidelink(link.url)) {
      setPhase({ kind: "resolving", progress: 0 });
      await tryDirectDownload(link.url);
      return;
    }

    // Hidelink → resolve via WebView (bypasses Cloudflare) then download/open
    let p = 0;
    setPhase({ kind: "resolving", progress: 0 });
    timerRef.current = setInterval(() => {
      p = Math.min(p + 3.5, 88);
      setPhase({ kind: "resolving", progress: p });
    }, 80);

    try {
      const resolved = await tauriRipperResolveHidelink(link.url);
      clearInterval(timerRef.current!);
      setPhase({ kind: "resolving", progress: 100 });
      await new Promise(r => setTimeout(r, 200));
      await tryDirectDownload(resolved);
    } catch (e) {
      clearInterval(timerRef.current!);
      console.error("[hidelink resolve]", e);
      setPhase({ kind: "error", msg: "Error resolviendo — reintenta o abre manualmente" });
      setTimeout(() => {
        onOpenUrl(link.url);
        setPhase({ kind: "idle" });
      }, 2000);
    }
  };

  const isResolving   = phase.kind === "resolving";
  const isDownloading = phase.kind === "downloading";
  const isDone        = phase.kind === "done";
  const isError       = phase.kind === "error";
  const isBusy        = isResolving || isDownloading;
  const progress      = isResolving ? (phase as any).progress : isDownloading ? (phase as any).progress : 0;

  return (
    <div className="flex flex-col rounded-xl border border-zinc-700/60 hover:border-zinc-500 transition-all overflow-hidden bg-zinc-900/40">
      <button
        onClick={handleClick}
        disabled={isBusy}
        className="flex items-center gap-3 w-full px-4 py-3.5 hover:bg-zinc-800/50 transition-colors text-left group disabled:cursor-wait"
      >
        {/* Icon */}
        <div className={[
          "w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0 border transition-colors",
          isDone  ? "bg-emerald-500/15 border-emerald-500/30" :
          isError ? "bg-red-500/15 border-red-500/30" :
          "bg-zinc-800 border-zinc-700/60 group-hover:border-zinc-600",
        ].join(" ")}>
          {isBusy
            ? <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
            : isDone  ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            : isError ? "⚠️"
            : link.icon}
        </div>

        {/* Text + avatar tags */}
        <div className="min-w-0 flex-1">
          <p className={[
            "text-sm font-bold transition-colors",
            isDone  ? "text-emerald-400" :
            isError ? "text-red-400" :
            isResolving ? "text-blue-300" :
            isDownloading ? "text-violet-300" :
            "text-zinc-100 group-hover:text-white",
          ].join(" ")}>
            {isResolving   ? "Resolviendo enlace…"
              : isDownloading ? `Descargando… ${Math.round(progress)}%`
              : isDone        ? "¡Descargado!"
              : isError       ? "Error — reintentando…"
              : link.label}
          </p>
          {!isBusy && !isDone && !isError && (
            <p className="text-[10px] text-zinc-500 mt-0.5">
              {isHidelink(link.url) ? "Enlace protegido (se resuelve automáticamente)" : link.url}
            </p>
          )}
          {isError && (
            <p className="text-[10px] text-red-400/70 mt-0.5">{(phase as any).msg}</p>
          )}
          {/* Avatar tags */}
          {link.avatars.length > 0 && !isBusy && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {link.avatars.map(av => (
                <span key={av} className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/20 font-medium leading-none">
                  {av}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Chevron / download icon */}
        {!isBusy && (
          <div className={[
            "h-4 w-4 shrink-0 transition-colors",
            isDone ? "text-emerald-500" : "text-zinc-600 group-hover:text-zinc-400",
          ].join(" ")}>
            {isDone ? <CheckCircle2 className="h-4 w-4" /> : canDownloadDirect(link.url) || isHidelink(link.url)
              ? <Download className="h-4 w-4" />
              : <ExternalLink className="h-4 w-4" />}
          </div>
        )}
      </button>

      {/* Progress bar */}
      {(isBusy || isDone) && (
        <div className="h-1 w-full bg-zinc-800 relative overflow-hidden">
          <div
            className={[
              "absolute inset-y-0 left-0 transition-all duration-150 ease-out",
              isDone ? "bg-emerald-500" : isDownloading ? "bg-violet-500" : "bg-blue-500",
            ].join(" ")}
            style={{ width: `${isDone ? 100 : progress}%` }}
          />
          {isBusy && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_1.2s_infinite]" />
          )}
        </div>
      )}

      {/* Password row */}
      {link.password && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/30 border-t border-amber-500/20">
          <span className="text-[10px] text-amber-400/70 shrink-0">🔑 Contraseña</span>
          <code className="text-[11px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded select-all flex-1">
            {link.password}
          </code>
        </div>
      )}
    </div>
  );
}

function RiperstoreDownloadSheet({ threadName, threadUrl, p, links, onOpenUrl, onClose }: DownloadSheetProps) {
  // Merge DownloadEntry metadata (password, display_host) with DownloadLinkContext (url, avatars)
  const downloadsMap = new Map(
    (p.downloads ?? []).map((d) => [d.url, d])
  );

  const richLinks: RichLink[] = links.map((ctx) => {
    const base  = labelLink(ctx.url);
    const entry = downloadsMap.get(ctx.url);
    const label = entry?.display_host ? hostLabel(entry.display_host) : base.label;
    return { ...base, label, password: entry?.password ?? null, avatars: ctx.avatars };
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-zinc-400" />
          <p className="text-sm font-bold text-zinc-100">Fuentes de descarga</p>
        </div>
        <button onClick={onClose}
          className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Thread reference — always shows the Riperstore thread URL */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/40">
        <span className="text-[10px] text-zinc-500 shrink-0 mt-0.5">Hilo</span>
        <button
          onClick={() => onOpenUrl(threadUrl)}
          className="text-[11px] font-semibold text-zinc-300 hover:text-zinc-100 leading-tight text-left transition-colors line-clamp-2"
        >
          {threadName}
        </button>
      </div>

      {/* Source buttons */}
      {richLinks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 px-0.5">
            Pulsa una fuente para descargar ({richLinks.length})
          </p>
          <div className="flex flex-col gap-2">
            {richLinks.map((l, i) => (
              <DownloadSourceButton
                key={i}
                link={l}
                productName={p.name}
                productAuthor={p.author}
                productThumb={p.thumbnail_url}
                sourceId={p.source_id}
                onOpenUrl={onOpenUrl}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/40 text-xs text-zinc-500">
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          No se encontraron links. Abre el hilo directamente.
        </div>
      )}

      {/* Open thread fallback */}
      <button onClick={() => onOpenUrl(threadUrl)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-zinc-700/40 hover:border-zinc-600 hover:bg-zinc-800/40 transition-all text-left group">
        <span className="text-sm leading-none shrink-0">🗂️</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-zinc-400 group-hover:text-zinc-200 transition-colors">
            Abrir hilo en forum.ripper.store
          </p>
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-400 shrink-0 transition-colors" />
      </button>
    </div>
  );
}

// ── Scrape Ripper button ───────────────────────────────────────────────────────

interface ScrapeButtonProps {
  sourceId: string;
  cachedLinks: DownloadLinkContext[];
  onDone: (links: DownloadLinkContext[], threadName: string, threadUrl: string) => void;
  threadName: string;   // título del hilo de Riperstore
  threadUrl: string;    // URL para verificar manualmente
}

const SCRAPE_PAGES = 8;
const SCRAPE_MESSAGES = [
  "Escaneando página 1…",
  "Buscando en replies…",
  "Revisando páginas adicionales…",
  "Recolectando links…",
  "Filtrando resultados…",
  "Casi listo…",
];

function ScrapeRipperButton({ sourceId, cachedLinks, onDone, threadName, threadUrl }: ScrapeButtonProps) {
  const [scraping, setScraping] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [statusIdx, setStatusIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startScrape = async () => {
    setScraping(true);
    setProgress(0);
    setStatusIdx(0);

    // Simulated smooth progress (0 → 82%) while waiting for Rust
    let p = 0;
    timerRef.current = setInterval(() => {
      p = Math.min(p + 1.4, 82);
      setProgress(p);
      setStatusIdx(Math.floor((p / 82) * (SCRAPE_MESSAGES.length - 1)));
    }, 120);

    try {
      const deepLinks = await tauriRipperScrapeDeep(sourceId, SCRAPE_PAGES);
      // Merge cached (string[]) + deep (DownloadLinkContext[]); deduplicate by URL.
      const seen = new Set<string>();
      const all: DownloadLinkContext[] = [];
      for (const ctx of [...cachedLinks, ...deepLinks]) {
        if (!seen.has(ctx.url) && isGoodDownloadLink(ctx.url)) {
          seen.add(ctx.url);
          all.push(ctx);
        }
      }
      clearInterval(timerRef.current!);
      setProgress(100);
      setTimeout(() => onDone(all, threadName, threadUrl), 340);
    } catch (err) {
      console.error("[ScrapeRipper]", err);
      clearInterval(timerRef.current!);
      const fallback = cachedLinks.filter(ctx => isGoodDownloadLink(ctx.url));
      onDone(fallback, threadName, threadUrl);
    }
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  if (scraping) {
    return (
      <div className="flex flex-col gap-2 w-full">
        <div className="relative w-full h-10 rounded-lg overflow-hidden border border-blue-500/40 bg-blue-950/40">
          {/* animated fill */}
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-200 ease-out"
            style={{ width: `${progress}%` }}
          />
          {/* shimmer */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.6s_infinite]" />
          <div className="absolute inset-0 flex items-center justify-center gap-2">
            <Loader2 className="h-3.5 w-3.5 text-blue-200 animate-spin shrink-0" />
            <span className="text-xs font-semibold text-blue-100">
              {SCRAPE_MESSAGES[statusIdx]}
            </span>
            <span className="text-[10px] text-blue-300 font-mono">{Math.round(progress)}%</span>
          </div>
        </div>
        <p className="text-[10px] text-zinc-600 text-center">
          Revisando {SCRAPE_PAGES} páginas del hilo…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Thread preview — let user verify it's the right thread before scraping */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/40">
        <span className="text-[10px] text-zinc-500 shrink-0 mt-0.5">Hilo</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-zinc-300 leading-tight truncate">{threadName}</p>
          <button
            onClick={() => { try { openUrl(threadUrl); } catch { window.open(threadUrl, "_blank"); } }}
            className="text-[10px] text-blue-400/70 hover:text-blue-300 truncate block max-w-full text-left"
          >
            {threadUrl}
          </button>
        </div>
      </div>
      <button
        onClick={startScrape}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-bold transition-all text-white bg-blue-600 hover:bg-blue-500 active:scale-[0.98]"
      >
        <ScanSearch className="h-4 w-4" />
        Scrape Ripper
      </button>
    </div>
  );
}

// ── Deep-index button for Booth products not yet cross-listed in Riperstore ────
//
// Full one-click flow:
//   idle → click → "finding thread" → found → immediately scrapes → onDone(links)
//                                   → not found → error state + retry

interface DeepIndexButtonProps {
  boothId: string;
  boothName: string;
  boothAuthor?: string;
  supportedAvatars?: string[];
  cachedLinks: DownloadLinkContext[];
  onDone: (links: DownloadLinkContext[], threadName: string, threadUrl: string) => void;
}

type DeepIndexPhase =
  | { kind: "idle" }
  | { kind: "scanning"; message: string; progress: number; threadName?: string; threadUrl?: string }
  | { kind: "not_found" };

const DEEP_SCRAPE_PAGES = 8;

const DEEP_FIND_MESSAGES = [
  "Buscando por Booth ID…",
  "Probando términos del nombre…",
  "Buscando segmentos ASCII…",
  "Probando texto entre corchetes…",
  "Buscando por nombre del autor…",
  "Probando avatares compatibles…",
  "Últimas estrategias…",
];

function DeepIndexButton({ boothId, boothName, boothAuthor, supportedAvatars, cachedLinks, onDone }: DeepIndexButtonProps) {
  const [phase, setPhase] = useState<DeepIndexPhase>({ kind: "idle" });
  const [ripperAvail, setRipperAvail] = useState<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tauriRipperIsAuthenticated().then(setRipperAvail).catch(() => setRipperAvail(false));
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [boothId]);

  const handleDeepIndex = async () => {
    let p = 0;

    // ── Fase 1: Finding (0 → 34%) ──────────────────────────────────────────
    // La barra arranca desde el primer clic con mensajes de búsqueda,
    // igual que ScrapeRipperButton arranca desde su primer clic.
    setPhase({ kind: "scanning", message: DEEP_FIND_MESSAGES[0], progress: 0 });

    timerRef.current = setInterval(() => {
      p = Math.min(p + 0.7, 33);
      const idx = Math.min(
        Math.floor((p / 33) * DEEP_FIND_MESSAGES.length),
        DEEP_FIND_MESSAGES.length - 1,
      );
      setPhase(prev =>
        prev.kind === "scanning" && !prev.threadName
          ? { ...prev, progress: p, message: DEEP_FIND_MESSAGES[idx] }
          : prev,
      );
    }, 120);

    try {
      const hit = await searchRiperstoreWithFallbacks(boothId, boothName, boothAuthor, supportedAvatars);

      if (!hit) {
        clearInterval(timerRef.current!);
        setPhase({ kind: "not_found" });
        return;
      }

      // ── Fase 2: Scraping (35 → 100%) ───────────────────────────────────
      // Hilo encontrado — continúa la misma barra, ahora con mensajes de escaneo.
      clearInterval(timerRef.current!);
      p = 35;
      setPhase({
        kind: "scanning",
        message: SCRAPE_MESSAGES[0],
        progress: p,
        threadName: hit.name,
        threadUrl: hit.url,
      });

      timerRef.current = setInterval(() => {
        p = Math.min(p + 1.2, 82);
        const idx = Math.min(
          Math.floor(((p - 35) / 47) * SCRAPE_MESSAGES.length),
          SCRAPE_MESSAGES.length - 1,
        );
        setPhase(prev =>
          prev.kind === "scanning" ? { ...prev, progress: p, message: SCRAPE_MESSAGES[idx] } : prev,
        );
      }, 120);

      const deepLinks = await tauriRipperScrapeDeep(hit.source_id, DEEP_SCRAPE_PAGES);
      clearInterval(timerRef.current!);

      const seen = new Set<string>();
      const all: DownloadLinkContext[] = [];
      for (const ctx of [...cachedLinks, ...deepLinks]) {
        if (!seen.has(ctx.url) && isGoodDownloadLink(ctx.url)) {
          seen.add(ctx.url);
          all.push(ctx);
        }
      }

      setPhase(prev => prev.kind === "scanning" ? { ...prev, progress: 100, message: "¡Listo!" } : prev);
      setTimeout(() => onDone(all, hit.name, hit.url), 340);
    } catch (err) {
      console.error("[DeepIndex]", err);
      if (timerRef.current) clearInterval(timerRef.current!);
      setPhase({ kind: "not_found" });
    }
  };

  // ── render helpers ──────────────────────────────────────────────────────────

  if (ripperAvail === false) {
    return (
      <button
        disabled
        className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-bold text-zinc-600 bg-zinc-800/40 border border-zinc-700/30 cursor-not-allowed"
        title="Connect Riperstore in Settings to use Deep Index"
      >
        <ScanSearch className="h-4 w-4" />
        Deep Index
        <span className="text-[10px] font-normal text-zinc-600">(Riperstore needed)</span>
      </button>
    );
  }

  if (phase.kind === "idle" || ripperAvail === null) {
    return (
      <button
        onClick={handleDeepIndex}
        disabled={ripperAvail === null}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ScanSearch className="h-4 w-4" />
        Deep Index
      </button>
    );
  }

  if (phase.kind === "scanning") {
    const { message, progress, threadName, threadUrl } = phase;
    return (
      <div className="flex flex-col gap-2 w-full">
        {threadName && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/40">
            <span className="text-[10px] text-zinc-500 shrink-0 mt-0.5">Hilo</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-zinc-300 leading-tight truncate">{threadName}</p>
              {threadUrl && (
                <button
                  onClick={() => { try { openUrl(threadUrl); } catch { window.open(threadUrl, "_blank"); } }}
                  className="text-[10px] text-blue-400/70 hover:text-blue-300 truncate block max-w-full text-left"
                >
                  {threadUrl}
                </button>
              )}
            </div>
          </div>
        )}
        <div className="relative w-full h-10 rounded-lg overflow-hidden border border-blue-500/40 bg-blue-950/40">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-200 ease-out"
            style={{ width: `${progress}%` }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.6s_infinite]" />
          <div className="absolute inset-0 flex items-center justify-center gap-2">
            <Loader2 className="h-3.5 w-3.5 text-blue-200 animate-spin shrink-0" />
            <span className="text-xs font-semibold text-blue-100">{message}</span>
            <span className="text-[10px] text-blue-300 font-mono">{Math.round(progress)}%</span>
          </div>
        </div>
        <p className="text-[10px] text-zinc-600 text-center">
          {threadName
            ? `Revisando ${DEEP_SCRAPE_PAGES} páginas del hilo…`
            : "Buscando hilo en Riperstore con múltiples estrategias…"}
        </p>
      </div>
    );
  }

  // not_found
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/40 text-xs text-zinc-500">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
        No se encontró ningún hilo en Riperstore para este producto.
      </div>
      <button
        onClick={() => setPhase({ kind: "idle" })}
        className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700/60 hover:border-zinc-600 transition-colors"
      >
        Reintentar
      </button>
    </div>
  );
}

// ── Search helpers ─────────────────────────────────────────────────────────────

const SEARCH_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "of", "in", "on", "at", "to",
  "with", "by", "from", "is", "it", "be", "as", "set", "pack", "full",
  "free", "ver", "version", "v", "dl", "bl",
]);
function _titleWords(name: string): Set<string> {
  return new Set(
    name.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim()
      .split(" ").filter(w => w.length > 2 && !SEARCH_STOP_WORDS.has(w))
  );
}
function titleSimilarity(a: string, b: string): number {
  const wa = _titleWords(a);
  const wb = _titleWords(b);
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

/**
 * Extrae segmentos en ASCII/inglés de un nombre de producto (normalmente japonés).
 * Ejemplo: "\u30aa\u30ea\u30b8\u30ca\u30eb 3D\u30e2\u30c7\u30eb Airi Idol Outfit Ver.1.2" \u2192 ["Airi Idol Outfit"]
 */
function extractAsciiTerms(name: string): string[] {
  const NOISE = new Set([
    "ver", "version", "v", "dl", "for", "the", "and", "or",
    "3d", "sd", "hd", "vrc", "vrchat", "unity", "pack", "set",
  ]);
  const segments = name.match(/[A-Za-z][A-Za-z0-9 \-_.'!?&]{1,}/g) ?? [];
  return segments
    .map(s => s.trim())
    .filter(s => {
      const words = s.toLowerCase().split(/\s+/);
      return words.some(w => w.length >= 3 && !NOISE.has(w));
    });
}

/** Extrae texto entre corchetes japoneses o paréntesis. */
function extractBracketContent(name: string): string[] {
  const results: string[] = [];
  const re = /[\u300c\u300e\u3010\u300a(\uff08]([^\u300d\u300f\u3011\u300b)\uff09]{1,30})[\u300d\u300f\u3011\u300b)\uff09]/g;
  let m;
  while ((m = re.exec(name)) !== null) results.push(m[1]);
  return results;
}

/**
 * De una lista de productos de Riperstore, devuelve el que más se parece
 * al nombre de Booth buscado. Usa booth_id exacto primero, luego similitud.
 */
function bestMatch(
  products: ShopProduct[],
  boothName: string,
  boothId: string,
  minSimilarity = 0.12,
): ShopProduct | null {
  if (!products.length) return null;
  // Hit directo por ID
  const byId = products.find(
    p => p.source_id === boothId ||
         p.booth_ids?.includes(boothId) ||
         p.name.includes(boothId)
  );
  if (byId) return byId;
  // Mejor similitud de título
  let best: ShopProduct | null = null;
  let bestSim = -1;
  for (const p of products) {
    const sim = titleSimilarity(boothName, p.name);
    if (sim > bestSim) { bestSim = sim; best = p; }
  }
  return bestSim >= minSimilarity ? best : null;
}

/** Intenta múltiples estrategias de búsqueda hasta encontrar un hilo en Riperstore. */
async function searchRiperstoreWithFallbacks(
  boothId: string,
  boothName: string,
  boothAuthor?: string,
  supportedAvatars?: string[],
): Promise<ShopProduct | null> {
  const trySearch = async (q: string): Promise<ShopProduct | null> => {
    if (!q.trim() || q.trim().length < 2) return null;
    try {
      const result = await tauriRipperSearch(q.trim(), 1);
      return bestMatch(result?.products ?? [], boothName, boothId);
    } catch { return null; }
  };

  let hit: ShopProduct | null;

  // 1. Booth ID exacto (funciona si el OP pone "BL: https://booth.pm/items/XXXXXXX")
  hit = await trySearch(boothId);
  if (hit) return hit;

  // 2. Segmentos ASCII del nombre Booth: los títulos de Riperstore están casi siempre en
  //    inglés/romaji incluso cuando el nombre de Booth está en japonés.
  const asciiTerms = extractAsciiTerms(boothName);
  for (const term of asciiTerms) {
    hit = await trySearch(term);
    if (hit) return hit;
  }

  // 3. Texto entre corchetes japoneses: "\u30aa\u30ea\u30b8\u30ca\u30eb3D\u30e2\u30c7\u30eb\u300c\u611b\u8398\u300d" \u2192 "\u611b\u8398"
  for (const bracket of extractBracketContent(boothName)) {
    hit = await trySearch(bracket);
    if (hit) return hit;
  }

  // 4. Nombre del autor/shop de Booth
  if (boothAuthor?.trim()) {
    hit = await trySearch(boothAuthor.trim());
    if (hit) return hit;
  }

  // 5. Avatares compatibles
  if (supportedAvatars?.length) {
    for (const av of supportedAvatars) {
      hit = await trySearch(av);
      if (hit) return hit;
    }
  }

  // 6. Palabras individuales largas de los segmentos ASCII (\u00faltimo recurso)
  const usedTerms = new Set(asciiTerms.map(t => t.toLowerCase()));
  const singleWords = asciiTerms
    .flatMap(t => t.split(/\s+/))
    .filter(w => w.length >= 4 && !usedTerms.has(w.toLowerCase()))
    .filter((w, i, arr) => arr.indexOf(w) === i);
  for (const word of singleWords) {
    hit = await trySearch(word);
    if (hit) return hit;
  }

  return null;
}

// ── Right purchase panel ───────────────────────────────────────────────────────

interface PanelProps {
  p: ShopProduct; detail: BoothProductDetail | null; loading: boolean;
  isPurchased: boolean;
  isFreeBoothItem: boolean;
  isInInventory: boolean;
  onFreeDownload: () => void;
  riperstoreExperimental: boolean;
  ripperDescription: string;
  ripperLinks: DownloadLinkContext[];
  onDownload: () => void; onOpenUrl: (url: string) => void; onGoToInventory: () => void;
  downloading: boolean; downloadDone: boolean; downloadError: string | null;
  dlPercentage: number; dlStatus: string | null;
}

function PurchasePanel({ p, detail, loading, isPurchased, isFreeBoothItem, isInInventory, riperstoreExperimental, ripperDescription, ripperLinks, onDownload, onFreeDownload, onOpenUrl, onGoToInventory, downloading, downloadDone, downloadError, dlPercentage, dlStatus }: PanelProps) {
  const t = useT();
  const isBooth = p.source === "booth";
  const name    = detail?.name   || p.name;
  const author  = detail?.author || p.author;
  const price   = detail?.price_display || p.price_display;

  // sheet: null = closed; once set, shows download links
  const [sheet, setSheet] = useState<{
    links: DownloadLinkContext[];
    threadName: string;
    threadUrl: string;
  } | null>(null);
  useEffect(() => setSheet(null), [p.source_id]);

  // The riperstore extra source on this booth product (if any)
  const ripperExtra = p.extra_sources?.find(s => s.source === "riperstore") ?? null;

  // Build a synthetic riperstore ShopProduct for the download sheet
  const ripperProduct: ShopProduct | null = ripperExtra
    ? { ...p, source: "riperstore", source_id: ripperExtra.source_id, url: ripperExtra.url, extra_sources: [] }
    : null;

  // Callback: receives links + the riperstore thread info (from ScrapeButton or DeepIndexButton)
  const handleScrapeResult = (links: DownloadLinkContext[], threadName: string, threadUrl: string) => {
    setSheet({ links, threadName, threadUrl });
  };

  // Riperstore download sheet (after scrape)
  if (sheet !== null) {
    const sheetProduct = ripperProduct ?? p;
    return (
      <RiperstoreDownloadSheet
        p={sheetProduct}
        threadName={sheet.threadName}
        threadUrl={sheet.threadUrl}
        links={sheet.links}
        onOpenUrl={onOpenUrl}
        onClose={() => setSheet(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Author */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center shrink-0">
          <Store className="h-3.5 w-3.5 text-zinc-400" />
        </div>
        <button onClick={() => onOpenUrl(p.url)}
          className="text-sm text-zinc-300 hover:text-zinc-100 truncate font-medium transition-colors">
          {author || "Unknown shop"}
        </button>
      </div>

      {/* Title */}
      {loading
        ? <div className="space-y-2"><div className="h-6 bg-zinc-800 rounded animate-pulse" /><div className="h-6 bg-zinc-800 rounded animate-pulse w-3/4" /></div>
        : <h2 className="text-xl font-bold text-zinc-50 leading-snug break-words">{name}</h2>
      }

      {/* Owned / inventory badges */}
      {isInInventory ? (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-semibold">
          <Package className="h-3.5 w-3.5 shrink-0" />
          {t("shop_modal_already_in_inventory")}
        </div>
      ) : isPurchased ? (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {t("shop_modal_purchased")}
        </div>
      ) : null}

      {/* Avatar compatibility badges */}
      {p.supported_avatars && p.supported_avatars.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Avatars</span>
          {p.supported_avatars.map((av) => (
            <span key={av} className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25 font-medium">{av}</span>
          ))}
        </div>
      )}

      {/* Avatar base link */}
      {p.avatar_booth_id && (
        <button onClick={() => onOpenUrl(`https://booth.pm/en/items/${p.avatar_booth_id}`)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50 hover:border-zinc-500 transition-colors text-left w-full">
          <span className="text-sm">🎭</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-zinc-300">{t("shop_modal_view_avatar_base")}</p>
            <p className="text-[10px] text-zinc-500">booth.pm/en/items/{p.avatar_booth_id}</p>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
        </button>
      )}

      {/* Variant block */}
      <div className="rounded-xl border border-zinc-700/50 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 bg-zinc-800/50 border-b border-zinc-700/50">
          <div className="min-w-0 mr-3">
            <p className="text-sm font-semibold text-zinc-100 truncate">{name}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">Digital</p>
          </div>
          <div className="shrink-0 text-right">
            <span className={["text-lg font-black tracking-tight", price === "Free" ? "text-emerald-400" : "text-zinc-100"].join(" ")}>
              {price}
            </span>
            {price !== "Free" && price !== "—" && (
              <span className="text-[10px] text-zinc-500 ml-1">JPY</span>
            )}
          </div>
        </div>

        {downloadError && (
          <div className="flex items-start gap-2 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {downloadError}
          </div>
        )}

        <div className="p-3 flex flex-col gap-2">
          {isBooth ? (
            <>
              {(downloading || (dlStatus && dlStatus !== "done")) && (
                <div className="flex flex-col gap-1.5 px-1">
                  <div className="relative h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
                    <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-200 ease-out bg-blue-500"
                      style={{ width: `${dlPercentage}%` }} />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse" />
                  </div>
                  <p className="text-[10px] text-zinc-400 text-center font-mono">
                    {dlStatus === "extracting" ? t("shop_card_extracting") : `${Math.round(dlPercentage)}%`}
                  </p>
                </div>
              )}

              {isInInventory ? (
                <button onClick={onGoToInventory}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-bold transition-all bg-violet-700 hover:bg-violet-600 active:scale-[0.98] text-white">
                  <Package className="h-4 w-4" />
                  {t("shop_card_view_in_inventory")}
                </button>
              ) : (
                /* 🔽 STEP 8: button replaced with free / paid conditional */
                isFreeBoothItem ? (
                  <button
                    onClick={downloadDone ? undefined : onFreeDownload}
                    disabled={downloading}
                    className={[
                      "flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-bold transition-all text-white",
                      downloadDone
                        ? "bg-emerald-600 cursor-default"
                        : downloading
                        ? "opacity-60 cursor-not-allowed bg-emerald-700"
                        : "bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98]",
                    ].join(" ")}
                  >
                    {downloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : downloadDone ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {downloadDone ? t("shop_download_done") : t("shop_card_download")}
                  </button>
                ) : (
                  <button
                    onClick={isPurchased ? onDownload : () => onOpenUrl(p.url)}
                    disabled={downloading}
                    className={[
                      "flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-bold transition-all text-white",
                      downloading
                        ? "opacity-60 cursor-not-allowed bg-red-600"
                        : "bg-red-600 hover:bg-red-500 active:scale-[0.98]",
                    ].join(" ")}
                  >
                    {downloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isPurchased ? (
                      <Download className="h-4 w-4" />
                    ) : (
                      <ShoppingCart className="h-4 w-4" />
                    )}
                    {downloadDone
                      ? t("shop_download_done")
                      : isPurchased
                      ? t("shop_card_download")
                      : "Add to cart"}
                    {!isPurchased && !downloading && (
                      <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                    )}
                  </button>
                )
              )}

              {/* Riperstore integration (experimental gate) */}
              {riperstoreExperimental && (
                <>
                  {ripperExtra && ripperProduct ? (
                    <ScrapeRipperButton
                      sourceId={ripperProduct.source_id}
                      cachedLinks={ripperLinks}
                      onDone={handleScrapeResult}
                      threadName={ripperProduct.name}
                      threadUrl={ripperProduct.url}
                    />
                  ) : (
                    <DeepIndexButton
                      boothId={p.source_id}
                      boothName={p.name}
                      boothAuthor={p.author}
                      supportedAvatars={p.supported_avatars}
                      cachedLinks={ripperLinks}
                      onDone={handleScrapeResult}
                    />
                  )}
                </>
              )}

              <button onClick={() => onOpenUrl(p.url)}
                className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700/60 hover:border-zinc-600 transition-colors">
                {t("shop_modal_open_booth")} <ExternalLink className="h-3 w-3" />
              </button>
            </>
          ) : (
            <>
              {riperstoreExperimental && (
                <ScrapeRipperButton
                  sourceId={p.source_id}
                  cachedLinks={ripperLinks}
                  onDone={handleScrapeResult}
                  threadName={p.name}
                  threadUrl={p.url}
                />
              )}
              <button onClick={() => onOpenUrl(p.url)}
                className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700/60 hover:border-zinc-600 transition-colors">
                Ver hilo en Riperstore <ExternalLink className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-700/50 overflow-hidden text-xs text-zinc-500">
        <div className="px-4 py-3.5 flex items-start gap-2.5 border-b border-zinc-700/50">
          <Download className="h-3.5 w-3.5 mt-0.5 shrink-0 text-zinc-500" />
          <div>
            <p className="text-zinc-300 font-semibold mb-0.5">{t("shop_modal_download_hint")}</p>
            <p className="leading-snug">
              {isBooth ? t("shop_modal_download_hint_booth") : t("shop_modal_download_hint_ripper")}
            </p>
          </div>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <span>{t("shop_modal_source_id")}</span>
          <span className="text-zinc-400 font-mono text-[11px]">{p.source_id}</span>
        </div>
      </div>

      {/* 🔽 STEP 9: updated footer text */}
      <p className="text-[10px] text-zinc-600 leading-relaxed text-center px-2">
        {isBooth && isFreeBoothItem
          ? "This item is free. It will be downloaded directly from Booth and added to your Inventory."
          : isBooth && !isPurchased
          ? t("shop_modal_footer_booth_purchase")
          : isBooth
          ? t("shop_modal_footer_booth_redownload")
          : t("shop_modal_footer_ripper")}
      </p>
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

export function ProductModal() {
  const t = useT();
  const { selectedProduct, selectProduct } = useShopStore();
  const { items: inventoryItems } = useInventoryStore();

  const [detail, setDetail]                       = useState<BoothProductDetail | null>(null);
  const [loadingDetail, setLoadingDetail]         = useState(false);
  const [detailError, setDetailError]             = useState<string | null>(null);
  const [ripperDescription, setRipperDescription] = useState<string>("");
  const [ripperImages, setRipperImages]           = useState<string[]>([]);
  const [ripperLinks, setRipperLinks]             = useState<DownloadLinkContext[]>([]);
  const [downloading, setDownloading]             = useState(false);
  const [downloadDone, setDownloadDone]           = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const [downloadError, setDownloadError]         = useState<string | null>(null);
  

  const leftRef     = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const p       = selectedProduct;
  const isBooth = p?.source === "booth";
  const boothOwnedIds = useShopStore(s => s.boothOwnedIds);
  const { loadBoothOwnedIds } = useShopStore();
  useEffect(() => { loadBoothOwnedIds(); }, []);
  const riperstoreExperimental = useAppStore(s => s.riperstoreExperimental);
  const setActiveSection = useAppStore(s => s.setActiveSection);
  const { downloads } = useDownloadProgress();

  const isPurchased = p ? (p.source === "booth" && boothOwnedIds.has(p.source_id)) : false;
  const isInInventory = p
    ? inventoryItems.some(i => i.source === p.source && i.source_id === p.source_id)
    : false;
  
  const isFreeBoothItem = p
    ? p.source === "booth" && (p.price_display === "Free" || p.price_display === "¥0")
    : false;

  const dl = p ? (downloads[p.source_id] ?? null) : null;
  const dlPercentage = dl?.percentage ?? 0;
  const dlStatus = dl?.status ?? null;

  const handleTrackerCreated = () => {
    setShowTracker(false);
    setActiveSection("tracker");
  };

  useEffect(() => {
    if (!p) {
      setDetail(null); setRipperDescription(""); setRipperImages([]);
      setDetailError(null); return;
    }
    setDownloading(false); setDownloadDone(false); setDownloadError(null);
    setDetailError(null); setRipperDescription(""); setRipperImages([]); setRipperLinks([]);
    leftRef.current?.scrollTo({ top: 0 });

    let cancelled = false;

    if (isBooth) {
      setLoadingDetail(true); setDetail(null);
      tauriGetBoothProductDetail(p.source_id)
        .then(d  => { if (!cancelled) setDetail(d); })
        .catch(e  => { if (!cancelled) setDetailError(String(e)); })
        .finally(() => { if (!cancelled) setLoadingDetail(false); });

      const ripperExtra = p.extra_sources?.find(s => s.source === "riperstore");
      if (ripperExtra) {
        tauriRipperGetTopicDetail(ripperExtra.source_id)
          .then(([desc, imgs, lnks]) => {
            if (!cancelled) {
              setRipperDescription(desc);
              setRipperImages(imgs);
              setRipperLinks((lnks ?? []).map(url => ({ url, avatars: [] })));
            }
          })
          .catch(e => console.warn("[Riperstore] cross-detail fetch failed:", e));
      }
    } else {
      setLoadingDetail(true);
      tauriRipperGetTopicDetail(p.source_id)
        .then(([desc, imgs, lnks]) => {
          if (!cancelled) {
            setRipperDescription(desc);
            setRipperImages(imgs);
            setRipperLinks((lnks ?? []).map(url => ({ url, avatars: [] })));
          }
        })
        .catch(e => { if (!cancelled) setDetailError(String(e)); })
        .finally(() => { if (!cancelled) setLoadingDetail(false); });

      const firstBoothId = p.booth_ids?.[0];
      if (firstBoothId) {
        tauriGetBoothProductDetail(firstBoothId)
          .then(boothDetail => {
            if (!cancelled) {
              setRipperImages(prev => prev.length > 0 ? prev : boothDetail.images);
              setRipperDescription(prev => prev.trim() ? prev : boothDetail.description);
            }
          })
          .catch(() => {});
      }
    }

    return () => { cancelled = true; };
  }, [p?.source_id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") selectProduct(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectProduct]);

  const handleDownload = async () => {
    if (!p) return;
    setDownloadError(null); setDownloading(true);
    try {
      await tauriStartDownload({
        source: p.source, source_id: p.source_id,
        name: p.name, author: p.author, thumbnail_url: p.thumbnail_url,
      });
      setDownloadDone(true);
    } catch (err) { setDownloadError(String(err)); }
    finally { setDownloading(false); }
  };

  /** Descarga un item gratuito de Booth directamente, sin requerir cuenta. */
  const handleFreeDownload = async () => {
    if (!p) return;
    setDownloadError(null); setDownloading(true);
    try {
      await tauriBoothDownloadFreeItem({
        source_id: p.source_id,
        name: p.name,
        author: p.author,
        thumbnail_url: p.thumbnail_url,
      });
      setDownloadDone(true);
    } catch (err) { setDownloadError(String(err)); }
    finally { setDownloading(false); }
  };

  const handleOpenUrl = async (url: string) => {
    try { await openUrl(url); } catch { window.open(url, "_blank"); }
  };

  if (!p) return null;

  const images = isBooth
    ? (detail?.images?.length ? detail.images : [p.thumbnail_url].filter(Boolean)) as string[]
    : (ripperImages.length    ? ripperImages  : [p.thumbnail_url].filter(Boolean))  as string[];
  const description = isBooth ? (detail?.description ?? "") : ripperDescription;
  const similar     = detail?.similar ?? [];

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6"
      style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(8px)" }}
      onClick={e => { if (e.target === backdropRef.current) selectProduct(null); }}
    >
      <div
        className="relative w-full rounded-2xl border border-white/8 shadow-2xl overflow-hidden flex flex-col"
        style={{ maxWidth: 1300, maxHeight: "96vh", background: "linear-gradient(175deg,#19191c 0%,#111113 100%)" }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800/80 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 min-w-0">
            <span className="shrink-0">Shop</span>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className={["shrink-0 font-medium", isBooth ? "text-red-400" : "text-blue-400"].join(" ")}>
              {isBooth ? "Booth.pm" : "Riperstore"}
            </span>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="text-zinc-400 truncate">{p.name}</span>
          </div>
          <button
            onClick={() => selectProduct(null)}
            className="ml-4 shrink-0 p-1.5 rounded-full text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* LEFT — gallery + description */}
          <div
            ref={leftRef}
            className="w-[540px] shrink-0 overflow-y-auto"
            style={{ scrollbarWidth: "thin", scrollbarColor: "#3f3f46 transparent" }}
          >
            <div className="p-8 md:p-10 flex flex-col gap-10">
              {loadingDetail ? <GallerySkeleton /> : <Gallery images={images} name={p.name} />}

              <section>
                <div className="h-px bg-zinc-800 mb-5" />
                {detailError && !loadingDetail && (
                  <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="break-all">{detailError}</span>
                  </div>
                )}
                {loadingDetail ? (
                  <div className="space-y-2">
                    {[100, 88, 94, 72, 85, 60].map((w, i) => (
                      <div key={i} className="h-3 rounded bg-zinc-800 animate-pulse" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : description ? (
                  <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{description}</p>
                ) : (
                  <p className="text-sm text-zinc-600 italic">
                    {isBooth ? t("shop_modal_no_description") : "Open the thread for the full description."}
                  </p>
                )}
              </section>

              {(similar.length > 0 || (isBooth && loadingDetail)) && (
                <section className="flex flex-col gap-4">
                  <div className="h-px bg-zinc-800" />
                  <h3 className="text-xs font-bold tracking-widest text-zinc-500 uppercase">{t("shop_modal_similar")}</h3>
                  {loadingDetail ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="rounded-lg overflow-hidden border border-zinc-800">
                          <div className="aspect-square bg-zinc-800 animate-pulse" />
                          <div className="p-2 space-y-1.5">
                            <div className="h-2.5 bg-zinc-800 rounded animate-pulse w-4/5" />
                            <div className="h-2 bg-zinc-800 rounded animate-pulse w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                      {similar.map(s => (
                        <SimilarCard key={`${s.source}-${s.source_id}`} product={s} onClick={() => selectProduct(s)} />
                      ))}
                    </div>
                  )}
                </section>
              )}
              <div className="h-4" />
            </div>
          </div>

          {/* RIGHT — purchase panel */}
          <div
            className="flex-1 min-w-0 border-l border-zinc-800/80 overflow-y-auto"
            style={{ scrollbarWidth: "thin", scrollbarColor: "#3f3f46 transparent" }}
          >
            <div className="p-8">
              <PurchasePanel
                p={p} detail={detail} loading={loadingDetail}
                isPurchased={isPurchased} 
                isInInventory={isInInventory}
                isFreeBoothItem={isFreeBoothItem}
                riperstoreExperimental={riperstoreExperimental}
                ripperDescription={description}
                ripperLinks={ripperLinks}
                onDownload={handleDownload}
                onFreeDownload={handleFreeDownload} onOpenUrl={handleOpenUrl}
                onGoToInventory={() => { selectProduct(null); setActiveSection("inventory"); }}
                downloading={downloading} downloadDone={downloadDone} downloadError={downloadError}
                dlPercentage={dlPercentage} dlStatus={dlStatus}
              />
            </div>
          </div>
        </div>

        {/* 🔁 TRACK MODAL */}
        {showTracker && p && (
          <AddTrackerModal
            onClose={() => setShowTracker(false)}
            prefill={{
              kind: "item",
              boothId: p.source_id,
              itemName: p.name,
              itemAuthor: p.author,
              itemThumbnailUrl: p.thumbnail_url,
              itemUrl: p.url,
            }}
            onCreated={handleTrackerCreated}
          />
        )}
      </div>
    </div>
  );
}