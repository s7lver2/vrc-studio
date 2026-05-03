import { useState } from "react";
import { Plus, Package as PackageIcon } from "lucide-react";
import { PackageCard } from "@/components/packages/PackageCard";
import { PackageEditor } from "@/components/packages/PackageEditor";
import { usePackages } from "@/hooks/usePackages";
import type { CustomPackage } from "@/lib/tauri";
import { invoke } from "@tauri-apps/api/core";

export default function Packages() {
  const { packages, loading, error, deletePackage, buildPackage } = usePackages();
  const [editingPackage, setEditingPackage] = useState<CustomPackage | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [buildingId, setBuildingId] = useState<string | null>(null);

  const handleNew = () => {
    setEditingPackage(null);
    setEditorOpen(true);
  };

  const handleEdit = (pkg: CustomPackage) => {
    setEditingPackage(pkg);
    setEditorOpen(true);
  };

  const handleDelete = async (pkg: CustomPackage) => {
    if (!confirm(`¿Eliminar el paquete "${pkg.display_name}"? Esta acción no se puede deshacer.`))
      return;
    try {
      await deletePackage(pkg.id);
    } catch (e) {
      alert(`Error al eliminar: ${e}`);
    }
  };

  const handleBuild = async (pkg: CustomPackage) => {
    setBuildingId(pkg.id);
    try {
      await buildPackage(pkg.id);
    } catch (e) {
      alert(`Error al generar ZIP: ${e}`);
    } finally {
      setBuildingId(null);
    }
  };

  const handleOpenFolder = async (pkg: CustomPackage) => {
    if (!pkg.zip_path) return;
    // Obtener la carpeta padre del ZIP
    const folder = pkg.zip_path.replace(/[/\\][^/\\]+$/, "");
    try {
      // Usa el plugin shell de Tauri para abrir la carpeta
      await invoke("plugin:shell|open", { path: folder });
    } catch {
      // Fallback: mostrar la ruta
      alert(`Carpeta del paquete:\n${folder}`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Packages</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {packages.length > 0
              ? `${packages.length} paquete${packages.length === 1 ? "" : "s"} VPM custom`
              : "Tus paquetes VPM custom"}
          </p>
        </div>
        <button
          onClick={handleNew}
          className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          <Plus size={16} />
          Nuevo paquete
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-400">
            Error al cargar paquetes: {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm text-zinc-600">Cargando paquetes…</p>
          </div>
        ) : packages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <PackageIcon size={40} className="text-zinc-700" />
            <p className="text-sm font-medium text-zinc-500">Sin paquetes todavía</p>
            <p className="text-xs text-zinc-600">
              Crea tu primer paquete VPM custom para empezar.
            </p>
            <button
              onClick={handleNew}
              className="mt-2 rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
            >
              Crear paquete
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {packages.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onBuild={handleBuild}
                onOpenFolder={handleOpenFolder}
                isBuilding={buildingId === pkg.id}
              />
            ))}
          </div>
        )}
      </div>

      <PackageEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editingPackage={editingPackage}
      />
    </div>
  );
}