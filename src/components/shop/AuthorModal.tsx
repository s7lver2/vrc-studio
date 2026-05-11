import { X, User, Bell } from "lucide-react";
import { useState } from "react";
import type { ShopAuthor } from "@/lib/tauri";
import { ProductCard } from "./ProductCard";
import { AddTrackerModal } from "@/components/tracker/AddTrackerModal";
import { useAppStore } from "@/store/app";

interface AuthorModalProps {
  author: ShopAuthor;
  onClose: () => void;
}

export function AuthorModal({ author, onClose }: AuthorModalProps) {
  const [showTracker, setShowTracker] = useState(false);
  const { setActiveSection } = useAppStore();

  const handleFollow = () => setShowTracker(true);
  const handleTrackerCreated = () => {
    setShowTracker(false);
    onClose();
    setActiveSection("tracker");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[hsl(var(--card))] border border-zinc-700 rounded-xl w-[560px] max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center">
              <User className="w-5 h-5 text-zinc-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">{author.name}</h2>
              <p className="text-xs text-zinc-500">{author.product_count} products found</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleFollow}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
            >
              <Bell className="w-3.5 h-3.5" />
              Follow
            </button>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Products grid */}
        <div className="overflow-y-auto p-4 flex-1">
          <div className="grid grid-cols-2 gap-3">
            {author.sample_products.map((p) => (
              <ProductCard key={`${p.source}:${p.source_id}`} product={p} />
            ))}
          </div>
          {author.product_count > 6 && (
            <p className="text-center text-xs text-zinc-600 mt-4">
              Showing {author.sample_products.length} of {author.product_count} products
            </p>
          )}
        </div>
      </div>

      {showTracker && (
        <AddTrackerModal
          onClose={() => setShowTracker(false)}
          prefill={{
            kind: "author",
            authorName: author.name,
          }}
          onCreated={handleTrackerCreated}
        />
      )}
    </div>
  );
}