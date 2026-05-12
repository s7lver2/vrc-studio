// Eager: página inicial + componentes siempre presentes
import Projects from "@/pages/Projects";
import { useState, useCallback, lazy, Suspense } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SplashScreen } from "@/components/SplashScreen";
import { useAppStore } from "@/store/app";
import { useBoothDebug } from "./hooks/useBoothDebug";
import { UpdateDialog } from "@/components/updates/UpdateDialog";


// Lazy: se cargan solo cuando el usuario navega a esa sección
const PackagesPage  = lazy(() => import("@/pages/Packages"));
const Shop          = lazy(() => import("@/pages/Shop"));
const Inventory     = lazy(() => import("@/pages/Inventory"));
const Settings      = lazy(() => import("@/pages/Settings"));
const Logs          = lazy(() => import("@/pages/Logs"));
const TrackerPage   = lazy(() => import("@/pages/Tracker"));
const Sandbox       = lazy(() => import("@/pages/Sandbox"));
const Creators      = lazy(() => import("@/pages/Creators"));
const WorkspacePage = lazy(() =>
  import("@/components/workspace/WorkspacePage").then((m) => ({ default: m.WorkspacePage }))
);

function PageLoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-3 opacity-40">
        <div className="w-6 h-6 border-2 border-zinc-600 border-t-red-500 rounded-full animate-spin" />
        <p className="text-xs text-zinc-600 tracking-wider">Loading…</p>
      </div>
    </div>
  );
}

// Renderizar solo la página activa — evita que todos los hooks monten a la vez
function PageContent() {
  const activeSection = useAppStore((s) => s.activeSection);

  return (
    <Suspense fallback={<PageLoadingFallback />}>
      {(() => {
        switch (activeSection) {
          case "projects":   return <Projects />;
          case "packages":   return <PackagesPage />;
          case "shop":       return <Shop />;
          case "inventory":  return <Inventory />;
          case "settings":   return <Settings />;
          case "logs":       return <Logs />;
          case "tracker":    return <TrackerPage />;
          case "sandbox":    return <Sandbox />;
          case "creators":   return <Creators />;
          default:           return null;
        }
      })()}
    </Suspense>
  );
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
        <div style={{ opacity: splashDone ? 1 : 0, transition: "opacity 0.4s ease-out" }}>
          <Suspense fallback={<PageLoadingFallback />}>
            <WorkspacePage project={workspaceProject} />
          </Suspense>
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