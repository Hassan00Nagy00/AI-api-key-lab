import { useEffect } from 'react';

export interface ShortcutHandlers {
  onOpenCommandPalette?: () => void;
  onOpenAddKey?: () => void;
  onOpenSettings?: () => void;
  onOpenShortcutsHelp?: () => void;
  onEscape?: () => void;
  onNavigate?: (route: string) => void;
}

export function useShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    let pendingGKey = false;
    let gKeyTimeout: any = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept shortcuts when typing in inputs or textareas, except Escape and Cmd+K
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (e.key === 'Escape') {
        handlers.onEscape?.();
        return;
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handlers.onOpenCommandPalette?.();
        return;
      }

      if (isInput) {
        return; // Let user type normally
      }

      // Help modal with '?'
      if (e.key === '?' || (isCmdOrCtrl && e.key === '/')) {
        e.preventDefault();
        handlers.onOpenShortcutsHelp?.();
        return;
      }

      // Cmd+, for settings
      if (isCmdOrCtrl && e.key === ',') {
        e.preventDefault();
        handlers.onOpenSettings?.();
        return;
      }

      // Two-key navigation: 'g' then 'd' (dashboard), 'w' (working), 'a' (all keys), 'c' (chat), 'p' (providers), 'm' (models)
      if (e.key === 'g' && !isCmdOrCtrl) {
        pendingGKey = true;
        clearTimeout(gKeyTimeout);
        gKeyTimeout = setTimeout(() => {
          pendingGKey = false;
        }, 1200);
        return;
      }

      if (pendingGKey) {
        pendingGKey = false;
        clearTimeout(gKeyTimeout);

        switch (e.key.toLowerCase()) {
          case 'd':
            handlers.onNavigate?.('dashboard');
            break;
          case 'w':
            handlers.onNavigate?.('working');
            break;
          case 'a':
            handlers.onNavigate?.('keys');
            break;
          case 'c':
            handlers.onNavigate?.('chat');
            break;
          case 'p':
            handlers.onNavigate?.('providers');
            break;
          case 'm':
            handlers.onNavigate?.('models');
            break;
          case 't':
            handlers.onNavigate?.('tester');
            break;
          case 'h':
            handlers.onNavigate?.('history');
            break;
          case 's':
            handlers.onNavigate?.('settings');
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(gKeyTimeout);
    };
  }, [handlers]);
}
