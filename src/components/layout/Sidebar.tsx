import React from 'react';
import {
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
  Command,
  HelpCircle,
  Sparkles,
  ShieldCheck,
  FolderSearch,
  Server,
} from 'lucide-react';
import { t } from '../../locales/i18n';

export type AppRoute =
  | 'dashboard'
  | 'add-key'
  | 'working-keys'
  | 'all-keys'
  | 'failed-keys'
  | 'providers'
  | 'models'
  | 'compare'
  | 'tester'
  | 'chat'
  | 'custom-providers'
  | 'diagnostics'
  | 'history'
  | 'signed-registry'
  | 'leak-hunter'
  | 'local-gateway'
  | 'settings'
  | 'backup';

interface SidebarProps {
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onOpenShortcuts: () => void;
  onOpenAbout: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentRoute,
  onNavigate,
  onOpenShortcuts,
  onOpenAbout,
  isMobileOpen,
  onCloseMobile,
}) => {
  const mainNavItems = [
    { id: 'dashboard' as AppRoute, label: t('nav.dashboard'), icon: LayoutDashboard },
    { id: 'add-key' as AppRoute, label: t('nav.addKey'), icon: KeyRound, isCta: true },
    { id: 'working-keys' as AppRoute, label: t('nav.workingKeys'), icon: CheckCircle2, badge: 'verified' },
    { id: 'all-keys' as AppRoute, label: t('nav.allKeys'), icon: ListFilter },
    { id: 'failed-keys' as AppRoute, label: t('nav.failedTests'), icon: XCircle },
  ];

  const toolsNavItems = [
    { id: 'providers' as AppRoute, label: t('nav.providers'), icon: Cpu },
    { id: 'models' as AppRoute, label: t('nav.models'), icon: Layers },
    { id: 'compare' as AppRoute, label: t('nav.compare'), icon: Scale },
    { id: 'tester' as AppRoute, label: t('nav.apiTester'), icon: FlaskConical },
    { id: 'chat' as AppRoute, label: t('nav.chatPlayground'), icon: MessageSquare },
    { id: 'custom-providers' as AppRoute, label: t('nav.customProviders'), icon: SlidersHorizontal },
    { id: 'diagnostics' as AppRoute, label: t('nav.diagnostics'), icon: Stethoscope },
    { id: 'history' as AppRoute, label: t('nav.history'), icon: History },
  ];

  const systemNavItems = [
    { id: 'settings' as AppRoute, label: t('nav.settings'), icon: Settings },
    { id: 'backup' as AppRoute, label: t('nav.backup'), icon: HardDriveDownload },
  ];


  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        className={`${
          isMobileOpen
            ? 'fixed inset-y-0 left-0 z-50 flex w-64 shadow-2xl'
            : 'hidden md:flex w-64'
        } bg-zinc-950 border-r border-zinc-800/80 flex-col h-screen select-none shrink-0 transition-all duration-200`}
      >
        {/* Brand Header */}
        <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Sparkles size={16} />
            </div>
            <div>
              <h1 className="text-sm font-bold text-zinc-100 tracking-tight">AI API Key Lab</h1>
              <span className="text-[10px] text-zinc-500 font-mono">v1.0.0 · macOS</span>
            </div>
          </div>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="md:hidden p-1.5 text-zinc-400 hover:text-white rounded-lg cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {/* Keys Management */}
        <div className="space-y-1">
          <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Keys & Workflows
          </span>
          <div className="mt-1 space-y-0.5">
            {mainNavItems.map(item => {
              const active = currentRoute === item.id;
              const Icon = item.icon;

              if (item.isCta) {
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className="w-full mt-1.5 mb-2 flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
                  >
                    <Icon size={14} />
                    <span>{item.label}</span>
                  </button>
                );
              }

              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-zinc-800/90 text-white font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon size={14} className={active ? 'text-blue-400' : 'text-zinc-400'} />
                    <span>{item.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Discovery & Tools */}
        <div className="space-y-1">
          <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Discovery & Tools
          </span>
          <div className="mt-1 space-y-0.5">
            {toolsNavItems.map(item => {
              const active = currentRoute === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-zinc-800/90 text-white font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon size={14} className={active ? 'text-blue-400' : 'text-zinc-400'} />
                    <span>{item.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* System & Config */}
        <div className="space-y-1">
          <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            System
          </span>
          <div className="mt-1 space-y-0.5">
            {systemNavItems.map(item => {
              const active = currentRoute === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-zinc-800/90 text-white font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon size={14} className={active ? 'text-blue-400' : 'text-zinc-400'} />
                    <span>{item.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom utility triggers (dialogs / popovers, not routes per §3) */}
      <div className="p-3 border-t border-zinc-800/80 bg-zinc-950/80 flex items-center justify-between text-xs text-zinc-400">
        <button
          type="button"
          onClick={onOpenShortcuts}
          title={t('nav.shortcuts')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:text-zinc-200 hover:bg-zinc-900 transition-colors cursor-pointer"
        >
          <Command size={13} />
          <span className="text-[11px] font-mono">K</span>
        </button>

        <button
          type="button"
          onClick={onOpenAbout}
          title={t('nav.about')}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer"
        >
          <HelpCircle size={15} />
        </button>
      </div>
    </aside>
    </>
  );
};
