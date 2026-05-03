import { useState } from "react";
import { ShopProduct, tauriStartDownload } from "../../lib/tauri";
import { useShopStore } from "../../store/shopStore";
import { Download } from "lucide-react";

interface Props {
  product: ShopProduct;
}

const SOURCE_STYLES: Record<string, string> = {
  booth: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  riperstore: "bg-blue-500/20 text-blue-300 border-blue-500/30",
};

const SOURCE_LABELS: Record<string, string> = {
  booth: "Booth",
  riperstore: "Riper",
};

export function ProductCard({ product }: Props) {
  const { selectProduct } = useShopStore();
  const [imgError, setImgError] = useState(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await tauriStartDownload({
        source: product.source,
        source_id: product.source_id,
        name: product.name,
        author: product.author,
        thumbnail_url: product.thumbnail_url,
      });
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  const handleRipperDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ripperSource = product.extra_sources?.find(s => s.source === "riperstore");
    if (!ripperSource) return;
    try {
      await tauriStartDownload({
        source: ripperSource.source,
        source_id: ripperSource.source_id,
        name: product.name,
        author: product.author,
        thumbnail_url: product.thumbnail_url,
      });
    } catch (err) {
      console.error("Riperstore download failed:", err);
    }
  };

  const ripperExtra = product.extra_sources?.find(s => s.source === "riperstore") ?? null;
  const allSources: Array<{ source: string }> = [
    { source: product.source },
    ...(product.extra_sources ?? []),
  ];

  const showImage = product.thumbnail_url && !imgError;

  return (
    <div
      className="group relative flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 cursor-pointer hover:border-zinc-600 transition-all duration-150 overflow-hidden"
      onClick={() => selectProduct(product)}
    >
      {/* Thumbnail */}
      <div className="aspect-square overflow-hidden bg-zinc-800">
        {showImage ? (
          <img
            src={product.thumbnail_url}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
            No image
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 flex flex-col gap-1 flex-1">
        <p className="font-medium text-sm text-zinc-100 leading-tight line-clamp-2">
          {product.name}
        </p>
        <p className="text-xs text-zinc-500 truncate">{product.author}</p>

        {/* Avatar compatibility badges */}
        {product.supported_avatars && product.supported_avatars.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {product.supported_avatars.slice(0, 3).map((av) => (
              <span
                key={av}
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25 font-medium leading-none"
              >
                {av}
              </span>
            ))}
            {product.supported_avatars.length > 3 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-400 border border-zinc-600 font-medium leading-none">
                +{product.supported_avatars.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mt-auto pt-1.5 gap-1 flex-wrap">
          <span className="text-xs font-semibold text-red-400">
            {product.price_display}
          </span>
          {/* Source badges — one per store */}
          <div className="flex items-center gap-1">
            {allSources.map(({ source }) => (
              <span
                key={source}
                className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${SOURCE_STYLES[source] ?? "bg-zinc-700 text-zinc-300 border-zinc-600"}`}
              >
                {SOURCE_LABELS[source] ?? source}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Download button(s) on hover */}
      <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md p-1.5"
          onClick={handleDownload}
          title={product.source === "booth" ? "Download from Booth" : "Download from Riperstore"}
        >
          <Download className="h-3.5 w-3.5 text-zinc-300" />
        </button>
        {ripperExtra && (
          <button
            className="bg-blue-900/70 hover:bg-blue-800/80 border border-blue-500/40 rounded-md p-1.5"
            onClick={handleRipperDownload}
            title="Download from Riperstore (Free)"
          >
            <Download className="h-3.5 w-3.5 text-blue-300" />
          </button>
        )}
      </div>
    </div>
  );
}