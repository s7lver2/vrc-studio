// src/components/sidebar/NavItem.tsx
import { LucideIcon } from "lucide-react";
import { forwardRef } from "react";

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
  compact?: boolean;
}

export const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(
  ({ icon: Icon, label, active, onClick, badge, compact = false }, ref) => {
    return (
      <button
        ref={ref}
        onClick={onClick}
        title={compact ? label : undefined} // tooltip solo en modo compacto
        className={`
          relative flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-all
          ${active 
            ? "bg-zinc-800 text-violet-400" 
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
          }
          ${compact ? "justify-center" : "justify-start"}
        `}
      >
        <div className="relative">
          <Icon className="h-5 w-5 shrink-0" />
          {/* Badge en modo compacto: punto rojo absoluto */}
          {compact && badge && badge > 0 && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-zinc-900" />
          )}
        </div>

        {/* Etiqueta: oculta en compacto */}
        {!compact && (
          <span className="truncate text-sm font-medium">{label}</span>
        )}

        {/* Badge numérico (solo modo no compacto) */}
        {!compact && badge && badge > 0 && (
          <span className="ml-auto px-1.5 py-0.5 text-xs font-semibold rounded-full bg-red-500/20 text-red-400 ring-1 ring-red-500/30">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    );
  }
);

NavItem.displayName = "NavItem";