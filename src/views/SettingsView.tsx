import React, { useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { StorageService } from '../services/storage';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { t } from '../locales/i18n';
import {
  Settings,
  Lock,
  Unlock,
  ShieldAlert,
  Moon,
  Sun,
  Laptop,
  CheckCircle2,
  Trash2,
  Activity,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    isVaultEncrypted,
    isVaultUnlocked,
    refreshVaultStatus,
  } = useSettings();

  const [passphrase, setPassphrase] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseSuccess, setPassphraseSuccess] = useState<string | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

  const handleUnlockOrSetPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim() || passphrase.length < 8) {
      setPassphraseError('Passphrase must be at least 8 characters long');
      return;
    }

    try {
      const success = await StorageService.unlockVault(passphrase.trim());
      if (success) {
        setPassphraseSuccess('Vault unlocked successfully with AES-256-GCM encryption.');
        setPassphraseError(null);
        setPassphrase('');
        refreshVaultStatus();
        setTimeout(() => setPassphraseSuccess(null), 3500);
      } else {
        setPassphraseError('Incorrect passphrase or corrupted encrypted vault.');
      }
    } catch {
      setPassphraseError('Failed to initialize or unlock storage vault.');
    }
  };

  const handleLockVault = () => {
    StorageService.lockVault();
    refreshVaultStatus();
    setPassphraseSuccess('Vault locked. Secrets purged from memory.');
    setTimeout(() => setPassphraseSuccess(null), 3000);
  };

  const handleClearAll = async () => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const res = await window.electronAPI.data.eraseAll();
      if (!res.erased) return;
    }
    StorageService.clearAllData();
    window.location.reload();
  };

  const handleClearLogs = async () => {
    if (typeof window !== 'undefined' && window.electronAPI?.data.clearLogs) {
      await window.electronAPI.data.clearLogs();
    }
    setPassphraseSuccess('Sanitized diagnostic logs cleared.');
    setTimeout(() => setPassphraseSuccess(null), 3000);
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <Settings size={20} className="text-blue-400" />
          <span>{t('settings.title')}</span>
        </h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          {t('settings.subtitle')}
        </p>
      </div>

      {/* Security & Vault Section per §6 */}
      <section className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl ${
                isVaultEncrypted && isVaultUnlocked
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}
            >
              {isVaultEncrypted && isVaultUnlocked ? <Unlock size={18} /> : <Lock size={18} />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                {t('settings.security')}
              </h3>
              <p className="text-xs text-zinc-400">
                {t('settings.vaultPassphraseHelp')}
              </p>
            </div>
          </div>

          {isVaultEncrypted && isVaultUnlocked && (
            <button
              type="button"
              onClick={handleLockVault}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors cursor-pointer"
            >
              {t('settings.lockVault')}
            </button>
          )}
        </div>

        {/* Persistent Honesty Banner per §6 */}
        {!isVaultEncrypted ? (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-start gap-2.5">
            <ShieldAlert size={18} className="shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="font-semibold text-amber-200">
                {t('settings.vaultNoPassword')}
              </p>
              <p className="text-[11px] text-zinc-400 mt-1">
                To protect your credentials with local WebCrypto AES-256-GCM encryption, enter a master passphrase below.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 size={16} />
            <span>
              {isVaultUnlocked ? t('settings.vaultUnlocked') : t('settings.vaultLocked')}
            </span>
          </div>
        )}

        {passphraseSuccess && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300">
            {passphraseSuccess}
          </div>
        )}

        {passphraseError && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300">
            {passphraseError}
          </div>
        )}

        {(!isVaultEncrypted || !isVaultUnlocked) && (
          <form onSubmit={handleUnlockOrSetPassphrase} className="flex gap-2 pt-2">
            <input
              type="password"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              placeholder="Enter master passphrase (min 8 chars)..."
              className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 font-mono"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all cursor-pointer shadow-sm shadow-blue-500/20"
            >
              {isVaultEncrypted ? t('settings.unlockVault') : t('settings.setPassphrase')}
            </button>
          </form>
        )}
      </section>

      {/* Appearance Section */}
      <section className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-4">
        <h3 className="text-sm font-semibold text-zinc-100">
          {t('settings.appearance')}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Theme */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">
              {t('settings.theme')}
            </label>
            <div className="grid grid-cols-3 gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
              <button
                type="button"
                onClick={() => updateSettings({ theme: 'dark' })}
                className={`py-1.5 flex items-center justify-center gap-1 rounded-lg transition-colors cursor-pointer ${
                  settings.theme === 'dark' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Moon size={12} />
                <span>Dark</span>
              </button>
              <button
                type="button"
                onClick={() => updateSettings({ theme: 'light' })}
                className={`py-1.5 flex items-center justify-center gap-1 rounded-lg transition-colors cursor-pointer ${
                  settings.theme === 'light' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sun size={12} />
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => updateSettings({ theme: 'system' })}
                className={`py-1.5 flex items-center justify-center gap-1 rounded-lg transition-colors cursor-pointer ${
                  settings.theme === 'system' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Laptop size={12} />
                <span>Auto</span>
              </button>
            </div>
          </div>

          {/* Font Size */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">
              {t('settings.fontSize')}
            </label>
            <select
              value={settings.fontSize}
              onChange={e => updateSettings({ fontSize: e.target.value as any })}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="small">Small (14px)</option>
              <option value="default">Default macOS (15px)</option>
              <option value="large">Large (17px)</option>
              <option value="xlarge">Extra Large (19px)</option>
            </select>
          </div>

          {/* Language & RTL */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">
              {t('settings.language')}
            </label>
            <select
              value={settings.language}
              onChange={e => updateSettings({ language: e.target.value as any })}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="en">English (LTR)</option>
              <option value="ar">العربية (RTL)</option>
            </select>
          </div>
        </div>
      </section>

      {/* Budget Guard & Cost-Safety Caps (§13A) */}
      <section className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Budget Guard & Cost-Safety Caps
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Protects free/trial quotas and prevents accidental paid model spend. When a cap is reached, scheduled checks skip and manual tests require confirmation.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Daily Generation Cap (Per Key)
            </label>
            <input
              type="number"
              min={1}
              max={10000}
              value={settings.dailyGenerationCapPerKey ?? 20}
              onChange={e =>
                updateSettings({ dailyGenerationCapPerKey: Math.max(1, Number(e.target.value) || 20) })
              }
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Daily Generation Cap (Global)
            </label>
            <input
              type="number"
              min={1}
              max={50000}
              value={settings.dailyGenerationCapGlobal ?? 100}
              onChange={e =>
                updateSettings({ dailyGenerationCapGlobal: Math.max(1, Number(e.target.value) || 100) })
              }
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Daily Tier-0 Model List Cap (Global)
            </label>
            <input
              type="number"
              min={1}
              max={50000}
              value={settings.dailyTier0CapGlobal ?? 300}
              onChange={e =>
                updateSettings({ dailyTier0CapGlobal: Math.max(1, Number(e.target.value) || 300) })
              }
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Chat History Persistence Toggle (§12 & §13A) */}
        <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-4">
          <div>
            <span className="text-xs font-semibold text-zinc-200 block">
              Save Chat History Locally
            </span>
            <span className="text-[11px] text-zinc-400">
              Default OFF in the browser tier to avoid persisting sensitive prompts in localStorage unless explicitly enabled.
            </span>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(settings.saveChatHistory)}
              onChange={e => updateSettings({ saveChatHistory: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-blue-600 transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
          </label>
        </div>
      </section>

      {/* Unified Scheduler, Proxy & Desktop Behavior per 07_P3 §0A.2, §0A.4, §13 */}
      <section className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-blue-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              {t('settings.healthCheck')} & Scheduled Model Watch
            </h3>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
            {t('settings.desktopOnly')}
          </span>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Health checks and opt-in scheduled Model Watch (Tier 0 only, 1 key per provider, default 24 h, min 6 h) share one unified scheduler that runs only while the app is open, is off by default, obeys the Budget Guard, and skips expired and unauthorized keys.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-800/80">
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
            <div>
              <span className="text-xs font-semibold text-zinc-200 block">
                Scheduled Health Checks
              </span>
              <span className="text-[11px] text-zinc-400">
                Off by default; runs only while app is open ({settings.healthCheckIntervalHours ?? 6}h interval).
              </span>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(settings.healthMonitoringEnabled)}
                onChange={e => updateSettings({ healthMonitoringEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-blue-600 transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
            <div>
              <span className="text-xs font-semibold text-zinc-200 block">
                Scheduled Model Watch (Tier 0 Only)
              </span>
              <span className="text-[11px] text-zinc-400">
                One key per provider, default 24 h (min 6 h). Currently {Math.max(6, settings.modelWatchIntervalHours ?? 24)}h.
              </span>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(settings.scheduledModelWatchEnabled)}
                onChange={e => updateSettings({ scheduledModelWatchEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-blue-600 transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-800/80">
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
            <div>
              <span className="text-xs font-semibold text-zinc-200 block">
                Use System Proxy (macOS Desktop)
              </span>
              <span className="text-[11px] text-zinc-400">
                Routes via undici ProxyAgent (HTTPS & approved hosts only; connect-time IP guarantee is weaker in proxy mode).
              </span>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(settings.useSystemProxy)}
                onChange={e => updateSettings({ useSystemProxy: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-blue-600 transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
            <div>
              <span className="text-xs font-semibold text-zinc-200 block">
                Quit when the last window closes
              </span>
              <span className="text-[11px] text-zinc-400">
                Default OFF on macOS (keeps app active in Dock until Cmd+Q).
              </span>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(settings.quitOnLastWindowClosed)}
                onChange={e => updateSettings({ quitOnLastWindowClosed: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-blue-600 transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
            </label>
          </div>
        </div>
      </section>

      {/* Danger Zone */}
      <section className="p-6 rounded-2xl border border-rose-500/20 bg-rose-950/10 backdrop-blur-sm space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-rose-300">
              Clear All Stored Data
            </h3>
            <p className="text-xs text-zinc-400">
              Permanently purges all API keys, custom providers, test history, and vault keys.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearLogs}
              className="px-3.5 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer"
            >
              Clear Logs
            </button>
            <button
              type="button"
              onClick={() => setShowClearAllConfirm(true)}
              className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl transition-colors cursor-pointer"
            >
              Erase All Data…
            </button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        isOpen={showClearAllConfirm}
        onClose={() => setShowClearAllConfirm(false)}
        onConfirm={handleClearAll}
        title="Permanently Delete All Data?"
        description="This action cannot be undone. All stored API keys, history, settings, and encryption keys will be wiped."
        itemsToRemove={['All API key records', 'All secret keys and vaults', 'All test history', 'All custom providers']}
        confirmLabel="Wipe Everything"
      />
    </div>
  );
};
