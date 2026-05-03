import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  tauriBoothIsAuthenticated,
  tauriBoothOpenAuth,
  tauriBoothLogout,
  tauriBoothFetchPurchases,
} from "@/lib/tauri";

export type BoothStatus = "unknown" | "connected" | "disconnected";

export function useBoothStatus() {
  const [status, setStatus] = useState<BoothStatus>("unknown");
  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [purchaseCount, setPurchaseCount] = useState<number | null>(null);

  useEffect(() => {
    tauriBoothIsAuthenticated()
      .then((ok: boolean) => setStatus(ok ? "connected" : "disconnected"))
      .catch(() => setStatus("disconnected"));

    const unlistens = [
      listen("booth:auth_success", () => {
        setStatus("connected");
        // Cargar compras automáticamente al conectar
        tauriBoothFetchPurchases()
          .then((ids: string[]) => setPurchaseCount(ids.length))
          .catch(() => {});
      }),
      listen("booth:logged_out", () => {
        setStatus("disconnected");
        setPurchaseCount(null);
      }),
      listen<{ count: number }>("booth:purchases_loaded", (e) => {
        setPurchaseCount(e.payload.count);
      }),
    ];

    return () => {
      unlistens.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
  }, []);

  const connect = () => tauriBoothOpenAuth().catch(console.error);

  const disconnect = () =>
    tauriBoothLogout()
      .then(() => { setStatus("disconnected"); setPurchaseCount(null); })
      .catch(console.error);

  const refreshPurchases = async () => {
    setLoadingPurchases(true);
    try {
      const ids = await tauriBoothFetchPurchases();
      setPurchaseCount(ids.length);
    } catch (e) {
      console.error("Failed to fetch purchases:", e);
    } finally {
      setLoadingPurchases(false);
    }
  };

  return { status, purchaseCount, loadingPurchases, connect, disconnect, refreshPurchases };
}