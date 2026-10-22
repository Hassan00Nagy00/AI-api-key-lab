import React from 'react';
import { AppRoute } from './Sidebar';
import { t } from '../../locales/i18n';
import { Lock, Unlock, AlertTriangle, Command, Languages, Plus, Menu } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

interface TopbarProps {
  currentRoute: AppRoute;
  onOpenAddKey: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  onToggleMobileMenu?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  currentRoute,
  onOpenAddKey,
  onOpenCommandPalette,
  onOpenSettings,
  onToggleMobileMenu,
}) => {
  const { settings, updateSettings, isVaultEncrypted, isVaultUnlocked } = useSettings();

  const getRouteTitle = (route: AppRoute) => {
    switch (route) {
      case 'dashboard':
        return t('nav.dashboard');
      case 'add-key':
        return t('nav.addKey');
      case 'working-keys':
        return t('nav.workingKeys');
      case 'all-keys':
        return t('nav.allKeys');
      case 'failed-keys':
        return t('nav.failedTests');
      case 'providers':
        return t('nav.providers');
      case 'models':
        return t('nav.models');
      case 'compare':
        return t('nav.compare');
      case 'tester':
        return t('nav.apiTester');
      case 'chat':
        return t('nav.chatPlayground');
      case 'custom-providers':
        return t('nav.customProviders');
      case 'diagnostics':
        return t('nav.diagnostics');
      case 'history':
        return t('nav.history');
      case 'settings':
        return t('nav.settings');
      case 'backup':
        return t('nav.backup');
      default:
        return 'AI API Key Lab';
    }
  };

  const toggleLanguage = () => {
    const nextLang = settings.language === 'en' ? 'ar' : 'en';
    updateSettings({ language: nextLang });
  };

  return (
    <header className="h-14 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-3 sm:px-6 flex items-center justify-between select-none shrink-0 z-10">
      {/* Route Breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        {onToggleMobileMenu && (
          <button
            type="button"
            onClick={onToggleMobileMenu}
            aria-label="Toggle mobile menu"
            className="md:hidden p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <Menu size={18} />
          </button>
        )}
        <span className="text-xs font-semibold text-zinc-100 truncate">{getRouteTitle(currentRoute)}</span>
      </div>

      {/* Right Tools: Vault Status, Language, Search */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* Security Vault Indicator per §6 */}
        {isVaultEncrypted ? (
          <button
            type="button"
            onClick={onOpenSettings}
            title={isVaultUnlocked ? 'Vault is Unlocked & AES-256 Encrypted' : 'Vault is Locked'}
            className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
              isVaultUnlocked
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}
          >
            {isVaultUnlocked ? <Unlock size={11} /> : <Lock size={11} />}
            <span className="hidden sm:inline">{isVaultUnlocked ? 'Vault Unlocked' : 'Vault Locked'}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenSettings}
            title="No passphrase set. Secrets stored unencrypted in browser storage."
            className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors cursor-pointer"
          >
            <AlertTriangle size={11} />
            <span className="hidden sm:inline">Not Encrypted</span>
          </button>
        )}

        {/* Language Switcher */}
        <button
          type="button"
          onClick={toggleLanguage}
          title="Switch Language (English / العربية)"
          className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
        >
          <Languages size={13} />
          <span className="font-medium text-[11px]">{settings.language === 'en' ? 'AR · العربية' : 'EN · English'}</span>
        </button>

        {/* Command Palette Trigger */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Open Command Palette"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-xl text-xs transition-colors cursor-pointer"
        >
          <Command size={13} />
          <span className="text-[11px] font-mono">K</span>
        </button>

        {/* Quick Add Key */}
        <button
          type="button"
          onClick={onOpenAddKey}
          className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
        >
          <Plus size={13} />
          <span className="hidden sm:inline">{t('dashboard.addKeyCta')}</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>
    </header>
  );
};
