/**
 * Controla el acceso a las "fuentes no confiables" (Riperstore).
 * El usuario debe introducir un código de desarrollador para desbloquear.
 * El estado se persiste en localStorage.
 */

const STORAGE_KEY = "app:untrustedSourcesUnlocked";
// Código hardcoded — no se muestra en la UI en ningún momento
const DEVELOPER_CODE = "bHVjeWxpa2VmZWV0";

export function isUntrustedSourcesUnlocked(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function unlockUntrustedSources(code: string): boolean {
  if (code.trim() !== DEVELOPER_CODE) return false;
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {}
  return true;
}

export function lockUntrustedSources(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    // También desactivar riperstore si estaba activo
    localStorage.removeItem("app:riperstoreExperimental");
  } catch {}
}