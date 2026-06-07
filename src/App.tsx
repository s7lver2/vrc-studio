// Eager: página inicial + componentes siempre presentes
import Projects from "@/pages/Projects";
import { useState, useCallback, lazy, Suspense, useEffect } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SplashScreen } from "@/components/SplashScreen";
import { GetStarted } from "@/components/GetStarted";
import { useAppStore } from "@/store/app";
import { useCartStore } from "./store/cartStore";
import { useBoothDebug } from "./hooks/useBoothDebug";
import { useDiscordRpc } from "@/hooks/useDiscordRpc";
import { useCollectionsStore } from "./store/collectionsStore";
import { SplashScreenCarousel } from "@/components/SplashScreenCarousel";
import { tauriScanVRChatPhotos, tauriDiscordReauthenticate, tauriDiscordRpcSetEnabled, tauriIsExpositorMode } from "@/lib/tauri";
import { open as tauriOpenDialog } from "@tauri-apps/plugin-dialog";
import { UpdateDialog } from "@/components/updates/UpdateDialog";
import { MigrationPopup } from "@/components/inventory/MigrationPopup";
import { useInventoryStore } from "@/store/inventoryStore";
import { useAppearanceStore, applyTheme, applyUiScale, applyAccentColor, applyFontSize, applyAnimSpeed, applySidebarWidth, applyBgStyle, applyWallpaperCSS, THEMES,  } from "@/store/appearanceStore";
import { WallpaperBackground } from "@/components/shared/WallpaperBackground";
import { useTour } from "@/hooks/useTour";
import { TourOverlay } from "@/components/onboarding/TourOverlay";
import { EarlyImportToast } from "@/components/projects/EarlyImportToast";
import { activateDemoMode } from "@/lib/demo";


const Shop          = lazy(() => import("@/pages/Shop"));
const Inventory     = lazy(() => import("@/pages/Inventory"));
const Settings      = lazy(() => import("@/pages/Settings"));
const Logs          = lazy(() => import("@/pages/Logs"));
const TrackerPage   = lazy(() => import("@/pages/Tracker"));
const Creators      = lazy(() => import("@/pages/Creators"));
const GitPage       = lazy(() => import("@/pages/Git"));
const ToolsPage     = lazy(() => import("@/pages/Tools"));

const PAGE_PRELOADERS = [
  () => import("@/pages/Shop"),
  () => import("@/pages/Inventory"),
  () => import("@/pages/Settings"),
  () => import("@/pages/Logs"),
  () => import("@/pages/Tracker"),
  () => import("@/pages/Creators"),
  () => import("@/pages/Git"),
  () => import("@/pages/Tools"),
];

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
          case "shop":      return <Shop />;
          case "inventory": return <Inventory />;
          case "settings":  return <Settings />;
          case "logs":      return <Logs />;
          case "tracker":   return <TrackerPage />;
          case "creators":  return <Creators />;
          case "git":       return <GitPage />;
          case "tools":     return <ToolsPage />;
          default:          return null;
        }
      })()}
    </Suspense>
  );
}

