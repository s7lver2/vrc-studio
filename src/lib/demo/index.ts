/**
 * Modo Expositor — activación y desactivación.
 *
 * Al activar:
 *   1. Se cargan datos falsos en todos los stores (inmediato, con fallbacks picsum).
 *   2. En background se intentan cargar thumbnails reales de Booth.pm para
 *      los items con source_id — si el fetch falla se mantienen los picsum.
 *
 * Al desactivar: se resetean los stores y se recargan datos reales.
 * No se toca ningún archivo ni backend.
 */

import { useProjectsStore } from "@/store/projects";
import { useInventoryStore } from "@/store/inventoryStore";
import { useTrackerStore } from "@/store/trackerStore";
import {
  DEMO_PROJECTS,
  DEMO_PROJECT_FOLDERS,
  DEMO_INV_ITEMS,
  DEMO_INV_FOLDERS,
  DEMO_TRACKER_ITEMS,
  DEMO_TRACKER_EVENTS,
  fetchBoothThumbnail,
} from "./mockData";

// ─── Activar ─────────────────────────────────────────────────────────────────

export function activateDemoMode() {
  // ── Projects ──────────────────────────────────────────────────────────────
  useProjectsStore.getState().setProjects(DEMO_PROJECTS);
  useProjectsStore.getState().setFolders(DEMO_PROJECT_FOLDERS);

  // ── Inventory ─────────────────────────────────────────────────────────────
  useInventoryStore.setState({
    items: DEMO_INV_ITEMS,
    folders: DEMO_INV_FOLDERS,
    loading: false,
    error: null,
  });

  // ── Tracker ───────────────────────────────────────────────────────────────
  useTrackerStore.setState({
    items: DEMO_TRACKER_ITEMS,
    events: DEMO_TRACKER_EVENTS,
    unreadCount: DEMO_TRACKER_EVENTS.filter((e) => !e.is_read).length,
    loading: false,
    error: null,
  });

  // ── Cargar thumbnails reales de Booth en background ───────────────────────
  // No bloqueante: si falla silenciosamente se mantienen los picsum.
  loadBoothThumbnails();
}

// ─── Desactivar ──────────────────────────────────────────────────────────────

export function deactivateDemoMode() {
  useProjectsStore.getState().setProjects([]);
  useProjectsStore.getState().setFolders([]);

  useInventoryStore.setState({
    items: [],
    folders: [],
    loading: false,
    error: null,
  });

  useTrackerStore.setState({
    items: [],
    events: [],
    unreadCount: 0,
    loading: false,
    error: null,
  });
}

// ─── Thumbnails reales de Booth ──────────────────────────────────────────────

/**
 * Para cada item de inventario con source === "booth" y un source_id,
 * intentamos obtener el thumbnail real del API público de Booth.pm.
 * Las peticiones se hacen en paralelo con un límite de concurrencia.
 * Si alguna falla (timeout, CORS, item eliminado) se ignora en silencio.
 */
async function loadBoothThumbnails() {
  // Solo los items con ID de Booth conocido
  const candidates = DEMO_INV_ITEMS.filter(
    (it) => it.source === "booth" && it.source_id
  );

  // Concurrencia máxima para no saturar Booth
  const CONCURRENCY = 4;
  const results = new Map<string, string>(); // item_id → url

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (item) => {
        const url = await fetchBoothThumbnail(item.source_id!);
        if (url) results.set(item.id, url);
      })
    );
  }

  if (results.size === 0) return;

  // Aplicar los nuevos thumbnails al store solo si el modo expositor sigue activo
  const { useAppearanceStore } = await import("@/store/appearanceStore");
  if (!useAppearanceStore.getState().expositorMode) return;

  useInventoryStore.setState((state) => ({
    items: state.items.map((it) =>
      results.has(it.id) ? { ...it, thumbnail_url: results.get(it.id)! } : it
    ),
  }));

  // También actualizar el tracker item que tiene thumbnail de Booth
  // (tracker-0001 usa la imagen de Karin)
  const karinUrl = results.get("demo-item-0001");
  if (karinUrl) {
    useTrackerStore.setState((state) => ({
      items: state.items.map((it) =>
        it.id === "demo-tracker-0001"
          ? { ...it, item_thumbnail_url: karinUrl }
          : it
      ),
    }));
  }
}

export { DEMO_GIT_DATA, getDemoGitData } from "./mockData";
