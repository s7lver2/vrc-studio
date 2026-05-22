// src/components/sidebar/NavItem.tsx
import { LucideIcon } from "lucide-react";
import { forwardRef } from "react";

// Inside your NavItem.tsx component:
interface NavItemProps {
  icon: any;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  compact?: boolean;
  wip?: boolean;
  style?: React.CSSProperties;
}

export const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(
  ({ icon: Icon, label, active, onClick, badge, compact = false, wip = false }, ref) => {
    return (
      <button
        ref={ref}
        onClick={onClick}
        title={compact ? label : undefined}
        className={`
          relative flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-all
          ${active
            ? "bg-zinc-800"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
          }
          ${compact ? "justify-center" : "justify-start"}
        `}
        style={active ? { color: "var(--accent-color)" } : {}}
      >
        <div className="relative">
          <Icon className="h-5 w-5 shrink-0" />
          {compact && badge && badge > 0 && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-zinc-900" />
          )}
          {/* WIP dot in compact mode */}
          {compact && wip && (
            <span className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full bg-amber-500 ring-1 ring-zinc-900" />
          )}
        </div>

        {!compact && (
          <span className="truncate text-sm font-medium">{label}</span>
        )}

        {/* Numeric badge (non-compact) */}
        {!compact && badge && badge > 0 && (
          <span className="ml-auto px-1.5 py-0.5 text-xs font-semibold rounded-full bg-red-500/20 text-red-400 ring-1 ring-red-500/30">
            {badge > 99 ? "99+" : badge}
          </span>
        )}

        {/* WIP chip (non-compact) */}
        {!compact && wip && (
          <span className="ml-auto px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">
            WIP
          </span>
        )}
      </button>
    );
  }
);

NavItem.displayName = "NavItem";