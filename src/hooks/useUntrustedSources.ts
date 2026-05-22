/**
 * Controla el acceso a las "fuentes no confiables" (Riperstore).
 * El usuario debe introducir un código de desarrollador para desbloquear.
 * El estado se persiste en localStorage.
 *
 * Seguridad: el código real nunca se almacena en texto plano.
 * Se compara contra su SHA-256, calculado en runtime via Web Crypto API.
 */

const STORAGE_KEY = "app:untrustedSourcesUnlocked";

// SHA-256 hex del developer code original.
// Para regenerarlo: echo -n "TU_CODIGO" | sha256sum
const DEVELOPER_CODE_HASH =
  "48622b2d7df4bf27d1b9300f002bb0835d6672abd55311785ac4fadbff62e530";

async function sha256hex(message: string): Promise<string> {
  const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isUntrustedSourcesUnlocked(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Returns true if the code is correct. Now async due to Web Crypto. */
export async function unlockUntrustedSources(code: string): Promise<boolean> {
  const hash = await sha256hex(code.trim());
  if (hash !== DEVELOPER_CODE_HASH) return false;
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {}
  return true;
}

export function lockUntrustedSources(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("app:riperstoreExperimental");
  } catch {}
}