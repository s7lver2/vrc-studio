import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  tauriBoothIsAuthenticated,
  tauriBoothOpenAuth,
  tauriBoothCaptureSessionCookie,
  tauriBoothLogout,
  tauriBoothFetchPurchases,
} from "@/lib/tauri";
import { useShopStore } from "@/store/shopStore";

export type BoothStatus = "unknown" | "connected" | "disconnected";

export function useBoothStatus() {
  const [status, setStatus] = useState<BoothStatus>("unknown");
  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [purchaseCount, setPurchaseCount] = useState<number | null>(null);
  const loadBoothOwnedIds = useShopStore((s) => s.loadBoothOwnedIds);

  useEffect(() => {
    tauriBoothIsAuthenticated()
      .then((ok: boolean) => setStatus(ok ? "connected" : "disconnected"))
      .catch(() => setStatus("disconnected"));

    const unlistens = [
      listen("booth:auth_success", () => {
        setStatus("connected");
        // Cargar compras automáticamente al conectar
        tauriBoothFetchPurchases()
          .then((ids: string[]) => {
            setPurchaseCount(ids.length);
            // Sincronizar el store del shop para que aparezcan los botones de descarga
            loadBoothOwnedIds();
          })
          .catch((e) => console.error("[booth] fetch purchases tras auth_success:", e));
      }),
      listen("booth:logged_out", () => {
        setStatus("disconnected");
        setPurchaseCount(null);
      }),
      listen<{ count: number }>("booth:purchases_loaded", (e) => {
        setPurchaseCount(e.payload.count);
        // Re-sincronizar el store del shop cada vez que llegan IDs frescos
        loadBoothOwnedIds();
      }),
    ];

    return () => {
      unlistens.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
  }, [loadBoothOwnedIds]);

  const connect = async () => {
    try {
      await tauriBoothOpenAuth();
      await tauriBoothCaptureSessionCookie();
    } catch (e) {
      console.error(e);
    }
  };

  const disconnect = () =>
    tauriBoothLogout()
      .then(() => { setStatus("disconnected"); setPurchaseCount(null); })
      .catch(console.error);

  const refreshPurchases = async () => {
    setLoadingPurchases(true);
    try {
      const ids = await tauriBoothFetchPurchases();
      setPurchaseCount(ids.length);
      // También sincronizar el store del shop
      await loadBoothOwnedIds();
      console.log(`[booth] refresh completado: ${ids.length} items detectados`);
    } catch (e) {
      console.error("[booth] refreshPurchases error:", e);
    } finally {
      setLoadingPurchases(false);
    }
  };

  return { status, purchaseCount, loadingPurchases, connect, disconnect, refreshPurchases };
}