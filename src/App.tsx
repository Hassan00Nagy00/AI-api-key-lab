/**
 * AI API Key Lab — Main Application Entry Point
 * @license Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Sidebar, AppRoute } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { CommandPalette } from './components/layout/CommandPalette';
import { ToastContainer, ToastMessage } from './components/common/Toast';
import { Modal } from './components/common/Modal';
import { ConfirmDialog } from './components/common/ConfirmDialog';

import { useKeys } from './hooks/useKeys';
import { useProviders } from './hooks/useProviders';
import { useSettings } from './hooks/useSettings';
import { useShortcuts } from './hooks/useShortcuts';

import { ApiKeyRecord } from './types/key';
import { TestResult, TestLadderStage } from './types/test';
import { ApiTestService } from './services/testService';
import { StorageService } from './services/storage';

import { DashboardView } from './views/DashboardView';
import { WorkingKeysView } from './views/WorkingKeysView';
import { AllKeysView } from './views/AllKeysView';
import { FailedKeysView } from './views/FailedKeysView';
import { ProvidersView } from './views/ProvidersView';
import { ModelsView } from './views/ModelsView';
import { CompareView } from './views/CompareView';
import { ApiTesterView } from './views/ApiTesterView';
import { ChatPlaygroundView } from './views/ChatPlaygroundView';
import { CustomProvidersView } from './views/CustomProvidersView';
import { DiagnosticsView } from './views/DiagnosticsView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';
import { BackupView } from './views/BackupView';
import { SecurityAddonsView } from './views/SecurityAddonsView';

import { AddKeyModal } from './components/keys/AddKeyModal';
import { EditKeyModal } from './components/keys/EditKeyModal';
import { ConfigurationGeneratorModal } from './components/config/ConfigurationGenerator';
import { TestProgressModal } from './components/testing/TestProgressModal';
import { ProviderRegistry } from './services/providerRegistry';
import { t } from './locales/i18n';

function parsePathToRoute(pathname: string): { route: AppRoute; openAddKey?: boolean; keyId?: string; providerId?: string } {
  const clean = pathname.replace(/\/+$/, '') || '/dashboard';
  if (clean === '/' || clean === '/dashboard') return { route: 'dashboard' };
  if (clean === '/keys') return { route: 'all-keys' };
  if (clean === '/keys/add') return { route: 'all-keys', openAddKey: true };
  if (clean === '/keys/working') return { route: 'working-keys' };
  if (clean === '/keys/failed') return { route: 'failed-keys' };
  if (clean.startsWith('/keys/')) return { route: 'all-keys', keyId: clean.slice(6) };
  if (clean === '/providers') return { route: 'providers' };
  if (clean.startsWith('/providers/')) return { route: 'providers', providerId: clean.slice(11) };
  if (clean === '/models') return { route: 'models' };
  if (clean === '/compare') return { route: 'compare' };
  if (clean === '/tester') return { route: 'tester' };
  if (clean === '/chat') return { route: 'chat' };
  if (clean === '/custom-providers') return { route: 'custom-providers' };
  if (clean === '/diagnostics') return { route: 'diagnostics' };
  if (clean === '/history') return { route: 'history' };
  if (clean === '/signed-registry') return { route: 'signed-registry' };
  if (clean === '/leak-hunter') return { route: 'leak-hunter' };
  if (clean === '/local-gateway') return { route: 'local-gateway' };
  if (clean === '/settings') return { route: 'settings' };
  if (clean === '/settings/backup' || clean === '/backup') return { route: 'backup' };
  return { route: 'dashboard' };
}

function routeToPath(route: AppRoute): string {
  switch (route) {
    case 'dashboard':
      return '/dashboard';
    case 'all-keys':
      return '/keys';
    case 'add-key':
      return '/keys/add';
    case 'working-keys':
      return '/keys/working';
    case 'failed-keys':
      return '/keys/failed';
    case 'providers':
      return '/providers';
    case 'models':
      return '/models';
    case 'compare':
      return '/compare';
    case 'tester':
      return '/tester';
    case 'chat':
      return '/chat';
    case 'custom-providers':
      return '/custom-providers';
    case 'diagnostics':
      return '/diagnostics';
    case 'history':
      return '/history';
    case 'signed-registry':
      return '/signed-registry';
    case 'leak-hunter':
      return '/leak-hunter';
    case 'local-gateway':
      return '/local-gateway';
    case 'settings':
      return '/settings';
    case 'backup':
      return '/settings/backup';
    default:
      return '/dashboard';
  }
}

export default function App() {
  const initialParsed = parsePathToRoute(window.location.pathname);
  const [currentRoute, setCurrentRouteState] = useState<AppRoute>(initialParsed.route);
  const { keys, refreshKeys, addKey, updateKey, deleteKey, markUntested } = useKeys();
  const { providers, refreshProviders } = useProviders();
  const { settings } = useSettings();

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  // Modals state
  const [isAddKeyOpen, setIsAddKeyOpen] = useState(Boolean(initialParsed.openAddKey));
  const [addKeyInitialProviderId, setAddKeyInitialProviderId] = useState<string | undefined>(undefined);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  // Key-specific modals
  const [editingKey, setEditingKey] = useState<ApiKeyRecord | null>(null);
  const [configKey, setConfigKey] = useState<ApiKeyRecord | null>(null);
  const [deletingKey, setDeletingKey] = useState<ApiKeyRecord | null>(null);

  const setCurrentRoute = useCallback((route: AppRoute) => {
    setCurrentRouteState(route);
    const targetPath = routeToPath(route);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ route }, '', targetPath);
    }
  }, []);

  // Sync browser back/forward navigation and /keys/:id deep links
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parsePathToRoute(window.location.pathname);
      setCurrentRouteState(parsed.route);
      if (parsed.openAddKey) {
        setIsAddKeyOpen(true);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const parsed = parsePathToRoute(window.location.pathname);
    if (parsed.keyId && keys.length > 0) {
      const found = keys.find(k => k.id === parsed.keyId);
      if (found) setEditingKey(found);
    }
  }, [keys]);

  // Subscribe to native macOS menu navigation and actions when running in Electron
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return;

    const unsubNav = window.electronAPI.app.onNavigate((pathOrRoute) => {
      const parsed = parsePathToRoute(pathOrRoute);
      setCurrentRoute(parsed.route);
    });

    const unsubAction = window.electronAPI.app.onMenuAction((action) => {
      if (action === 'new-key') setIsAddKeyOpen(true);
      else if (action === 'command-palette') setIsCommandPaletteOpen(true);
      else if (action === 'open-about') setIsAboutOpen(true);
      else if (action === 'open-shortcuts') setIsShortcutsHelpOpen(true);
    });

    return () => {
      unsubNav();
      unsubAction();
    };
  }, [setCurrentRoute]);

  // Active testing state
  const [testingStage, setTestingStage] = useState<TestLadderStage>('idle');
  const [testingMessage, setTestingMessage] = useState('');
  const [testingActiveModel, setTestingActiveModel] = useState<string | undefined>();
  const [testingIsFallback, setTestingIsFallback] = useState(false);
  const [activeTestResult, setActiveTestResult] = useState<TestResult | null>(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [activeTestKey, setActiveTestKey] = useState<ApiKeyRecord | null>(null);

  // Keyboard shortcuts
  useShortcuts({
    onOpenCommandPalette: () => setIsCommandPaletteOpen(true),
    onOpenAddKey: () => setIsAddKeyOpen(true),
    onOpenSettings: () => setCurrentRoute('settings'),
    onOpenShortcutsHelp: () => setIsShortcutsHelpOpen(true),
    onEscape: () => {
      setIsCommandPaletteOpen(false);
      setIsAddKeyOpen(false);
      setIsShortcutsHelpOpen(false);
      setIsAboutOpen(false);
      setEditingKey(null);
      setConfigKey(null);
      setDeletingKey(null);
    },
    onNavigate: (route: string) => {
      if (route === 'dashboard') setCurrentRoute('dashboard');
      else if (route === 'working') setCurrentRoute('working-keys');
      else if (route === 'keys') setCurrentRoute('all-keys');
      else if (route === 'chat') setCurrentRoute('chat');
      else if (route === 'providers') setCurrentRoute('providers');
      else if (route === 'models') setCurrentRoute('models');
      else if (route === 'tester') setCurrentRoute('tester');
      else if (route === 'history') setCurrentRoute('history');
      else if (route === 'settings') setCurrentRoute('settings');
    },
  });

  // Execute test ladder on a key
  const handleExecuteTest = async (key: ApiKeyRecord, targetModelId?: string) => {
    const provider = ProviderRegistry.get(key.providerId);
    if (!provider) {
      showToast(`Provider "${key.providerId}" not found.`, 'error');
      return;
    }

    setActiveTestKey(key);
    setActiveTestResult(null);
    setIsTestModalOpen(true);
    setTestingStage('detecting-provider');
    setTestingMessage('Initializing test ladder...');

    try {
      const result = await ApiTestService.runVerificationLadder(key, provider, {
        targetModelId,
        onProgress: p => {
          setTestingStage(p.stage);
          setTestingMessage(p.message);
          setTestingActiveModel(p.activeModel);
          setTestingIsFallback(Boolean(p.isFallback));
        },
      });

      setActiveTestResult(result);
      refreshKeys();

      if (result.status === 'working') {
        showToast(`API Key verified working on model ${result.model}!`, 'success');
      } else {
        showToast(`Test failed: ${result.errorMessage || result.status}`, 'warning');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown execution failure';
      setTestingStage('failed');
      setTestingMessage(errMsg);
      showToast(errMsg, 'error');
    }
  };

  const handleAddKeySubmit = async (params: {
    label: string;
    providerId: string;
    secret: string;
    customBaseUrl?: string;
    selectedModel?: string;
    expiresAt?: string;
    expiryNote?: string;
  }) => {
    const newKey = await addKey(params);
    showToast('API Key saved to vault.', 'success');
    // Automatically trigger verification test
    handleExecuteTest(newKey, params.selectedModel);
  };

  const handleOpenChatWithKey = (key: ApiKeyRecord) => {
    setCurrentRoute('chat');
  };

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const history = StorageService.getHistory();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans antialiased">
      {/* Sidebar */}
      <Sidebar
        currentRoute={currentRoute}
        onNavigate={route => {
          setIsMobileMenuOpen(false);
          if (route === 'add-key') {
            setIsAddKeyOpen(true);
          } else {
            setCurrentRoute(route);
          }
        }}
        onOpenShortcuts={() => setIsShortcutsHelpOpen(true)}
        onOpenAbout={() => setIsAboutOpen(true)}
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Container */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden w-full">
        {/* Topbar */}
        <Topbar
          currentRoute={currentRoute}
          onOpenAddKey={() => setIsAddKeyOpen(true)}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenSettings={() => setCurrentRoute('settings')}
          onToggleMobileMenu={() => setIsMobileMenuOpen(prev => !prev)}
        />

        {/* Dynamic Route View */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          {currentRoute === 'dashboard' && (
            <DashboardView
              keys={keys}
              history={history}
              providers={providers}
              onNavigate={setCurrentRoute}
              onOpenAddKey={() => setIsAddKeyOpen(true)}
              onTestKey={handleExecuteTest}
            />
          )}

          {currentRoute === 'working-keys' && (
            <WorkingKeysView
              keys={keys}
              onTestKey={handleExecuteTest}
              onOpenChat={handleOpenChatWithKey}
              onOpenConfig={k => setConfigKey(k)}
              onEditKey={k => setEditingKey(k)}
              onDeleteKey={k => setDeletingKey(k)}
              onOpenAddKey={() => setIsAddKeyOpen(true)}
            />
          )}

          {currentRoute === 'all-keys' && (
            <AllKeysView
              keys={keys}
              onTestKey={handleExecuteTest}
              onOpenChat={handleOpenChatWithKey}
              onOpenConfig={k => setConfigKey(k)}
              onEditKey={k => setEditingKey(k)}
              onDeleteKey={k => setDeletingKey(k)}
              onMarkUntested={k => {
                markUntested(k.id);
                showToast(`Key marked as untested.`, 'info');
              }}
              onOpenAddKey={() => setIsAddKeyOpen(true)}
            />
          )}

          {currentRoute === 'failed-keys' && (
            <FailedKeysView
              keys={keys}
              history={history}
              onTestKey={handleExecuteTest}
              onEditKey={k => setEditingKey(k)}
            />
          )}

          {currentRoute === 'providers' && (
            <ProvidersView
              providers={providers}
              onAddKeyForProvider={provId => {
                setAddKeyInitialProviderId(provId);
                setIsAddKeyOpen(true);
              }}
              onOpenCustomProvider={() => setCurrentRoute('custom-providers')}
            />
          )}

          {currentRoute === 'models' && (
            <ModelsView providers={providers} keys={keys} />
          )}

          {currentRoute === 'compare' && (
            <CompareView history={history} />
          )}

          {currentRoute === 'tester' && (
            <ApiTesterView
              keys={keys}
              providers={providers}
              onTestKeyWithModel={(k, model) => handleExecuteTest(k, model)}
              onOpenAddKey={() => setIsAddKeyOpen(true)}
            />
          )}

          {currentRoute === 'chat' && (
            <ChatPlaygroundView keys={keys} providers={providers} />
          )}

          {currentRoute === 'custom-providers' && (
            <CustomProvidersView />
          )}

          {currentRoute === 'diagnostics' && (
            <DiagnosticsView />
          )}

          {currentRoute === 'history' && (
            <HistoryView
              history={history}
              onRefresh={() => {
                refreshKeys();
                showToast('History refreshed.', 'info');
              }}
            />
          )}

          {(currentRoute === 'signed-registry' ||
            currentRoute === 'leak-hunter' ||
            currentRoute === 'local-gateway') && (
            <SecurityAddonsView
              initialTab={currentRoute}
              keys={keys}
              providers={providers}
              onOpenAddKeyWithProvider={(provId) => {
                setAddKeyInitialProviderId(provId);
                setIsAddKeyOpen(true);
              }}
              onShowToast={showToast}
            />
          )}

          {currentRoute === 'settings' && (
            <SettingsView />
          )}

          {currentRoute === 'backup' && (
            <BackupView />
          )}
        </main>
      </div>

      {/* Global Modals */}
      <AddKeyModal
        isOpen={isAddKeyOpen}
        onClose={() => {
          setIsAddKeyOpen(false);
          setAddKeyInitialProviderId(undefined);
        }}
        initialProviderId={addKeyInitialProviderId}
        onAddKey={handleAddKeySubmit}
      />

      <EditKeyModal
        isOpen={Boolean(editingKey)}
        onClose={() => setEditingKey(null)}
        apiKey={editingKey}
        onSave={async (updatedKey, newSecret) => {
          await updateKey(updatedKey, newSecret);
          showToast('API Key updated successfully.', 'success');
        }}
      />

      <ConfigurationGeneratorModal
        isOpen={Boolean(configKey)}
        onClose={() => setConfigKey(null)}
        apiKey={configKey}
      />

      <TestProgressModal
        isOpen={isTestModalOpen}
        stage={testingStage}
        stageMessage={testingMessage}
        activeModel={testingActiveModel}
        isFallback={testingIsFallback}
        result={activeTestResult}
        onClose={() => setIsTestModalOpen(false)}
        onOpenChat={res => {
          setCurrentRoute('chat');
        }}
        onOpenConfig={res => {
          if (activeTestKey) {
            setConfigKey(activeTestKey);
          }
        }}
        onRetest={() => {
          if (activeTestKey) {
            handleExecuteTest(activeTestKey);
          }
        }}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={setCurrentRoute}
        onOpenAddKey={() => {
          setIsCommandPaletteOpen(false);
          setIsAddKeyOpen(true);
        }}
      />

      {/* Delete Key Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deletingKey)}
        onClose={() => setDeletingKey(null)}
        onConfirm={() => {
          if (deletingKey) {
            deleteKey(deletingKey.id);
            showToast('API Key deleted.', 'info');
          }
        }}
        title={t('keys.deleteConfirmTitle')}
        description={t('keys.deleteConfirmDesc')}
        itemsToRemove={[
          `Key record "${deletingKey?.label}"`,
          'Encrypted secret from vault',
          'Associated model configurations',
        ]}
      />

      {/* Shortcuts Help Modal */}
      <Modal
        isOpen={isShortcutsHelpOpen}
        onClose={() => setIsShortcutsHelpOpen(false)}
        title="Keyboard Shortcuts"
        maxWidth="md"
      >
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-300">Command Palette</span>
            <kbd className="px-2 py-1 rounded bg-zinc-800 font-mono text-zinc-300 text-[11px]">⌘K</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-300">Open Settings</span>
            <kbd className="px-2 py-1 rounded bg-zinc-800 font-mono text-zinc-300 text-[11px]">⌘,</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-300">Shortcut Help</span>
            <kbd className="px-2 py-1 rounded bg-zinc-800 font-mono text-zinc-300 text-[11px]">? or ⌘/</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-300">Close Dialogs</span>
            <kbd className="px-2 py-1 rounded bg-zinc-800 font-mono text-zinc-300 text-[11px]">ESC</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-300">Quick Jump: Dashboard</span>
            <kbd className="px-2 py-1 rounded bg-zinc-800 font-mono text-zinc-300 text-[11px]">g then d</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-300">Quick Jump: Working Keys</span>
            <kbd className="px-2 py-1 rounded bg-zinc-800 font-mono text-zinc-300 text-[11px]">g then w</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-300">Quick Jump: Chat Playground</span>
            <kbd className="px-2 py-1 rounded bg-zinc-800 font-mono text-zinc-300 text-[11px]">g then c</kbd>
          </div>
        </div>
      </Modal>

      {/* About Modal */}
      <Modal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        title="About AI API Key Lab"
        maxWidth="md"
      >
        <div className="space-y-4 text-xs text-zinc-300 leading-relaxed">
          <p>
            <strong className="text-white">AI API Key Lab</strong> is a local-first workbench engineered for AI developers, researchers, and hobbyists collecting free, trial, and personal API keys.
          </p>
          <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-[11px] font-mono space-y-1">
            <div>Target: macOS Apple Silicon / Web Native</div>
            <div>Storage: WebCrypto AES-256-GCM + PBKDF2 (600,000 rounds)</div>
            <div>Security: Host Binding & Late Secret Binding</div>
          </div>
          <p className="text-[11px] text-zinc-500">
            Built with extreme precision, strict error classification, and no-leak security.
          </p>
        </div>
      </Modal>

      {/* Toast Notifications Container */}
      <ToastContainer toasts={toasts} onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  );
}
