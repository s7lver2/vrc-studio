// src/components/sidebar/Sidebar.tsx
import { Boxes, Package, ShoppingBag, Archive, Settings, Terminal, Bell, FlaskConical } from "lucide-react";
import { NavItem } from "./NavItem";
import { useAppStore, Section } from "@/store/app";
import { useLogsStore } from "@/store/logsStore";
import { useT } from "@/i18n";
import { useTrackerStore } from "@/store/trackerStore";

export function Sidebar() {
  const t = useT();
  const { activeSection, setActiveSection } = useAppStore();
  const errorCount = useLogsStore((s) => s.errorCount);
  const trackerUnread = useTrackerStore((s) => s.unreadCount);

  const navItems: { section: Section; label: string; icon: typeof Boxes }[] = [
    { section: "projects",  label: t("nav_projects"),  icon: Boxes },
    { section: "packages",  label: t("nav_packages"),  icon: Package },
    { section: "shop",      label: t("nav_shop"),      icon: ShoppingBag },
    { section: "inventory", label: t("nav_inventory"), icon: Archive },
    { section: "tracker",   label: t("nav_tracker"),   icon: Bell },
    { section: "sandbox",   label: "Sandbox",          icon: FlaskConical },
    { section: "settings",  label: t("nav_settings"),  icon: Settings },
    { section: "logs",      label: t("nav_logs"),      icon: Terminal },
  ];

  return (
    <aside className="flex flex-col w-56 min-h-screen bg-[hsl(var(--sidebar-bg))] border-r border-zinc-800 px-3 py-5 gap-1">
      <div className="flex items-center gap-2 px-3 mb-6">
        <div className="w-6 h-6 bg-red-600 rounded-sm" />
        <span className="font-semibold text-zinc-100 text-sm tracking-wide">VRC Studio</span>
      </div>
      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map(({ section, label, icon }) => (
          <NavItem
            key={section}
            icon={icon}
            label={label}
            active={activeSection === section}
            onClick={() => setActiveSection(section)}
            badge={section === "tracker" && trackerUnread > 0 ? trackerUnread : section === "logs" && errorCount > 0 ? errorCount : undefined}
          />
        ))}
      </nav>
      <p className="px-3 text-xs text-zinc-600">v0.1.0</p>
    </aside>
  );
}