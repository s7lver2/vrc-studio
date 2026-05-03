import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
 
interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}
 
export function NavItem({ icon: Icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
        active
          ? "bg-red-600 text-white"
          : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
      )}
    >
      <Icon size={18} strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}
 