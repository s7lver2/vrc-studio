import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CreateProjectProgress } from "@/lib/tauri";

export interface ProjectEventState {
  progress: number;
  message: string;
  done: boolean;
  error: string | null;
}

const INITIAL_STATE: ProjectEventState = {
  progress: 0,
  message: "",
  done: false,
  error: null,
};

export function useProjectEvents() {
  const [state, setState] = useState<ProjectEventState>(INITIAL_STATE);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<CreateProjectProgress>("project:progress", (event) => {
      setState({
        progress: event.payload.progress,
        message: event.payload.message,
        done: event.payload.done,
        error: event.payload.error,
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, []);

  const reset = () => setState(INITIAL_STATE);

  return { ...state, reset };
}