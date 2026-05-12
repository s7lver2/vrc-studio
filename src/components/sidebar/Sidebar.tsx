// src/components/sidebar/Sidebar.tsx
import { Boxes, Package, ShoppingBag, Archive, Bell, FlaskConical, Settings, User } from "lucide-react";
import { useAppStore, Section } from "@/store/app";
import { useState, useEffect } from 'react';
import { useTrackerStore } from "@/store/trackerStore";
import { useAppearanceStore } from "@/store/appearanceStore";
import { invoke } from '@tauri-apps/api/core';
import { useT } from "@/i18n";
import { NavItem } from "./NavItem"; // Asumimos que NavItem está en el mismo directorio

export function Sidebar() {
  const t = useT();
  const { activeSection, setActiveSection } = useAppStore();
  const trackerUnread = useTrackerStore((s) => s.unreadCount);
  const sidebarWidth = useAppearanceStore((s) => s.sidebarWidth);
  const isNarrow = sidebarWidth === "narrow";
  const [appVersion, setAppVersion] = useState('v0.0.0');

  const navItems: {
    section: Exclude<Section, "settings" | "logs">;
    label: string;
    icon: typeof Boxes;
  }[] = [
    { section: "projects", label: t("nav_projects"), icon: Boxes },
    { section: "packages", label: t("nav_packages"), icon: Package },
    { section: "shop", label: t("nav_shop"), icon: ShoppingBag },
    { section: "inventory", label: t("nav_inventory"), icon: Archive },
    { section: "tracker", label: t("nav_tracker"), icon: Bell },
    { section: "sandbox", label: "Sandbox", icon: FlaskConical },
  ];

  useEffect(() => {
    invoke('get_app_version')
      .then((v: string) => setAppVersion(`v${v}`))
      .catch(console.error);
  }, []);

  return (
    <aside
      className="flex flex-col min-h-screen bg-[hsl(var(--sidebar-bg))] border-r border-zinc-800 px-3 py-5 gap-1 relative transition-[width] duration-200"
      style={{ width: "var(--sidebar-width)" }}
    >
      {/* Logo — oculto en modo estrecho */}
      {!isNarrow && (
        <div className="flex items-center gap-2 px-3 mb-6">
          <div className="w-6 h-6 bg-red-600 rounded-sm" />
          <span className="font-semibold text-zinc-100 text-sm tracking-wide">VRC Studio</span>
        </div>
      )}

      {/* Navegación principal */}
      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map(({ section, label, icon }) => (
          <NavItem
            key={section}
            icon={icon}
            label={label}
            active={activeSection === section}
            onClick={() => setActiveSection(section)}
            badge={section === "tracker" && trackerUnread > 0 ? trackerUnread : undefined}
            compact={isNarrow}
          />
        ))}
      </nav>

      {/* Acciones inferiores */}
      <div className="mt-auto pt-6 border-t border-zinc-800/60 flex items-center justify-between px-2">
        <button
          onClick={() => setActiveSection("settings")}
          className={`p-2 rounded-lg transition-all ${
            activeSection === "settings"
              ? "bg-zinc-800 text-violet-400"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
          title={t("nav_settings")}
        >
          <Settings className="h-5 w-5" />
        </button>
        <button
          onClick={() => setActiveSection("creators")}
          className={`p-2 rounded-lg transition-all ${
            activeSection === "creators"
              ? "bg-zinc-800 text-violet-400"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
          title={t("nav_creators")}
        >
          <User className="h-5 w-5" />
        </button>
      </div>
      <p className="px-3 text-xs text-zinc-600 text-center mt-2">{appVersion}</p>
    </aside>
  );
}