import { useState, useCallback, useEffect } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SplashScreen } from "@/components/SplashScreen";
import { useAppStore } from "@/store/app";
import Projects from "@/pages/Projects";
import PackagesPage from "@/pages/Packages.tsx";
import Shop from "@/pages/Shop";
import Inventory from "@/pages/Inventory";
import Settings from "@/pages/Settings";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import Logs from "@/pages/Logs";
import TrackerPage from "@/pages/Tracker";
import Sandbox from "@/pages/Sandbox";
import { useBoothDebug } from "./hooks/useBoothDebug";
import { UpdateDialog } from "@/components/updates/UpdateDialog";

// Renderizar solo la página activa — evita que todos los hooks monten a la vez
function PageContent() {
  const activeSection = useAppStore((s) => s.activeSection);

  switch (activeSection) {
    case "projects":
      return <Projects />;
    case "packages":
      return <PackagesPage />;
    case "shop":
      return <Shop />;
    case "inventory":
      return <Inventory />;
    case "settings":
      return <Settings />;
    case "logs":
      return <Logs />;
    case "tracker":
      return <TrackerPage />;
    case "sandbox":
      return <Sandbox />;
    default:
      return null;
  }
}

export default function App() {
  useBoothDebug();
  const [splashDone, setSplashDone] = useState(false);
  const handleSplashDone = useCallback(() => setSplashDone(true), []);
  const activeSection = useAppStore((s) => s.activeSection);
  const workspaceProject = useAppStore((s) => s.workspaceProject);

  // Workspace mode — pantalla completa sin sidebar
  if (activeSection === "workspace" && workspaceProject) {
    return (
      <>
        {!splashDone && <SplashScreen onDone={handleSplashDone} />}
        <div
          style={{
            opacity: splashDone ? 1 : 0,
            transition: "opacity 0.4s ease-out",
          }}
        >
          <WorkspacePage project={workspaceProject} />
        </div>
      </>
    );
  }

  return (
    <>
      {!splashDone && <SplashScreen onDone={handleSplashDone} />}
      <div
        className="flex h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] overflow-hidden"
        style={{
          opacity: splashDone ? 1 : 0,
          transition: "opacity 0.4s ease-out",
        }}
      >
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <PageContent />
        </main>
        <UpdateDialog />
      </div>
    </>
  );
}