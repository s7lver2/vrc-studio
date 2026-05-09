import type { Project } from "@/lib/tauri";
import { SandboxedTerminal } from "@/components/vcs/SandboxedTerminal";

interface Props {
  project: Project;
}

/**
 * TerminalPanel — wraps the SandboxedTerminal for use inside the Workspace.
 *
 * The VRChat upload wizard runs inline inside SandboxedTerminal as an
 * interactive CLI flow (no separate modal / overlay needed).
 */
export function TerminalPanel({ project }: Props) {
  return <SandboxedTerminal project={project} />;
}