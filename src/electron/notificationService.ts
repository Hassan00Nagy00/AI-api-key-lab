import { redactSecretsFromText, SanitizedLogger } from './jsonStore';

export interface NativeNotificationBackend {
  isSupported(): boolean;
  show(opts: { title: string; body: string }): void;
}

export interface NotificationDispatchResult {
  deliveredVia: 'native-main-notification' | 'in-app-banner-fallback';
  title: string;
  body: string;
  fallbackReason?: string;
}

/**
 * Main-Process Notification Service (`07_P3 §0A.3`):
 * - Expiry alerts and Model Watch alerts use the Electron main-process `Notification` class.
 * - Because macOS notifications may be unavailable or unreliable under an ad-hoc signature,
 *   if `Notification.isSupported()` is false or `show()` throws, it gracefully falls back
 *   to the in-app banner (`in-app-banner-fallback`) and logs/reports the reason.
 * - Renderer's `session.defaultSession.setPermissionRequestHandler` remains deny-all
 *   (governing web permissions in the renderer, not main-process notifications).
 * - No notification fires while the app is closed; there is no login item, launch agent,
 *   or background daemon.
 */
export class MainNotificationService {
  private backend: NativeNotificationBackend;
  private logger?: SanitizedLogger;
  private onInAppBanner?: (banner: { title: string; body: string; reason: string }) => void;

  constructor(deps: {
    backend: NativeNotificationBackend;
    logger?: SanitizedLogger;
    onInAppBanner?: (banner: { title: string; body: string; reason: string }) => void;
  }) {
    this.backend = deps.backend;
    this.logger = deps.logger;
    this.onInAppBanner = deps.onInAppBanner;
  }

  dispatchAlert(
    kind: 'expiry-alert' | 'model-watch-alert',
    title: string,
    body: string,
    knownSecrets: string[] = []
  ): NotificationDispatchResult {
    const safeTitle = redactSecretsFromText(title, knownSecrets);
    const safeBody = redactSecretsFromText(body, knownSecrets);

    try {
      if (this.backend.isSupported()) {
        this.backend.show({ title: safeTitle, body: safeBody });
        this.logger?.log('INFO', `Dispatched ${kind} via Electron main-process Notification`, {
          kind,
          title: safeTitle,
        });
        return {
          deliveredVia: 'native-main-notification',
          title: safeTitle,
          body: safeBody,
        };
      }
    } catch (err: unknown) {
      const reason =
        err instanceof Error
          ? err.message
          : 'Main-process Notification failed (ad-hoc signature or permission denied)';
      this.onInAppBanner?.({ title: safeTitle, body: safeBody, reason });
      this.logger?.log(
        'WARN',
        `Main-process Notification failed (${kind}); fell back to in-app banner`,
        { kind, reason }
      );
      return {
        deliveredVia: 'in-app-banner-fallback',
        title: safeTitle,
        body: safeBody,
        fallbackReason: reason,
      };
    }

    const fallbackReason =
      'macOS main-process Notification unsupported or suppressed under ad-hoc signature — using in-app banner fallback.';
    this.onInAppBanner?.({ title: safeTitle, body: safeBody, reason: fallbackReason });
    this.logger?.log('INFO', `Fell back to in-app banner for ${kind}`, {
      kind,
      fallbackReason,
    });
    return {
      deliveredVia: 'in-app-banner-fallback',
      title: safeTitle,
      body: safeBody,
      fallbackReason,
    };
  }
}
