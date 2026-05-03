import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  tauriRipperIsAuthenticated,
  tauriOpenRipperAuth,
  tauriRipperLogout,
} from "@/lib/tauri";

export type RipperStatus = "unknown" | "connected" | "disconnected" | "expired";

// ── Caché a nivel de módulo ────────────────────────────────────────────────────
// Persiste el último status conocido entre montados/desmontados de Settings.
// Sin esto, cada vez que Settings desmonta el hook vuelve a "unknown" y hay
// un parpadeo visual (y el botón "Connect" aparece brevemente aunque ya estés conectado).

let _cached: RipperStatus = "unknown";

const _listeners = new Set<(s: RipperStatus) => void>();

function _set(s: RipperStatus) {
  _cached = s;
  _listeners.forEach((fn) => fn(s));
}

// Registrar listeners globales de Tauri una sola vez para toda la vida del proceso.
let _globalListenersReady = false;

function _ensureGlobalListeners() {
  if (_globalListenersReady) return;
  _globalListenersReady = true;

  listen("ripper:auth_success",    () => _set("connected")).catch(() => {});
  listen("ripper:logged_out",      () => _set("disconnected")).catch(() => {});
  listen("ripper:session_expired", () => _set("expired")).catch(() => {});
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useRipperStatus() {
  // Inicia con el último valor conocido: evita el parpadeo "unknown → connected"
  // en remounts cuando el usuario ya estaba autenticado.
  const [status, setStatusLocal] = useState<RipperStatus>(_cached);

  useEffect(() => {
    _ensureGlobalListeners();

    // Registrar este componente como suscriptor del caché global
    _listeners.add(setStatusLocal);

    // Verificar el estado real en Rust solo si aún no lo sabemos con certeza.
    // Si el caché ya tiene un valor definitivo no hacemos el round-trip innecesario.
    if (_cached === "unknown") {
      tauriRipperIsAuthenticated()
        .then((ok: boolean) => _set(ok ? "connected" : "disconnected"))
        .catch(() => _set("disconnected"));
    }

    return () => {
      _listeners.delete(setStatusLocal);
    };
  }, []);

  const connect = () => tauriOpenRipperAuth().catch(console.error);

  const disconnect = () =>
    tauriRipperLogout()
      .then(() => _set("disconnected"))
      .catch(console.error);

  const reconnect = () => {
    _set("unknown");
    tauriOpenRipperAuth().catch(console.error);
  };

  return { status, connect, disconnect, reconnect };
}