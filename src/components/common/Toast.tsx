import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(toast => {
        const bg = {
          success: 'bg-emerald-950/90 border-emerald-500/30 text-emerald-200',
          error: 'bg-rose-950/90 border-rose-500/30 text-rose-200',
          warning: 'bg-amber-950/90 border-amber-500/30 text-amber-200',
          info: 'bg-zinc-900/95 border-zinc-700/50 text-zinc-200',
        }[toast.type];

        const Icon = {
          success: CheckCircle2,
          error: XCircle,
          warning: AlertTriangle,
          info: Info,
        }[toast.type];

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 border rounded-xl shadow-xl backdrop-blur-md text-xs animate-in slide-in-from-bottom-2 duration-150 ${bg}`}
          >
            <div className="flex items-center gap-2.5">
              <Icon size={16} className="shrink-0" />
              <span>{toast.message}</span>
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="p-1 hover:opacity-75 rounded transition-opacity cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
