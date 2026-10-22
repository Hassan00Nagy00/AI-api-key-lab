import { useState, useEffect, useCallback } from 'react';
import { AppSettings, defaultSettings } from '../types/settings';
import { StorageService } from '../services/storage';
import { setLanguage, getLanguage, getDirection } from '../locales/i18n';

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(() => StorageService.getSettings());
  const [isVaultEncrypted, setIsVaultEncrypted] = useState<boolean>(() => StorageService.isVaultEncrypted());
  const [isVaultUnlocked, setIsVaultUnlocked] = useState<boolean>(() => StorageService.isUnlocked());

  const applySettingsToDom = useCallback((s: AppSettings) => {
    // 1. Language & Direction
    setLanguage(s.language);
    const dir = s.direction === 'auto' ? getDirection(s.language) : s.direction;
    document.documentElement.dir = dir;
    document.documentElement.lang = s.language;

    // 2. Theme
    if (s.theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else if (s.theme === 'light') {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }
    }

    // 3. Font Size
    const root = document.documentElement;
    if (s.fontSize === 'small') {
      root.style.fontSize = '14px';
    } else if (s.fontSize === 'large') {
      root.style.fontSize = '17px';
    } else if (s.fontSize === 'xlarge') {
      root.style.fontSize = '19px';
    } else {
      root.style.fontSize = '15px'; // default macOS clean
    }
  }, []);

  useEffect(() => {
    applySettingsToDom(settings);
  }, [settings, applySettingsToDom]);

  useEffect(() => {
    const handleSync = () => {
      const latest = StorageService.getSettings();
      setSettingsState(latest);
      applySettingsToDom(latest);
      setIsVaultEncrypted(StorageService.isVaultEncrypted());
      setIsVaultUnlocked(StorageService.isUnlocked());
    };
    window.addEventListener('ai-lab-settings-changed', handleSync);
    return () => window.removeEventListener('ai-lab-settings-changed', handleSync);
  }, [applySettingsToDom]);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettingsState(updated);
    StorageService.saveSettings(updated);
    applySettingsToDom(updated);
    window.dispatchEvent(new Event('ai-lab-settings-changed'));
  };

  const refreshVaultStatus = () => {
    setIsVaultEncrypted(StorageService.isVaultEncrypted());
    setIsVaultUnlocked(StorageService.isUnlocked());
    window.dispatchEvent(new Event('ai-lab-settings-changed'));
  };

  return {
    settings,
    updateSettings,
    isVaultEncrypted,
    isVaultUnlocked,
    refreshVaultStatus,
  };
}
