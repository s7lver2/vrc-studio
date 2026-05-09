// src/components/ErrorBoundary.tsx
import { Component, ReactNode } from "react";
import { addLog } from "@/store/logsStore";

interface Props { children: ReactNode; }
interface State { error: Error | null; errorInfo: string | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Enviar al store de logs para verlo en la pestaña Logs
    addLog({
      level: "react",
      message: `React Error: ${error.message}`,
      detail: `${error.stack ?? ""}\n\nComponent Stack:${info.componentStack}`,
      source: "react-error-boundary",
    });
    this.setState({ errorInfo: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center p-8 text-red-400 bg-zinc-900">
          <div className="max-w-lg w-full">
            <p className="font-bold text-lg mb-2">Error de renderizado</p>
            <pre className="text-xs whitespace-pre-wrap opacity-70 mb-4 max-h-40 overflow-y-auto">
              {this.state.error.message}
            </pre>
            {this.state.errorInfo && (
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer hover:text-zinc-300">Component stack</summary>
                <pre className="whitespace-pre-wrap mt-2 opacity-60 max-h-32 overflow-y-auto">
                  {this.state.errorInfo}
                </pre>
              </details>
            )}
            <button
              className="mt-4 px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm"
              onClick={() => this.setState({ error: null, errorInfo: null })}
            >
              Intentar de nuevo
            </button>
            <p className="mt-2 text-xs text-zinc-600">
              Este error también aparece en la pestaña Logs.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}