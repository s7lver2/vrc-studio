// src/components/tools/runners/AvatarPerf.tsx
import { useState } from "react";
import { ArrowLeft, Loader2, ChevronRight } from "lucide-react";
import {
  SceneFile, AvatarDescriptor, AnalysisResult,
  tauriToolsScanScenes, tauriToolsScanAvatars, tauriToolsRunSidecar,
} from "../../../lib/tauri";
import { useProjectsStore } from "../../../store/projects";
import { AvatarPerfMetrics } from "./AvatarPerfMetrics";
import { AvatarPerfViewport } from "./AvatarPerfViewport";
import { AvatarPerfRecommendations } from "./AvatarPerfRecommendations";

type Step = "project" | "scene" | "avatar" | "results";

interface Props {
  toolId: string;
  onBack: () => void;
}

export function AvatarPerf({ toolId, onBack }: Props) {
  const projects = useProjectsStore((s) => s.projects);

  const [step, setStep] = useState<Step>("project");
  const [selectedProjectPath, setSelectedProjectPath] = useState("");
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [scenes, setScenes] = useState<SceneFile[]>([]);
  const [selectedScene, setSelectedScene] = useState<SceneFile | null>(null);
  const [avatars, setAvatars] = useState<AvatarDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<"metrics" | "recommendations">("metrics");

  const handleSelectProject = async (path: string, name: string) => {
    setSelectedProjectPath(path);
    setSelectedProjectName(name);
    setError(null);
    setLoading(true);
    try {
      const found = await tauriToolsScanScenes(path);
      setScenes(found);
      setStep("scene");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectScene = async (scene: SceneFile) => {
    setSelectedScene(scene);
    setError(null);
    setLoading(true);
    try {
      const found = await tauriToolsScanAvatars(selectedProjectPath, scene.path);
      setAvatars(found);
      setStep("avatar");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAvatar = async (avatar: AvatarDescriptor) => {
    setError(null);
    setLoading(true);
    try {
      const res = await tauriToolsRunSidecar(toolId, {
        action: "analyze",
        project_path: selectedProjectPath,
        scene_path: selectedScene!.path,
        avatar_name: avatar.name,
      });
      setResult(res);
      setStep("results");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (step === "scene") { setStep("project"); setScenes([]); }
    else if (step === "avatar") { setStep("scene"); setAvatars([]); }
    else if (step === "results") { setStep("avatar"); setResult(null); }
    else { onBack(); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-3.5 border-b border-zinc-800 shrink-0">
        <button onClick={goBack} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={step === "project" ? "text-zinc-100 font-semibold" : ""}>Proyecto</span>
          {step !== "project" && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span className={step === "scene" ? "text-zinc-100 font-semibold" : ""}>{selectedProjectName}</span>
            </>
          )}
          {(step === "avatar" || step === "results") && selectedScene && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span className={step === "avatar" ? "text-zinc-100 font-semibold" : ""}>{selectedScene.name}</span>
            </>
          )}
          {step === "results" && result && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span className="text-zinc-100 font-semibold">{result.avatar_name}</span>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {loading && (
          <div className="flex-1 flex items-center justify-center gap-2 text-zinc-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {step === "scene" ? "Buscando escenas…" : step === "avatar" ? "Buscando avatares…" : "Analizando avatar…"}
          </div>
        )}

        {error && !loading && (
          <div className="p-6 text-sm text-red-400 bg-red-950/20 border border-red-900/30 m-4 rounded-xl">
            {error}
          </div>
        )}

        {!loading && !error && step === "project" && (
          <div className="flex-1 overflow-y-auto p-6">
            <p className="text-xs text-zinc-500 mb-4">Selecciona el proyecto Unity que contiene el avatar</p>
            <div className="flex flex-col gap-2 max-w-xl">
              {projects.length === 0 ? (
                <p className="text-sm text-zinc-600">No hay proyectos registrados. Añade uno en la pestaña Proyectos.</p>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProject(p.path, p.name)}
                    className="flex items-center gap-3 px-4 py-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl text-left transition-colors"
                  >
                    <div className="text-lg">📁</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100 truncate">{p.name}</p>
                      <p className="text-xs text-zinc-500 truncate">{p.path}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-600 flex-shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {!loading && !error && step === "scene" && (
          <div className="flex-1 overflow-y-auto p-6">
            <p className="text-xs text-zinc-500 mb-4">Selecciona la escena Unity</p>
            <div className="flex flex-col gap-2 max-w-xl">
              {scenes.length === 0 ? (
                <p className="text-sm text-zinc-600">No se encontraron escenas .unity en este proyecto.</p>
              ) : (
                scenes.map((scene) => (
                  <button
                    key={scene.path}
                    onClick={() => handleSelectScene(scene)}
                    className="flex items-center gap-3 px-4 py-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl text-left transition-colors"
                  >
                    <div className="text-lg">🎬</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{scene.name}</p>
                      <p className="text-xs text-zinc-500 truncate">{scene.path}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-600" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {!loading && !error && step === "avatar" && (
          <div className="flex-1 overflow-y-auto p-6">
            <p className="text-xs text-zinc-500 mb-4">
              GameObjects con VRC Avatar Descriptor encontrados en {selectedScene?.name}
            </p>
            <div className="flex flex-col gap-2 max-w-xl">
              {avatars.length === 0 ? (
                <p className="text-sm text-zinc-600">No se encontraron avatares con VRC Avatar Descriptor en esta escena.</p>
              ) : (
                avatars.map((av) => (
                  <button
                    key={av.file_id}
                    onClick={() => handleSelectAvatar(av)}
                    className="flex items-center gap-3 px-4 py-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl text-left transition-colors"
                  >
                    <div className="text-lg">👤</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{av.name}</p>
                      <p className="text-xs text-zinc-500">fileID: {av.file_id}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-600" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {!loading && !error && step === "results" && result && (
          <div className="flex flex-1 overflow-hidden min-h-0">
            <AvatarPerfViewport result={result} projectPath={selectedProjectPath} />
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              <AvatarPerfMetrics result={result} activeTab={activeTab} onTabChange={setActiveTab} />
              {activeTab === "recommendations" && (
                <AvatarPerfRecommendations recommendations={result.recommendations} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
