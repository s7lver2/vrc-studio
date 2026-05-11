import { readFile } from "@tauri-apps/plugin-fs";
import type { VrcMenuControl, VrcMenuTree } from "@/store/sandboxStore";

export async function parseVrcMenuAsset(filePath: string): Promise<VrcMenuTree> {
  const bytes = await readFile(filePath);
  const text = new TextDecoder().decode(bytes);
  return parseVrcMenuYaml(text, filePath.split(/[\\/]/).pop() ?? "Menu");
}

export function parseVrcMenuYaml(yaml: string, menuName: string): VrcMenuTree {
  const controls: VrcMenuControl[] = [];
  const lines = yaml.split("\n");
  let inControls = false;
  let currentControl: Partial<VrcMenuControl> | null = null;

  const typeMap: Record<string, VrcMenuControl["type"]> = {
    "0": "Button",
    "1": "Toggle",
    "2": "SubMenu",
    "3": "TwoAxisPuppet",
    "4": "FourAxisPuppet",
    "5": "RadialPuppet",
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trimStart();

    if (trimmed.startsWith("controls:")) {
      inControls = true;
      continue;
    }
    if (!inControls) continue;

    if (trimmed.startsWith("- name:")) {
      if (currentControl?.name) controls.push(currentControl as VrcMenuControl);
      const name = trimmed.replace("- name:", "").trim().replace(/^["']|["']$/g, "");
      currentControl = { name, type: "Button", subMenu: [] };
      continue;
    }

    if (!currentControl) continue;

    if (trimmed.startsWith("type:")) {
      const raw = trimmed.replace("type:", "").trim();
      currentControl.type = typeMap[raw] ?? "Button";
    } else if (trimmed.startsWith("parameter:")) {
      const inline = trimmed.replace("parameter:", "").trim();
      if (inline && inline !== "{}") currentControl.parameter = inline.replace(/^["']|["']$/g, "");
    } else if (trimmed.startsWith("name:") && !trimmed.startsWith("name: {")) {
      if (!currentControl.parameter) {
        currentControl.parameter = trimmed.replace("name:", "").trim().replace(/^["']|["']$/g, "");
      }
    } else if (trimmed.startsWith("value:")) {
      const raw = trimmed.replace("value:", "").trim();
      const num = parseFloat(raw);
      if (isFinite(num)) currentControl.value = num;
    }
  }

  if (currentControl?.name) controls.push(currentControl as VrcMenuControl);

  return { name: menuName, controls };
}