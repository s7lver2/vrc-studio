import {
  FileCode2, Image, Box, Play, Layers, Sparkles,
  FileJson, Cpu, File, AudioLines,
} from "lucide-react";

interface Props {
  path: string;
  className?: string;
}

function getExt(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Icono coloreado según la extensión del archivo.
 * Cubre los tipos más comunes en proyectos Unity/VRChat.
 */
export function FileTypeIcon({ path, className = "h-3.5 w-3.5 shrink-0" }: Props) {
  const ext = getExt(path);

  // Scripts C#
  if (ext === "cs")
    return <FileCode2 className={`${className} text-green-400`} />;

  // Imágenes / texturas
  if (["png", "jpg", "jpeg", "tga", "psd", "exr", "hdr", "bmp", "gif", "tiff"].includes(ext))
    return <Image className={`${className} text-purple-400`} />;

  // Materiales
  if (ext === "mat")
    return (
      <span className={`${className} inline-flex items-center justify-center`} title="Material">
        <svg viewBox="0 0 14 14" fill="currentColor" className="text-orange-400 w-full h-full">
          <circle cx="7" cy="7" r="5.5" />
          <circle cx="5" cy="5.5" r="1.5" fill="rgba(0,0,0,0.35)" />
        </svg>
      </span>
    );

  // Prefabs
  if (ext === "prefab")
    return <Box className={`${className} text-blue-400`} />;

  // Animaciones / animators
  if (["anim", "controller", "overridecontroller"].includes(ext))
    return <Play className={`${className} text-yellow-400`} />;

  // Escenas Unity
  if (ext === "unity")
    return <Layers className={`${className} text-cyan-400`} />;

  // Shaders
  if (["shader", "hlsl", "cginc", "glsl", "compute"].includes(ext))
    return <Sparkles className={`${className} text-violet-400`} />;

  // Audio
  if (["wav", "mp3", "ogg", "aiff", "flac"].includes(ext))
    return <AudioLines className={`${className} text-pink-400`} />;

  // Data / config
  if (["json", "xml", "yaml", "yml", "toml"].includes(ext))
    return <FileJson className={`${className} text-amber-400`} />;

  // DLLs / plugins nativos
  if (ext === "dll")
    return <Cpu className={`${className} text-zinc-400`} />;

  // Meta files (muy comunes, los atenuamos)
  if (ext === "meta")
    return <File className={`${className} text-zinc-700`} />;

  // Fallback
  return <File className={`${className} text-zinc-500`} />;
}