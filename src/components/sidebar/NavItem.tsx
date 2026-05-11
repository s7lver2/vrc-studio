import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
 
interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}
 
export function NavItem({ icon: Icon, label, active, badge, onClick }: NavItemProps) {
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
      <span className="flex items-center gap-2 flex-1">
        {label}
        {badge !== undefined && badge > 0 && (
          <span
            className={`ml-auto text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 ${
              active
                ? "bg-white/20 text-white"
                : "bg-red-600 text-white"
            }`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
    </button>
  );
}