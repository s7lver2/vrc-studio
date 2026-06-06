// STUB — will be replaced in Task 12
import { AnalysisResult } from "../../../lib/tauri";
interface Props { result: AnalysisResult; projectPath: string; }
export function AvatarPerfViewport({ result }: Props) {
  void result;
  return (
    <div className="w-72 flex-shrink-0 border-r border-zinc-800 bg-zinc-950 flex items-center justify-center">
      <span className="text-5xl">👤</span>
    </div>
  );
}
