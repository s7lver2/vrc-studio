// Shared package categorization used in both CreateProjectForm and PackagesTab.

export type PkgCategory = "sdk" | "tools" | "shaders" | "physics" | "community" | "other";

export interface CategoryMeta {
  id: PkgCategory;
  label: string;
  icon: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: "sdk",       label: "VRChat SDK",        icon: "🎮" },
  { id: "tools",     label: "Build Tools",        icon: "🔧" },
  { id: "shaders",   label: "Shaders",            icon: "✨" },
  { id: "physics",   label: "Physics",            icon: "🌊" },
  { id: "community", label: "Community Packages", icon: "🧩" },
  { id: "other",     label: "Other",              icon: "📦" },
];

const SDK_IDS = new Set([
  "com.vrchat.avatars", "com.vrchat.base", "com.vrchat.worlds",
]);
const TOOL_IDS = new Set([
  "com.vrchat.udonsharp", "com.vrchat.clientsim", "com.vrchat.gesture-manager",
  "com.vrchat.vrcfury", "com.lleal.av3emulator", "com.hfcred.animationtogglecreator",
]);
const SHADER_PREFIXES = ["jp.lilxyzw", "com.poiyomi", "sh.orels"];
const PHYSICS_PREFIXES = ["com.magicallabs", "dev.hai-vr"];

export function categorizePackage(pkgId: string): PkgCategory {
  if (SDK_IDS.has(pkgId)) return "sdk";
  if (TOOL_IDS.has(pkgId)) return "tools";
  if (SHADER_PREFIXES.some((p) => pkgId.startsWith(p))) return "shaders";
  if (PHYSICS_PREFIXES.some((p) => pkgId.startsWith(p))) return "physics";
  if (!pkgId.startsWith("com.vrchat") && !pkgId.startsWith("com.unity")) return "community";
  return "other";
}