export default function App() {
  useBoothDebug();
  const discordRpcEnabled = useAppStore((s) => s.discordRpcEnabled);
  const setDiscordUser = useAppStore((s) => s.setDiscordUser);
  const setDiscordAccessToken = useAppStore((s) => s.setDiscordAccessToken);
  useDiscordRpc(discordRpcEnabled);

  // Silent re-auth on startup: restore Discord user info from persisted token.
  // Also sync backend RPC enabled flag which always starts as false.
  useEffect(() => {
    const { discordAccessToken, discordRpcEnabled: rpcEnabled } = useAppStore.getState();
    if (rpcEnabled) {
      tauriDiscordRpcSetEnabled(true).catch(() => {});
    }
    const persistConnections = (() => {
      try { return localStorage.getItem("persist_connections") !== "false"; }
      catch { return true; }
    })();
    if (!persistConnections || !discordAccessToken) return;
    tauriDiscordReauthenticate(discordAccessToken)
      .then((user) => setDiscordUser(user))
      .catch(() => {
        // Reauth failed (Discord not running, network issue, expired token).
        // Keep the token so the user can reconnect manually from Connections settings
        // without having to go through the full OAuth flow again.
        setDiscordUser(null);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [splashDone, setSplashDone] = useState(false);
  const { tourVisible, step, totalSteps, currentStep, startTour, advance, skip, complete } = useTour();
  const handleSplashDone = useCallback(() => {
    setSplashDone(true);
    setTimeout(startTour, 600);
  }, [startTour]);
  const showGetStarted = useAppStore((s) => s.showGetStarted);
  const closeGetStarted = useAppStore((s) => s.closeGetStarted);
  const inventoryItems = useInventoryStore((s) => s.items);

  const loadingScreen = useAppearanceStore((s) => s.loadingScreen);
  const betaFeaturesEnabled = useAppearanceStore((s) => s.betaFeaturesEnabled);
  const vrchatGallery = useAppearanceStore((s) => s.vrchatGallery);

  // Pre-scan VRChat photos before the carousel mounts so they're ready on frame 1.
  // Reads store state via getState() — bypasses React subscription timing so values
  // are always current regardless of when zustand-persist hydrates.
  const [preloadedVrchatPhotos, setPreloadedVrchatPhotos] = useState<string[]>([]);
  const [vrcScanReady, setVrcScanReady] = useState(false);

  // Page preload progress (0–PAGE_PRELOADERS.length)
  const [pagesLoaded, setPagesLoaded] = useState(0);
  const splashProgress = Math.round((pagesLoaded / PAGE_PRELOADERS.length) * 100);

  useEffect(() => {
    if (!vrcScanReady) return;
    PAGE_PRELOADERS.forEach((load) =>
      load()
        .then(() => setPagesLoaded((n) => n + 1))
        .catch(() => setPagesLoaded((n) => n + 1))
    );
  }, [vrcScanReady]);

  useEffect(() => {
    // Use getState() to read the real current store values — not the React-subscribed
    // snapshot which may still be at default during the first render.
    const s = useAppearanceStore.getState();
    const needsScan =
      s.loadingScreen === "carousel" &&
      s.betaFeaturesEnabled &&
      s.vrchatGallery.consented &&
      s.vrchatGallery.enabled &&
      !!s.vrchatGallery.folderPath;

    if (!needsScan) {
      setVrcScanReady(true);
      return;
    }

    // Timeout: if scan takes >2.5s, mount carousel with built-in fallback
    const timeoutId = setTimeout(() => setVrcScanReady(true), 2500);

    tauriScanVRChatPhotos(s.vrchatGallery.folderPath!, 100)
      .then((photos) => {
        clearTimeout(timeoutId);
        setPreloadedVrchatPhotos(photos);
        setVrcScanReady(true);
      })
      .catch((err) => {
        console.error("[VRChat scan]", err);
        clearTimeout(timeoutId);
        setVrcScanReady(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    useCartStore.getState().load();
    useCollectionsStore.getState().load();
  }, []);

  // Si el modo expositor estaba activo al cerrar, o fue lanzado con --expositor, activar datos falsos
  useEffect(() => {
    const alreadyActive = useAppearanceStore.getState().expositorMode;
    if (alreadyActive) {
      activateDemoMode();
      return;
    }
    // Comprobar si el .exe fue lanzado con --expositor
    tauriIsExpositorMode().then((cliFlag) => {
      if (cliFlag) {
        useAppearanceStore.getState().setExpositorMode(true);
        activateDemoMode();
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const wallpaperActive = useAppearanceStore((s) => s.wallpaper.enabled && !!s.wallpaper.path);

  useEffect(() => {
    const s = useAppearanceStore.getState();
    applyTheme(THEMES[s.themeId]);   // aplica tema + wallpaper CSS
    if (s.themeId === "wallpaper" && s.customWallpaperAccent) {
      const root = document.documentElement;
      root.style.setProperty("--accent-h", s.customWallpaperAccent.h);
      root.style.setProperty("--accent-s", s.customWallpaperAccent.s);
      root.style.setProperty("--accent-l", s.customWallpaperAccent.l);
    }
    applyUiScale(s.uiScale);
    applyFontSize(s.fontSize);
    applyAnimSpeed(s.animSpeed);
    applySidebarWidth(s.sidebarWidth);
    // Init wallpaper CSS state
    applyWallpaperCSS(s.wallpaper, THEMES[s.themeId]);
  }, []);

  return (
    <>
      <WallpaperBackground />
      {!splashDone && (
        (loadingScreen === "carousel" && vrcScanReady)
          ? <SplashScreenCarousel onDone={handleSplashDone} preloadedVrchatPhotos={preloadedVrchatPhotos} progress={splashProgress} />
          : <SplashScreen onDone={handleSplashDone} progress={splashProgress} />
      )}
      <div
        className="flex h-screen text-[hsl(var(--foreground))] overflow-hidden"
        style={{ backgroundColor: wallpaperActive ? "transparent" : "var(--app-bg)", opacity: splashDone ? 1 : 0, transition: "opacity 0.4s ease-out, background-color 0.3s ease" }}
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
      <MigrationPopup hasItems={inventoryItems.length > 0} />
      {splashDone && tourVisible && (
        <TourOverlay
          step={step}
          totalSteps={totalSteps}
          currentStep={currentStep}
          onAdvance={advance}
          onSkip={skip}
          onComplete={complete}
        />
      )}
      <EarlyImportToast />
    </>
  );
}