// src/components/vcs/FileTypeIcon.tsx
import { FileCode2, FileImage, FileText, File, FileJson } from "lucide-react";

interface Props {
  path: string;
  className?: string;
}

export function FileTypeIcon({ path, className }: Props) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";

  if (["ts", "tsx", "js", "jsx", "rs", "go", "py", "cs", "cpp", "c", "h"].includes(ext)) {
    return <FileCode2 className={className} />;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "tga", "psd"].includes(ext)) {
    return <FileImage className={className} />;
  }
  if (["json", "toml", "yaml", "yml"].includes(ext)) {
    return <FileJson className={className} />;
  }
  if (["md", "txt", "log"].includes(ext)) {
    return <FileText className={className} />;
  }
  return <File className={className} />;
}