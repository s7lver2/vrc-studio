// src/components/inventory/ImageSourcePicker.tsx
import { HardDrive, Image as ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { toAssetUrl } from "@/lib/utils";

export type ImageSource = "computer" | "product";

interface Props {
  /** Already-in-use image URLs/paths (from product images, custom_images, thumbnail_url…) */
  existingImages?: string[];
  onSelect: (source: ImageSource, productImagePath?: string) => void;
  onClose: () => void;
}

export function ImageSourcePicker({ existingImages = [], onSelect, onClose }: Props) {
  const [showGallery, setShowGallery] = useState(false);
  const validImages = existingImages.filter(Boolean);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">
            {showGallery ? "Select from Product" : "Select Image"}
          </h2>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!showGallery ? (
          <>
            <p className="text-xs text-zinc-500 -mt-2">Select where to find the image</p>
            <div className="grid grid-cols-2 gap-3">
              {/* From Computer */}
              <button
                onClick={() => onSelect("computer")}
                className="flex flex-col items-center gap-3 py-6 px-3 rounded-xl border border-zinc-700 bg-zinc-900
                           hover:border-zinc-500 hover:bg-zinc-800 transition-all text-center group"
              >
                <div className="text-zinc-400 group-hover:text-zinc-200 transition-colors">
                  <HardDrive className="h-8 w-8" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors">
                    From Computer
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5 leading-tight">Pick a local file</p>
                </div>
              </button>

              {/* From Product */}
              <button
                onClick={() => {
                  if (validImages.length === 0) return;
                  if (validImages.length === 1) {
                    onSelect("product", validImages[0]);
                  } else {
                    setShowGallery(true);
                  }
                }}
                disabled={validImages.length === 0}
                className={`flex flex-col items-center gap-3 py-6 px-3 rounded-xl border transition-all text-center group
                  ${validImages.length === 0
                    ? "border-zinc-800 bg-zinc-900/50 opacity-40 cursor-not-allowed"
                    : "border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:bg-zinc-800 cursor-pointer"
                  }`}
              >
                <div className="text-zinc-400 group-hover:text-zinc-200 transition-colors relative">
                  <ImageIcon className="h-8 w-8" />
                  {validImages.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-violet-600 text-[9px] font-bold text-white flex items-center justify-center">
                      {validImages.length}
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors">
                    From Product
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
                    {validImages.length === 0 ? "No images available" : "Already in use"}
                  </p>
                </div>
              </button>
            </div>
          </>
        ) : (
          /* Gallery view */
          <>
            <p className="text-xs text-zinc-500 -mt-2">Pick an image already used by this product</p>
            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {validImages.map((src, i) => (
                <button
                  key={i}
                  onClick={() => onSelect("product", src)}
                  className="aspect-square rounded-lg overflow-hidden border border-zinc-700 hover:border-zinc-400
                             transition-all hover:scale-[1.03] focus:outline-none focus:border-violet-500"
                >
                  <img
                    src={src.startsWith("http") ? src : (toAssetUrl(src) ?? src)}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowGallery(false)}
              className="text-xs text-zinc-500 hover:text-zinc-300 text-left transition-colors"
            >
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}