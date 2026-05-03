import { useState, useCallback, useEffect } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SplashScreen } from "@/components/SplashScreen";
import { useAppStore } from "@/store/app";
import Projects from "@/pages/Projects";
import Packages from "@/pages/Packages";
import Shop from "@/pages/Shop";
import Inventory from "@/pages/Inventory";
import Settings from "@/pages/Settings";

// Renderizar solo la página activa — evita que todos los hooks monten a la vez
function PageContent() {
  const activeSection = useAppStore((s) => s.activeSection);
  switch (activeSection) {
    case "projects":  return <Projects />;
    case "packages":  return <Packages />;
    case "shop":      return <Shop />;
    case "inventory": return <Inventory />;
    case "settings":  return <Settings />;
    default:          return null;
  }
}

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  const handleSplashDone = useCallback(() => setSplashDone(true), []);
  const awesomeAnimations = useAppStore((s) => s.awesomeAnimations);

  // Sync body class for CSS animation system
  useEffect(() => {
    document.body.classList.toggle("vrc-animations-on", awesomeAnimations > 0);
  }, [awesomeAnimations]);

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
      </div>
    </>
  );
}