export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  fontSize: 'small' | 'default' | 'large' | 'xlarge';
  language: 'en' | 'ar';
  direction: 'auto' | 'ltr' | 'rtl';
  density: 'compact' | 'comfortable' | 'spacious';
  animationsEnabled: boolean;
  developerMode: boolean;
  confirmDestructiveActions: boolean;
  healthCheckIntervalHours: number;
  healthMonitoringEnabled: boolean;
  scheduledModelWatchEnabled: boolean; // 07_P3 §0A.4 opt-in scheduled Model Watch (off by default)
  modelWatchIntervalHours: number;     // 07_P3 §0A.4 default 24 h, minimum 6 h
  useSystemProxy: boolean;             // 07_P3 §0A.2 "Use system proxy" (off by default)
  quitOnLastWindowClosed: boolean;     // 07_P3 §13 "Quit when the last window closes" (default off on macOS)
  autoClearClipboardSeconds: number;
  latencyThresholds: {
    fastMs: number;
    normalMs: number;
  };
  fallbackAttemptsCount: number; // 1-3, default 2
  dailyGenerationCapPerKey: number; // §13A Budget Guard default 20
  dailyGenerationCapGlobal: number; // §13A Budget Guard default 100
  dailyTier0CapGlobal: number;      // §13A separate Tier-0 list cap default 300
  saveChatHistory: boolean;         // §13A Browser tier defaults to OFF (false)
}

export const defaultSettings: AppSettings = {
  theme: 'dark',
  fontSize: 'default',
  language: 'en',
  direction: 'auto',
  density: 'comfortable',
  animationsEnabled: true,
  developerMode: false,
  confirmDestructiveActions: true,
  healthCheckIntervalHours: 6,
  healthMonitoringEnabled: false,
  scheduledModelWatchEnabled: false,
  modelWatchIntervalHours: 24,
  useSystemProxy: false,
  quitOnLastWindowClosed: false,
  autoClearClipboardSeconds: 30,
  latencyThresholds: {
    fastMs: 1000,
    normalMs: 3000,
  },
  fallbackAttemptsCount: 2,
  dailyGenerationCapPerKey: 20,
  dailyGenerationCapGlobal: 100,
  dailyTier0CapGlobal: 300,
  saveChatHistory: false,
};
