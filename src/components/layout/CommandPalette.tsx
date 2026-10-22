import React, { useState, useEffect } from 'react';
import { AppRoute } from './Sidebar';
import { t } from '../../locales/i18n';
import {
  Search,
  LayoutDashboard,
  KeyRound,
  CheckCircle2,
  ListFilter,
  XCircle,
  Cpu,
  Layers,
  Scale,
  FlaskConical,
  MessageSquare,
  SlidersHorizontal,
  Stethoscope,
  History,
  Settings,
  HardDriveDownload,
  X,
} from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (route: AppRoute) => void;
  onOpenAddKey: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onOpenAddKey,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      setQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const actions = [
    { id: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, category: 'Navigation', run: () => onNavigate('dashboard') },
    { id: 'add-key', label: t('nav.addKey'), icon: KeyRound, category: 'Actions', run: onOpenAddKey },
    { id: 'working-keys', label: t('nav.workingKeys'), icon: CheckCircle2, category: 'Navigation', run: () => onNavigate('working-keys') },
    { id: 'all-keys', label: t('nav.allKeys'), icon: ListFilter, category: 'Navigation', run: () => onNavigate('all-keys') },
    { id: 'failed-keys', label: t('nav.failedTests'), icon: XCircle, category: 'Navigation', run: () => onNavigate('failed-keys') },
    { id: 'providers', label: t('nav.providers'), icon: Cpu, category: 'Discovery', run: () => onNavigate('providers') },
    { id: 'models', label: t('nav.models'), icon: Layers, category: 'Discovery', run: () => onNavigate('models') },
    { id: 'compare', label: t('nav.compare'), icon: Scale, category: 'Tools', run: () => onNavigate('compare') },
    { id: 'tester', label: t('nav.apiTester'), icon: FlaskConical, category: 'Tools', run: () => onNavigate('tester') },
    { id: 'chat', label: t('nav.chatPlayground'), icon: MessageSquare, category: 'Tools', run: () => onNavigate('chat') },
    { id: 'custom-providers', label: t('nav.customProviders'), icon: SlidersHorizontal, category: 'Tools', run: () => onNavigate('custom-providers') },
    { id: 'diagnostics', label: t('nav.diagnostics'), icon: Stethoscope, category: 'Tools', run: () => onNavigate('diagnostics') },
    { id: 'history', label: t('nav.history'), icon: History, category: 'Analytics', run: () => onNavigate('history') },
    { id: 'settings', label: t('nav.settings'), icon: Settings, category: 'System', run: () => onNavigate('settings') },
    { id: 'backup', label: t('nav.backup'), icon: HardDriveDownload, category: 'System', run: () => onNavigate('backup') },
  ];

  const filtered = actions.filter(
    a =>
      a.label.toLowerCase().includes(query.toLowerCase()) ||
      a.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-100"
    >
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-zinc-800">
          <Search size={18} className="text-zinc-500 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command or jump to page... (Esc to close)"
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-zinc-300 rounded cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto p-2 divide-y divide-zinc-800/40">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500">
              No matching commands or pages found.
            </div>
          ) : (
            filtered.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    item.run();
                    onClose();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-zinc-800/70 text-left text-xs transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 group-hover:text-blue-400 group-hover:bg-blue-500/10 transition-colors">
                      <Icon size={15} />
                    </div>
                    <span className="font-medium text-zinc-200 group-hover:text-white">
                      {item.label}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {item.category}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 bg-zinc-950/60 border-t border-zinc-800/80 text-[11px] text-zinc-500 flex items-center justify-between font-mono">
          <span>Navigate with arrows or click</span>
          <span>ESC to exit</span>
        </div>
      </div>
    </div>
  );
};
