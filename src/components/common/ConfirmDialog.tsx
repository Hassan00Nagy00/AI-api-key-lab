import React from 'react';
import { Modal } from './Modal';
import { AlertTriangle } from 'lucide-react';
import { t } from '../../locales/i18n';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  itemsToRemove?: string[];
  confirmLabel?: string;
  isDestructive?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  itemsToRemove,
  confirmLabel = t('common.confirm'),
  isDestructive = true,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          <div className="text-xs text-zinc-300">
            <p className="font-medium text-red-300 mb-1">{description}</p>
            {itemsToRemove && itemsToRemove.length > 0 && (
              <div className="mt-2 text-zinc-400">
                <span className="text-zinc-300 font-medium">This will permanently remove:</span>
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  {itemsToRemove.map((item, i) => (
                    <li key={i} className="text-zinc-400">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors cursor-pointer"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              isDestructive
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
};
