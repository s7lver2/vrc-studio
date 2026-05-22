// src/components/settings/StorageCompressionSection.tsx
import { useState } from "react";
import { HardDrive, Archive } from "lucide-react";
import { StorageSection } from "./StorageSection";
import { CompressionSection } from "./CompressionSection";

type SubTab = "storage" | "compression";

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function StorageCompressionSection() {
  const [activeTab, setActiveTab] = useState<SubTab>("storage");

  const tabs: { id: SubTab; label: string; icon: React.ElementType }[] = [
    { id: "storage",     label: "Storage",     icon: HardDrive },
    { id: "compression", label: "Compression", icon: Archive   },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Sub-nav pill */}
      <div className="flex gap-2 p-1 rounded-xl bg-zinc-900 border border-zinc-800 w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all",
                active
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
              style={active ? {
                background: "var(--app-bg, #09090b)",
                border: "1px solid",
                borderColor: "var(--accent-color)",
                color: "var(--accent-color)",
                boxShadow: "0 0 10px hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.2)",
              } : {}}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTab === "storage"     && <StorageSection />}
      {activeTab === "compression" && <CompressionSection />}
    </div>
  );
}