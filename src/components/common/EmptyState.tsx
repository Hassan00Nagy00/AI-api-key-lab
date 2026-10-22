import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-900/20">
      <div className="p-3 mb-4 rounded-xl bg-zinc-800/50 border border-zinc-700/50 text-zinc-400">
        <Icon size={28} />
      </div>
      <h3 className="text-base font-semibold text-zinc-200 mb-1">{title}</h3>
      <p className="text-xs text-zinc-400 max-w-sm mb-6 leading-relaxed">{description}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
        >
          {action.icon && <action.icon size={14} />}
          <span>{action.label}</span>
        </button>
      )}
    </div>
  );
};
