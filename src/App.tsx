// Eager: página inicial + componentes siempre presentes
import Projects from "@/pages/Projects";
import { useState, useCallback, lazy, Suspense, useEffect } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SplashScreen } from "@/components/SplashScreen";
import { GetStarted } from "@/components/GetStarted";
import { useAppStore } from "@/store/app";
import { useCartStore } from "./store/cartStore";
import { useBoothDebug } from "./hooks/useBoothDebug";
import { useCollectionsStore } from "./store/collectionsStore";
import { UpdateDialog } from "@/components/updates/UpdateDialog";

const PackagesPage  = lazy(() => import("@/pages/Packages"));
const Shop          = lazy(() => import("@/pages/Shop"));
const Inventory     = lazy(() => import("@/pages/Inventory"));
const Settings      = lazy(() => import("@/pages/Settings"));
const Logs          = lazy(() => import("@/pages/Logs"));
const TrackerPage   = lazy(() => import("@/pages/Tracker"));
const Sandbox       = lazy(() => import("@/pages/Sandbox"));
const Creators      = lazy(() => import("@/pages/Creators"));
const GitPage       = lazy(() => import("@/pages/Git"));

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

function PageContent() {
  const activeSection = useAppStore((s) => s.activeSection);
  return (
    <Suspense fallback={<PageLoadingFallback />}>
      {(() => {
        switch (activeSection) {
          case "projects":  return <Projects />;
          case "packages":  return <PackagesPage />;
          case "shop":      return <Shop />;
          case "inventory": return <Inventory />;
          case "settings":  return <Settings />;
          case "logs":      return <Logs />;
          case "tracker":   return <TrackerPage />;
          case "sandbox":   return <Sandbox />;
          case "creators":  return <Creators />;
          case "git":       return <GitPage />;
          default:          return null;
        }
      })()}
    </Suspense>
  );
}

export default function App() {
  useBoothDebug();
  const [splashDone, setSplashDone] = useState(false);
  const handleSplashDone = useCallback(() => setSplashDone(true), []);
  const showGetStarted = useAppStore((s) => s.showGetStarted);
  const closeGetStarted = useAppStore((s) => s.closeGetStarted);

  useEffect(() => {
    useCartStore.getState().load();
    useCollectionsStore.getState().load();
  }, []);

  useEffect(() => {
    useCartStore.getState().load();
  }, []);

  return (
    <>
      {!splashDone && <SplashScreen onDone={handleSplashDone} />}
      <div
        className="flex h-screen text-[hsl(var(--foreground))] overflow-hidden"
        style={{ backgroundColor: "var(--app-bg)", opacity: splashDone ? 1 : 0, transition: "opacity 0.4s ease-out, background-color 0.3s ease" }}
      >
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <PageContent />
        </main>
        <UpdateDialog />
      </div>
      {splashDone && showGetStarted && (
        <GetStarted onClose={closeGetStarted} />
      )}
    </>
  );
}