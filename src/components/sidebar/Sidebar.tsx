import { Boxes, Package, ShoppingBag, Archive, Settings } from "lucide-react";
import { NavItem } from "./NavItem";
import { useAppStore, Section } from "@/store/app";

const NAV_ITEMS: { section: Section; label: string; icon: typeof Boxes }[] = [
  { section: "projects", label: "Projects", icon: Boxes },
  { section: "packages", label: "Packages", icon: Package },
  { section: "shop", label: "Shop", icon: ShoppingBag },
  { section: "inventory", label: "Inventory", icon: Archive },
  { section: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { activeSection, setActiveSection } = useAppStore();

  return (
    <aside className="flex flex-col w-56 min-h-screen bg-[hsl(var(--sidebar-bg))] border-r border-zinc-800 px-3 py-5 gap-1">
      {/* Logo */}
      <div className="flex items-center gap-2 px-3 mb-6">
        <div className="w-6 h-6 bg-red-600 rounded-sm" />
        <span className="font-semibold text-zinc-100 text-sm tracking-wide">VRC Studio</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 flex-1">
        {NAV_ITEMS.map(({ section, label, icon }) => (
          <NavItem
            key={section}
            icon={icon}
            label={label}
            active={activeSection === section}
            onClick={() => setActiveSection(section)}
          />
        ))}
      </nav>

      {/* Version */}
      <p className="px-3 text-xs text-zinc-600">v0.1.0</p>
    </aside>
  );
}