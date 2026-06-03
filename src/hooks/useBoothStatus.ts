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
  const [error, setError] = useState<string | null>(null);
  const loadBoothOwnedIds = useShopStore((s) => s.loadBoothOwnedIds);

  useEffect(() => {
    tauriBoothIsAuthenticated()
      .then((ok: boolean) => {
        setStatus(ok ? "connected" : "disconnected");
        // Si ya hay sesión activa (por ejemplo tras reinicio), cargar owned IDs directamente
        if (ok) {
          loadBoothOwnedIds().catch((e) =>
            console.error("[booth] auto-load owned IDs on mount:", e)
          );
        }
      })
      .catch(() => setStatus("disconnected"));

    const unlistens = [
      listen("booth:auth_success", () => {
        setStatus("connected");
        setError(null);
        // Cargar compras automáticamente al conectar
        tauriBoothFetchPurchases()
          .then((ids: string[]) => {
            setPurchaseCount(ids.length);
            loadBoothOwnedIds();
          })
          .catch((e) => {
            console.error("[booth] fetch purchases tras auth_success:", e);
            setError("No se pudieron cargar las compras. Intenta refrescar manualmente.");
          });
      }),
      listen("booth:logged_out", () => {
        setStatus("disconnected");
        setPurchaseCount(null);
        setError(null);
      }),
      listen<{ count: number }>("booth:purchases_loaded", (e) => {
        setPurchaseCount(e.payload.count);
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
      setError("Error al conectar con Booth");
    }
  };

  const disconnect = () =>
    tauriBoothLogout()
      .then(() => {
        setStatus("disconnected");
        setPurchaseCount(null);
        setError(null);
      })
      .catch((e) => {
        console.error(e);
        setError("Error al cerrar sesión");
      });

  const refreshPurchases = async () => {
    setLoadingPurchases(true);
    setError(null);
    try {
      const ids = await tauriBoothFetchPurchases();
      setPurchaseCount(ids.length);
      await loadBoothOwnedIds();
      console.log(`[booth] refresh completado: ${ids.length} items detectados`);
    } catch (e) {
      console.error("[booth] refreshPurchases error:", e);
      setError("No se pudieron cargar las compras. Revisa tu conexión o vuelve a iniciar sesión.");
    } finally {
      setLoadingPurchases(false);
    }
  };

  return {
    status,
    purchaseCount,
    loadingPurchases,
    error,
    connect,
    disconnect,
    refreshPurchases,
  };
}