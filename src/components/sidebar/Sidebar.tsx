import { Boxes, Package, ShoppingBag, Archive, Bell, Settings, User, GitBranch } from "lucide-react";
import { useAppStore, Section } from "@/store/app";
import { useState, useEffect } from 'react';
import { useTrackerStore } from "@/store/trackerStore";
import { useAppearanceStore } from "@/store/appearanceStore";
import { invoke } from '@tauri-apps/api/core';
import { useT } from "@/i18n";
import { NavItem } from "./NavItem";

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
    wip?: boolean;
  }[] = [
    { section: "projects",  label: t("nav_projects"),  icon: Boxes },
    { section: "packages",  label: t("nav_packages"),  icon: Package },
    { section: "shop",      label: t("nav_shop"),      icon: ShoppingBag, wip: true },
    { section: "inventory", label: t("nav_inventory"), icon: Archive },
    { section: "tracker",   label: t("nav_tracker"),   icon: Bell,        wip: true },
    { section: "git",       label: "Git",              icon: GitBranch },
  ];

  useEffect(() => {
    invoke<string>('get_app_version')
      .then((v) => setAppVersion(`v${v}`))
      .catch(console.error);
  }, []);

  return (
    <aside
      className="flex flex-col min-h-screen px-3 py-5 gap-1 relative transition-[width] duration-200"
      style={{
        width: "var(--sidebar-width)",
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--border-color)",
      }}
    >
      {/* Logo Section */}
      <div className={`flex items-center mb-6 px-3 ${isNarrow ? "justify-center px-0" : "gap-2.5"}`}>
        <img
          src="/logo-mark-32.png"
          alt="VRC Studio"
          style={{ width: 22, height: 22, objectFit: "contain", filter: "drop-shadow(0 0 5px rgba(220,38,38,0.55))" }}
        />
        {!isNarrow && (
          <span className="font-semibold text-zinc-100 text-sm tracking-wide animate-fade-in">
            VRC Studio
          </span>
        )}
      </div>

      {/* Main Navigation Loop */}
      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map(({ section, label, icon, wip }) => (
          <NavItem
            key={section}
            icon={icon}
            label={label}
            active={activeSection === section}
            onClick={() => setActiveSection(section)}
            badge={section === "tracker" && trackerUnread > 0 ? trackerUnread : undefined}
            compact={isNarrow}
            wip={wip}
          />
        ))}
      </nav>

      {/* Bottom Actions Footer */}
      <div
        className={`mt-auto pt-4 flex items-center px-1 ${
          isNarrow ? "flex-col gap-2 justify-center" : "flex-row justify-between"
        }`}
        style={{ borderTop: "1px solid var(--border-color)" }}
      >
        <button
          onClick={() => setActiveSection("settings")}
          className={`p-2 rounded-lg transition-all ${
            activeSection === "settings"
              ? "bg-zinc-800"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
          style={activeSection === "settings" ? { color: "var(--accent-color)" } : {}}
          title={t("nav_settings")}
        >
          <Settings className="h-5 w-5" />
        </button>
        <button
          onClick={() => setActiveSection("creators")}
          className={`p-2 rounded-lg transition-all ${
            activeSection === "creators"
              ? "bg-zinc-800"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
          }`}
          style={activeSection === "creators" ? { color: "var(--accent-color)" } : {}}
          title={t("nav_creators")}
        >
          <User className="h-5 w-5" />
        </button>
      </div>
      
      {/* App Version - hidden when narrow to save space */}
      {!isNarrow && (
        <p className="px-3 text-xs text-zinc-600 text-center mt-2 tracking-wider">
          {appVersion}
        </p>
      )}
    </aside>
  );
}