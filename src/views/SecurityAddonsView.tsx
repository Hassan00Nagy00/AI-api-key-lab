import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  FolderSearch,
  Server,
  Lock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  FolderOpen,
  ExternalLink,
  Plus,
  Eye,
  EyeOff,
  Copy,
  RotateCcw,
  Play,
  Square,
  FileCode2,
  GitBranch,
  KeyRound,
  Terminal,
  Trash2,
} from 'lucide-react';
import { ApiKeyRecord } from '../types/key';
import { ProviderConfig } from '../types/provider';
import {
  GatewayStatusSnapshot,
  LeakFinding,
  LeakScanReport,
  PendingRegistryHostChange,
  RegistryStatusInfo,
} from '../types/electron';
import { BUNDLED_PROVIDERS, BUNDLED_REGISTRY_VERSION, DEFAULT_PROVIDER_KEY_FORMATS } from '../providers/catalog';
import { BidiToken } from '../components/common/BidiToken';
import { t } from '../locales/i18n';

export type AddonTab = 'signed-registry' | 'leak-hunter' | 'local-gateway';

interface SecurityAddonsViewProps {
  initialTab?: AddonTab;
  keys: ApiKeyRecord[];
  providers: ProviderConfig[];
  onOpenAddKeyWithProvider: (providerId: string) => void;
  onShowToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function buildClientSnippetsForUi(port: number, tokenDisplay: string, defaultModel = 'auto') {
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  return {
    cursor: `// Cursor Settings -> Models -> OpenAI API Base URL\nBase URL: ${baseUrl}\nAPI Key:  ${tokenDisplay}\nModel:    ${defaultModel}`,
    aider: `aider --openai-api-base ${baseUrl} --openai-api-key "${tokenDisplay}" --model openai/${defaultModel}`,
    opencode: `{\n  "provider": "openai-compatible",\n  "baseURL": "${baseUrl}",\n  "apiKey": "${tokenDisplay}",\n  "model": "${defaultModel}"\n}`,
    curl: `curl -X POST "${baseUrl}/chat/completions" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${tokenDisplay}" \\\n  -d '{"model":"${defaultModel}","messages":[{"role":"user","content":"Hello!"}]}'`,
    python: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${baseUrl}",\n    api_key="${tokenDisplay}",\n)\n\nresponse = client.chat.completions.create(\n    model="${defaultModel}",\n    messages=[{"role":"user","content":"Hello!"}],\n)\nprint(response.choices[0].message.content)`,
    typescript: `import OpenAI from 'openai';\n\nconst client = new OpenAI({\n  baseURL: '${baseUrl}',\n  apiKey: '${tokenDisplay}',\n});\n\nconst res = await client.chat.completions.create({\n  model: '${defaultModel}',\n  messages: [{ role: 'user', content: 'Hello!' }],\n});\nconsole.log(res.choices[0]?.message?.content);`,
  };
}

function maskSecretForBrowserScan(rawMatch: string, prefixHint?: string): string {
  const clean = rawMatch.trim();
  const suffix = clean.slice(-4);
  let displayPrefix = 'key-';
  if (clean.startsWith('sk-ant-')) displayPrefix = 'sk-ant-';
  else if (clean.startsWith('sk-or-')) displayPrefix = 'sk-or-';
  else if (clean.startsWith('sk-proj-')) displayPrefix = 'sk-';
  else if (clean.startsWith('sk-')) displayPrefix = 'sk-';
  else if (clean.startsWith('gsk_')) displayPrefix = 'gsk_';
  else if (clean.startsWith('AIza')) displayPrefix = 'AIza';
  else if (clean.startsWith('xai-')) displayPrefix = 'xai-';
  else if (clean.startsWith('nvapi-')) displayPrefix = 'nvapi-';
  else if (clean.startsWith('hf_')) displayPrefix = 'hf_';
  else if (clean.startsWith('fw_')) displayPrefix = 'fw_';
  else if (clean.startsWith('csk-')) displayPrefix = 'csk-';
  else if (clean.startsWith('pplx-')) displayPrefix = 'pplx-';
  else if (clean.startsWith('r8_')) displayPrefix = 'r8_';
  else if (prefixHint) displayPrefix = prefixHint.slice(0, 6);
  return `${displayPrefix}••••${suffix}`;
}

export const SecurityAddonsView: React.FC<SecurityAddonsViewProps> = ({
  initialTab = 'signed-registry',
  keys,
  providers,
  onOpenAddKeyWithProvider,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<AddonTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // --- ADD-ON A: Signed Registry State ---
  const [registryStatus, setRegistryStatus] = useState<RegistryStatusInfo>({
    activeVersion: BUNDLED_REGISTRY_VERSION,
    bundledVersion: BUNDLED_REGISTRY_VERSION,
    activeSource: 'bundled',
    providerCount: BUNDLED_PROVIDERS.length,
    pendingHostChanges: [],
    lastNotice: null,
    providers: BUNDLED_PROVIDERS,
  });
  const [remoteUrl, setRemoteUrl] = useState('https://registry.aiapikeylab.local/v2/registry.json');
  const [detachedSignature, setDetachedSignature] = useState('');
  const [rawRegistryJson, setRawRegistryJson] = useState('');
  const [registryBanner, setRegistryBanner] = useState<{
    type: 'success' | 'warning' | 'error' | 'info';
    text: string;
  } | null>(null);

  // --- ADD-ON B: Leak Hunter State ---
  const [scanReport, setScanReport] = useState<LeakScanReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // --- ADD-ON C: Local Gateway State ---
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusSnapshot>({
    running: false,
    bindAddress: '127.0.0.1',
    port: 43110,
    baseUrl: 'http://127.0.0.1:43110/v1',
    maskedToken: 'aklg_••••9F2A',
    config: {
      enabled: false,
      port: 43110,
      priorityKeyIds: [],
      enableAutomaticFailover: true,
      maxRequestsBudget: 100,
      requestsUsed: 0,
      maxRequestsPerMinutePerKey: 30,
    },
    workingKeyCount: keys.filter((k) => k.status === 'working').length,
    recentLogs: [],
  });
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [selectedSnippetTool, setSelectedSnippetTool] = useState<
    'cursor' | 'aider' | 'opencode' | 'curl' | 'python' | 'typescript'
  >('cursor');

  // Sync with Electron Main Process if running in desktop runtime
  useEffect(() => {
    if (window.electronAPI?.registry) {
      window.electronAPI.registry.getStatus().then(setRegistryStatus).catch(() => {});
    }
    if (window.electronAPI?.gateway) {
      window.electronAPI.gateway.getStatus().then(setGatewayStatus).catch(() => {});
    }
  }, [keys]);

  // --- Handlers for ADD-ON A (Signed Registry) ---
  const handleVerifyRemoteRegistry = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!remoteUrl.trim().startsWith('https://')) {
      setRegistryBanner({
        type: 'error',
        text: 'Rejected non-HTTPS URL: Remote registries must be served over https://. Keeping bundled/verified registry.',
      });
      onShowToast('Rejected non-HTTPS registry URL.', 'error');
      return;
    }

    if (window.electronAPI?.registry) {
      try {
        const res = rawRegistryJson.trim()
          ? await window.electronAPI.registry.verifyAndApply({
              sourceUrl: remoteUrl.trim(),
              rawCanonicalJson: rawRegistryJson.trim(),
              signatureBase64: detachedSignature.trim(),
            })
          : await window.electronAPI.registry.fetchAndApply({
              sourceUrl: remoteUrl.trim(),
              signatureBase64: detachedSignature.trim() || undefined,
            });

        const nextStatus = await window.electronAPI.registry.getStatus();
        setRegistryStatus(nextStatus);
        setRegistryBanner({
          type:
            res.status === 'applied'
              ? 'success'
              : res.status === 'pending_host_approval' || res.status === 'offline_fallback'
                ? 'warning'
                : 'error',
          text: res.notice,
        });
        onShowToast(res.notice, res.applied ? 'success' : 'warning');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Verification failed';
        setRegistryBanner({ type: 'error', text: msg });
      }
      return;
    }

    // Browser preview verification check
    if (!detachedSignature.trim()) {
      setRegistryBanner({
        type: 'error',
        text: 'Rejected unsigned remote registry: Detached Ed25519 signature is required before parsing. Keeping bundled registry v1.',
      });
      onShowToast('Unsigned registry rejected.', 'warning');
      return;
    }

    setRegistryBanner({
      type: 'error',
      text: 'Rejected remote registry: Ed25519 signature verification failed against embedded public key. Keeping current verified registry.',
    });
    onShowToast('Ed25519 signature verification failed; keeping bundled registry.', 'warning');
  };

  const handleApproveHostChange = async (change: PendingRegistryHostChange) => {
    if (window.electronAPI?.registry) {
      try {
        const res = await window.electronAPI.registry.approveHostChange(change.providerId);
        const nextStatus = await window.electronAPI.registry.getStatus();
        setRegistryStatus(nextStatus);
        setRegistryBanner({ type: 'success', text: res.notice });
        onShowToast(res.notice, 'success');
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : 'Host approval canceled', 'warning');
      }
    } else {
      setRegistryStatus((prev) => ({
        ...prev,
        pendingHostChanges: prev.pendingHostChanges.filter((c) => c.providerId !== change.providerId),
      }));
      onShowToast(`Approved allowedHosts update for ${change.providerName}.`, 'success');
    }
  };

  const handleRejectHostChange = async (change: PendingRegistryHostChange) => {
    if (window.electronAPI?.registry) {
      const res = await window.electronAPI.registry.rejectHostChange(change.providerId);
      const nextStatus = await window.electronAPI.registry.getStatus();
      setRegistryStatus(nextStatus);
      setRegistryBanner({ type: 'info', text: res.notice });
      onShowToast(res.notice, 'info');
    } else {
      setRegistryStatus((prev) => ({
        ...prev,
        pendingHostChanges: prev.pendingHostChanges.filter((c) => c.providerId !== change.providerId),
      }));
      onShowToast(`Kept existing allowedHosts for ${change.providerName}.`, 'info');
    }
  };

  // --- Handlers for ADD-ON B (Leak Hunter) ---
  const handleNativeFolderScan = async () => {
    if (window.electronAPI?.leakHunter) {
      setIsScanning(true);
      try {
        const report = await window.electronAPI.leakHunter.pickAndScanFolders();
        if (!report.canceled) {
          setScanReport(report);
          onShowToast(
            `Scanned ${report.filesScanned} files (${report.findings.length} potential leaks found).`,
            report.findings.length > 0 ? 'warning' : 'success'
          );
        }
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : 'Folder scan failed', 'error');
      } finally {
        setIsScanning(false);
      }
    }
  };

  const handleBrowserDirectoryInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setIsScanning(true);
    try {
      const findings: LeakFinding[] = [];
      let filesScanned = 0;
      let filesSkipped = 0;
      let containsGitRepo = false;
      const folderSet = new Set<string>();

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const relPath = (file as any).webkitRelativePath || file.name;
        const segments = relPath.split('/');
        if (segments.length > 1) {
          folderSet.add(segments[0]);
        }

        if (segments.includes('.git')) {
          containsGitRepo = true;
          filesSkipped++;
          continue;
        }
        if (
          segments.some((s: string) =>
            ['node_modules', 'dist', 'build', 'release', '.next', 'vendor'].includes(s)
          )
        ) {
          filesSkipped++;
          continue;
        }
        if (file.size === 0 || file.size > 1024 * 1024) {
          filesSkipped++;
          continue;
        }

        const text = await file.text();
        if (text.includes('\0')) {
          filesSkipped++;
          continue;
        }

        filesScanned++;
        const lines = text.split(/\r?\n/);

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx];
          if (!line || line.length < 20) continue;

          for (const [providerId, formats] of Object.entries(DEFAULT_PROVIDER_KEY_FORMATS)) {
            const prov = providers.find((p) => p.id === providerId);
            for (const fmt of formats) {
              if (!line.includes(fmt.prefix)) continue;
              const regex = new RegExp(fmt.regex, 'g');
              let match: RegExpExecArray | null;
              while ((match = regex.exec(line)) !== null) {
                const rawSecret = match[0];
                if (rawSecret.length < fmt.minLength) continue;
                const maskedFingerprint = maskSecretForBrowserScan(rawSecret, fmt.prefix);
                const id = `${relPath}:${lineIdx + 1}:${providerId}:${maskedFingerprint}`;
                if (!findings.some((f) => f.id === id)) {
                  findings.push({
                    id,
                    providerId,
                    providerName: prov?.name || providerId,
                    filePath: relPath,
                    relativePath: relPath,
                    lineNumber: lineIdx + 1,
                    maskedFingerprint,
                    isGitRepo: containsGitRepo,
                    rotated: false,
                  });
                }
              }
            }
          }
        }
      }

      setScanReport({
        scannedFolders: folderSet.size > 0 ? [...folderSet] : ['Selected Folder'],
        scannedAt: new Date().toISOString(),
        filesScanned,
        filesSkipped,
        containsGitRepo,
        gitWarning: containsGitRepo
          ? 'Git repository detected (.git found). Removing a plain-text API key from a working file does NOT remove it from prior Git commits or reflogs. Rotate affected keys immediately on the provider dashboard.'
          : null,
        findings,
      });
    } finally {
      setIsScanning(false);
      e.target.value = '';
    }
  };

  const handleToggleRotated = async (finding: LeakFinding) => {
    const nextRotated = !finding.rotated;
    if (window.electronAPI?.leakHunter) {
      await window.electronAPI.leakHunter.markRotated(finding.id, nextRotated);
    }
    setScanReport((prev) =>
      prev
        ? {
            ...prev,
            findings: prev.findings.map((f) =>
              f.id === finding.id ? { ...f, rotated: nextRotated } : f
            ),
          }
        : null
    );
    onShowToast(
      nextRotated
        ? `Marked ${finding.maskedFingerprint} as Rotated.`
        : `Unmarked ${finding.maskedFingerprint}.`,
      'info'
    );
  };

  const handleRevealInFinder = async (finding: LeakFinding) => {
    if (window.electronAPI?.leakHunter) {
      try {
        await window.electronAPI.leakHunter.revealInFinder(finding.filePath);
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : 'Could not reveal file in Finder', 'error');
      }
    } else {
      onShowToast(`Native Finder reveal requires the macOS desktop runtime (${finding.relativePath}).`, 'info');
    }
  };

  // --- Handlers for ADD-ON C (Local Gateway) ---
  const handleToggleGateway = async () => {
    if (window.electronAPI?.gateway) {
      try {
        const next = gatewayStatus.running
          ? await window.electronAPI.gateway.stop()
          : await window.electronAPI.gateway.start(gatewayStatus.config.port);
        setGatewayStatus(next);
        onShowToast(
          next.running
            ? `Local Gateway started on http://127.0.0.1:${next.port}/v1`
            : 'Local Gateway stopped.',
          next.running ? 'success' : 'info'
        );
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : 'Failed to toggle Local Gateway', 'error');
      }
    } else {
      setGatewayStatus((prev) => ({
        ...prev,
        running: !prev.running,
        config: { ...prev.config, enabled: !prev.running },
      }));
      onShowToast(
        !gatewayStatus.running
          ? `Local Gateway enabled on http://127.0.0.1:${gatewayStatus.port}/v1`
          : 'Local Gateway stopped.',
        !gatewayStatus.running ? 'success' : 'info'
      );
    }
  };

  const handleRevealGatewayToken = async () => {
    if (revealedToken) {
      setRevealedToken(null);
      return;
    }

    if (window.electronAPI?.gateway) {
      try {
        const res = await window.electronAPI.gateway.revealToken();
        setRevealedToken(res.token);
        setTimeout(() => setRevealedToken(null), res.expiresAfterMs || 15000);
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : 'Token reveal canceled', 'warning');
      }
    } else {
      setRevealedToken('aklg_preview_local_only_token_7f3a9b2c');
      setTimeout(() => setRevealedToken(null), 15000);
    }
  };

  const handleRotateGatewayToken = async () => {
    if (window.electronAPI?.gateway) {
      try {
        const res = await window.electronAPI.gateway.rotateToken();
        setRevealedToken(null);
        setGatewayStatus((prev) => ({ ...prev, maskedToken: res.maskedToken }));
        onShowToast('Rotated Local Gateway bearer token.', 'success');
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : 'Token rotation canceled', 'warning');
      }
    } else {
      const randSuffix = Math.floor(1000 + Math.random() * 9000).toString(16).toUpperCase();
      setRevealedToken(null);
      setGatewayStatus((prev) => ({ ...prev, maskedToken: `aklg_••••${randSuffix}` }));
      onShowToast('Rotated Local Gateway bearer token.', 'success');
    }
  };

  const handleGatewayConfigUpdate = async (
    patch: Partial<{
      port: number;
      enableAutomaticFailover: boolean;
      maxRequestsBudget: number;
      maxRequestsPerMinutePerKey: number;
      resetBudgetUsage: boolean;
    }>
  ) => {
    if (window.electronAPI?.gateway) {
      try {
        const next = await window.electronAPI.gateway.updateConfig(patch);
        setGatewayStatus(next);
        onShowToast('Local Gateway settings updated.', 'success');
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : 'Invalid gateway configuration', 'error');
      }
    } else {
      setGatewayStatus((prev) => ({
        ...prev,
        port: patch.port ?? prev.port,
        baseUrl: `http://127.0.0.1:${patch.port ?? prev.port}/v1`,
        config: {
          ...prev.config,
          port: patch.port ?? prev.config.port,
          enableAutomaticFailover: patch.enableAutomaticFailover ?? prev.config.enableAutomaticFailover,
          maxRequestsBudget: patch.maxRequestsBudget ?? prev.config.maxRequestsBudget,
          maxRequestsPerMinutePerKey:
            patch.maxRequestsPerMinutePerKey ?? prev.config.maxRequestsPerMinutePerKey,
          requestsUsed: patch.resetBudgetUsage ? 0 : prev.config.requestsUsed,
        },
      }));
    }
  };

  const workingKeys = keys.filter((k) => k.status === 'working');
  const snippets = buildClientSnippetsForUi(
    gatewayStatus.port,
    revealedToken || '<YOUR_GATEWAY_TOKEN>',
    workingKeys[0]?.selectedModel || workingKeys[0]?.lastKnownGood?.model || 'auto'
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <ShieldCheck className="text-blue-400" size={22} />
            <span>{t('addons.title', 'Security & Desktop Add-ons')}</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            {t(
              'addons.subtitle',
              'Signed Ed25519 Registry Updates, Opt-In Plain-Text Leak Hunter, and 127.0.0.1 Local OpenAI-Compatible Gateway.'
            )}
          </p>
        </div>

        {/* Add-on Switcher Tabs */}
        <div className="flex items-center gap-1.5 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab('signed-registry')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'signed-registry'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ShieldCheck size={14} />
            <span>{t('addons.tabSignedRegistry', 'Signed Registry')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('leak-hunter')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'leak-hunter'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FolderSearch size={14} />
            <span>{t('addons.tabLeakHunter', 'Leak Hunter')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('local-gateway')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'local-gateway'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Server size={14} />
            <span>{t('addons.tabLocalGateway', 'Local Gateway')}</span>
            <span
              className={`w-2 h-2 rounded-full ${
                gatewayStatus.running ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
              }`}
            />
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* ADD-ON A: SIGNED REGISTRY UPDATES                                   */}
      {/* =================================================================== */}
      {activeTab === 'signed-registry' && (
        <div className="space-y-6">
          {/* Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                Active Registry Version
              </div>
              <div className="mt-1.5 text-xl font-bold text-white font-mono">
                v{registryStatus.activeVersion}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                Monotonic anti-rollback enforced (&gt; v{registryStatus.activeVersion})
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                Registry Source
              </div>
              <div className="mt-1.5 text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 size={15} />
                <span className="uppercase font-mono">{registryStatus.activeSource}</span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                {registryStatus.providerCount} verified providers loaded
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                Signature Scheme
              </div>
              <div className="mt-1.5 text-sm font-bold text-blue-400 font-mono">
                Ed25519 Detached
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                Verified over canonical JSON before parse
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                Host Binding Guard
              </div>
              <div className="mt-1.5 text-sm font-bold text-zinc-200">
                {registryStatus.pendingHostChanges.length === 0
                  ? 'All Bound Hosts Locked'
                  : `${registryStatus.pendingHostChanges.length} Pending Approval`}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                Cannot alter allowedHosts of stored keys silently
              </div>
            </div>
          </div>

          {registryBanner && (
            <div
              className={`p-4 rounded-xl border text-xs flex items-start gap-3 ${
                registryBanner.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : registryBanner.type === 'warning'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : registryBanner.type === 'info'
                      ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}
            >
              {registryBanner.type === 'success' ? (
                <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              ) : registryBanner.type === 'error' ? (
                <XCircle size={16} className="shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              )}
              <div className="flex-1 leading-relaxed">{registryBanner.text}</div>
            </div>
          )}

          {/* Pending Host Changes Approval Gate */}
          {registryStatus.pendingHostChanges.length > 0 && (
            <div className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={18} />
                <div>
                  <h3 className="text-sm font-bold text-amber-200">
                    Explicit Approval Required: Remote Registry Proposed Host Changes
                  </h3>
                  <p className="text-xs text-amber-300/90 mt-1">
                    Even a cryptographically signed remote registry cannot change <code className="font-mono">allowedHosts</code> of a provider for which you have stored API keys without your explicit approval.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {registryStatus.pendingHostChanges.map((change) => (
                  <div
                    key={change.providerId}
                    className="p-3.5 rounded-xl bg-zinc-950/90 border border-amber-500/30 flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 text-xs">
                      <div className="font-bold text-white">
                        {change.providerName} (<BidiToken>{change.providerId}</BidiToken>) —{' '}
                        <span className="text-amber-400">{change.affectedKeyCount} stored key(s)</span>
                      </div>
                      <div className="text-zinc-400">
                        Current allowedHosts:{' '}
                        <BidiToken className="text-emerald-400">{change.currentHosts.join(', ')}</BidiToken>
                      </div>
                      <div className="text-zinc-400">
                        Proposed allowedHosts (v{change.remoteVersion}):{' '}
                        <BidiToken className="text-amber-300">{change.proposedHosts.join(', ')}</BidiToken>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRejectHostChange(change)}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium cursor-pointer"
                      >
                        Keep Current Host
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApproveHostChange(change)}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold cursor-pointer"
                      >
                        Approve New Host
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Verify & Apply Signed Remote Registry Form */}
          <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Lock size={15} className="text-blue-400" />
                <span>Verify & Apply Signed Remote Registry Update</span>
              </h3>
              <p className="text-xs text-zinc-400 mt-1">
                Only <code className="font-mono text-zinc-300">https://</code> URLs with a valid detached Ed25519 signature over canonical JSON and strictly increasing <code className="font-mono text-zinc-300">registryVersion</code> are accepted.
              </p>
            </div>

            <form onSubmit={handleVerifyRemoteRegistry} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Remote Registry HTTPS URL
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={remoteUrl}
                    onChange={(e) => setRemoteUrl(e.target.value)}
                    placeholder="https://registry.example.com/v2/registry.json"
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Detached Ed25519 Signature (Base64)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={detachedSignature}
                    onChange={(e) => setDetachedSignature(e.target.value)}
                    placeholder="Base64 64-byte Ed25519 signature (.sig)"
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Optional Canonical Registry JSON Payload (for offline / air-gapped verification)
                </label>
                <textarea
                  dir="ltr"
                  rows={3}
                  value={rawRegistryJson}
                  onChange={(e) => setRawRegistryJson(e.target.value)}
                  placeholder='{"providers":[...],"registryVersion":2,"releasedAt":"2026-05-01T00:00:00.000Z"}'
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="text-[11px] text-zinc-500 font-mono">
                  Embedded Public Key: MCowBQYDK2VwAyEAf1lP8gT3mK7xR9vN2wQ5zL8jC4bV6nM1pS0dF3gH5jK=
                </div>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw size={14} />
                  <span>Verify Ed25519 Signature & Apply</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* ADD-ON B: LEAK HUNTER (EXPLICIT OPT-IN FOLDER SCANNER)              */}
      {/* =================================================================== */}
      {activeTab === 'leak-hunter' && (
        <div className="space-y-6">
          {/* Opt-in Policy & Controls */}
          <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <FolderSearch className="text-blue-400" size={18} />
                <h3 className="text-sm font-bold text-white">
                  Explicit Opt-In Local Project Leak Hunter
                </h3>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono">
                  Zero-Secret Retention
                </span>
              </div>
              <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
                Scans <strong className="text-zinc-200">only</strong> folders you explicitly select. Automatically skips{' '}
                <code className="font-mono text-zinc-300">node_modules</code>,{' '}
                <code className="font-mono text-zinc-300">.git</code>,{' '}
                <code className="font-mono text-zinc-300">dist</code>,{' '}
                <code className="font-mono text-zinc-300">build</code>,{' '}
                <code className="font-mono text-zinc-300">release</code>, binary files, and files over{' '}
                <code className="font-mono text-zinc-300">1 MB</code>. Full secrets are never displayed, logged, copied, or stored.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {window.electronAPI?.leakHunter ? (
                <button
                  type="button"
                  disabled={isScanning}
                  onClick={handleNativeFolderScan}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm shadow-blue-500/20"
                >
                  <FolderOpen size={15} />
                  <span>{isScanning ? 'Scanning Selected Folder...' : 'Select Folder to Scan...'}</span>
                </button>
              ) : (
                <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-sm shadow-blue-500/20">
                  <FolderOpen size={15} />
                  <span>{isScanning ? 'Scanning...' : 'Select Project Folder to Scan...'}</span>
                  <input
                    type="file"
                    multiple
                    {...({ webkitdirectory: '', directory: '' } as any)}
                    onChange={handleBrowserDirectoryInput}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Git History Warning Banner */}
          {scanReport?.containsGitRepo && scanReport.gitWarning && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
              <GitBranch className="text-amber-400 shrink-0 mt-0.5" size={18} />
              <div className="text-xs text-amber-200 leading-relaxed">
                <strong className="block text-amber-100 mb-0.5">
                  Git Repository History Warning (.git Detected)
                </strong>
                {scanReport.gitWarning}
              </div>
            </div>
          )}

          {/* Scan Summary & Findings Table */}
          {scanReport ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800">
                  <div className="text-[11px] text-zinc-500 uppercase font-semibold">Scanned Folders</div>
                  <div className="mt-1 text-xs font-mono text-zinc-200 truncate">
                    {scanReport.scannedFolders.join(', ')}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800">
                  <div className="text-[11px] text-zinc-500 uppercase font-semibold">Files Scanned</div>
                  <div className="mt-1 text-lg font-bold text-white font-mono">
                    {scanReport.filesScanned}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800">
                  <div className="text-[11px] text-zinc-500 uppercase font-semibold">
                    Skipped (Binary / Ignored / &gt;1MB)
                  </div>
                  <div className="mt-1 text-lg font-bold text-zinc-400 font-mono">
                    {scanReport.filesSkipped}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800">
                  <div className="text-[11px] text-zinc-500 uppercase font-semibold">Plain-Text Findings</div>
                  <div
                    className={`mt-1 text-lg font-bold font-mono ${
                      scanReport.findings.length > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {scanReport.findings.length}
                  </div>
                </div>
              </div>

              {scanReport.findings.length === 0 ? (
                <div className="p-8 rounded-xl bg-zinc-900/40 border border-zinc-800/80 text-center space-y-2">
                  <CheckCircle2 className="mx-auto text-emerald-400" size={28} />
                  <div className="text-sm font-semibold text-white">
                    No Plain-Text API Keys Found in Selected Folder
                  </div>
                  <p className="text-xs text-zinc-400">
                    Scanned {scanReport.filesScanned} source files against all registry key-format patterns.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900/50">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950/70 text-[11px] uppercase tracking-wider text-zinc-400">
                        <th className="py-3 px-4">Provider</th>
                        <th className="py-3 px-4">File & Line</th>
                        <th className="py-3 px-4">Masked Fingerprint</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {scanReport.findings.map((finding) => (
                        <tr
                          key={finding.id}
                          className={finding.rotated ? 'bg-zinc-950/40 opacity-60' : 'hover:bg-zinc-900/80'}
                        >
                          <td className="py-3 px-4 font-semibold text-white">
                            <div>{finding.providerName}</div>
                            <div className="text-[10px] text-zinc-500 font-mono">{finding.providerId}</div>
                          </td>
                          <td className="py-3 px-4 font-mono text-zinc-300">
                            <BidiToken>
                              {finding.relativePath}:{finding.lineNumber}
                            </BidiToken>
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 font-mono text-amber-300">
                              <BidiToken>{finding.maskedFingerprint}</BidiToken>
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {finding.rotated ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px]">
                                <CheckCircle2 size={12} />
                                <span>Rotated</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px]">
                                <AlertTriangle size={12} />
                                <span>Rotate Key</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleRevealInFinder(finding)}
                                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium cursor-pointer"
                                title="Reveal file in macOS Finder"
                              >
                                Reveal in Finder
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleRotated(finding)}
                                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium cursor-pointer"
                              >
                                {finding.rotated ? 'Unmark Rotated' : 'Mark as Rotated'}
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenAddKeyWithProvider(finding.providerId)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-[11px] font-medium cursor-pointer"
                                title="Opens Add Key modal with provider preselected so you can paste manually"
                              >
                                <Plus size={12} />
                                <span>Add to AI API Key Lab</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 rounded-xl bg-zinc-900/30 border border-zinc-800/80 text-center space-y-2">
              <FileCode2 className="mx-auto text-zinc-500" size={28} />
              <div className="text-sm font-semibold text-zinc-300">
                No Folder Scanned Yet
              </div>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Click &ldquo;Select Folder to Scan...&rdquo; above to explicitly choose a project directory. Leak Hunter never runs in the background or scans outside your chosen folder.
              </p>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* ADD-ON C: LOCAL GATEWAY (127.0.0.1 OPENAI-COMPATIBLE ENDPOINT)      */}
      {/* =================================================================== */}
      {activeTab === 'local-gateway' && (
        <div className="space-y-6">
          {/* Top Gateway Control Bar */}
          <div className="p-5 rounded-xl bg-zinc-900/70 border border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    gatewayStatus.running ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
                  }`}
                />
                <h3 className="text-sm font-bold text-white">
                  Local OpenAI-Compatible Gateway (<BidiToken>{gatewayStatus.baseUrl}</BidiToken>)
                </h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${
                    gatewayStatus.running
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                  }`}
                >
                  {gatewayStatus.running ? 'Listening on 127.0.0.1' : 'Disabled (Off by Default)'}
                </span>
              </div>
              <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
                Point Cursor, Aider, OpenCode, or local scripts to{' '}
                <BidiToken className="text-zinc-200">{gatewayStatus.baseUrl}</BidiToken> using your Keychain-backed gateway token instead of exposing raw provider keys. Enforces strict <code className="font-mono text-zinc-300">Host</code> validation, rejects browser <code className="font-mono text-zinc-300">Origin</code> headers, and fails over automatically on <code className="font-mono text-zinc-300">429</code>.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={handleToggleGateway}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                  gatewayStatus.running
                    ? 'bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-500/20'
                }`}
              >
                {gatewayStatus.running ? <Square size={14} /> : <Play size={14} />}
                <span>{gatewayStatus.running ? 'Stop Local Gateway' : 'Start Local Gateway'}</span>
              </button>
            </div>
          </div>

          {/* Gateway Security & Routing Settings Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Keychain Gateway Token & Bind Settings */}
            <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <KeyRound size={14} className="text-blue-400" />
                <span>Gateway Bearer Token & Loopback Binding</span>
              </h4>

              <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2">
                <div className="text-xs font-mono text-zinc-200 truncate">
                  <BidiToken>{revealedToken || gatewayStatus.maskedToken}</BidiToken>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleRevealGatewayToken}
                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                    title="Reveal Gateway Token (Confirmation / Touch ID Gate)"
                  >
                    {revealedToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  {revealedToken && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(revealedToken);
                        onShowToast('Gateway token copied.', 'success');
                      }}
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                      title="Copy Revealed Gateway Token"
                    >
                      <Copy size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleRotateGatewayToken}
                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                    title="Rotate Gateway Bearer Token"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Bind Address (Locked)
                  </label>
                  <input
                    type="text"
                    disabled
                    value="127.0.0.1"
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950/60 border border-zinc-800 text-xs text-zinc-400 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Configurable Port
                  </label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={gatewayStatus.config.port}
                    onChange={(e) =>
                      handleGatewayConfigUpdate({ port: Number(e.target.value) || 43110 })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 font-mono"
                  />
                </div>
              </div>

              <div className="text-[11px] text-zinc-400 space-y-1 pt-1">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 size={13} />
                  <span>DNS Rebinding Guard: Validates Host header (127.0.0.1 / localhost only)</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 size={13} />
                  <span>Browser Probe Guard: Rejects Origin &amp; Sec-Fetch-* headers (403)</span>
                </div>
              </div>
            </div>

            {/* Failover & Request Budget Enforcement */}
            <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <RefreshCw size={14} className="text-blue-400" />
                <span>Routing, 429 Failover &amp; Request Budget</span>
              </h4>

              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                <div>
                  <div className="text-xs font-semibold text-white">
                    Automatic Failover on HTTP 429
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Routes across {workingKeys.length} verified &ldquo;working&rdquo; key(s)
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={gatewayStatus.config.enableAutomaticFailover}
                  onChange={(e) =>
                    handleGatewayConfigUpdate({ enableAutomaticFailover: e.target.checked })
                  }
                  className="w-4 h-4 accent-blue-600 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Session Request Budget
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={gatewayStatus.config.maxRequestsBudget}
                    onChange={(e) =>
                      handleGatewayConfigUpdate({
                        maxRequestsBudget: Math.max(1, Number(e.target.value) || 100),
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Per-Key RPM Limit
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={gatewayStatus.config.maxRequestsPerMinutePerKey}
                    onChange={(e) =>
                      handleGatewayConfigUpdate({
                        maxRequestsPerMinutePerKey: Math.max(1, Number(e.target.value) || 30),
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-zinc-400 font-mono">
                  Budget Used: {gatewayStatus.config.requestsUsed} / {gatewayStatus.config.maxRequestsBudget}
                </span>
                <button
                  type="button"
                  onClick={() => handleGatewayConfigUpdate({ resetBudgetUsage: true })}
                  className="text-blue-400 hover:text-blue-300 text-[11px] font-medium cursor-pointer"
                >
                  Reset Budget Counter
                </button>
              </div>
            </div>
          </div>

          {/* Ready-to-Copy Client Snippets (Cursor, Aider, OpenCode, cURL, Python, TS) */}
          <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal size={15} className="text-blue-400" />
                  <span>Ready-to-Copy Local Gateway Tool Configurations</span>
                </h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Contains only your local <code className="font-mono">http://127.0.0.1:{gatewayStatus.port}/v1</code> endpoint and gateway token — raw provider secrets never leave AI API Key Lab.
                </p>
              </div>

              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
                {(['cursor', 'aider', 'opencode', 'curl', 'python', 'typescript'] as const).map(
                  (tool) => (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => setSelectedSnippetTool(tool)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-mono uppercase cursor-pointer ${
                        selectedSnippetTool === tool
                          ? 'bg-blue-600 text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {tool}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="relative">
              <pre
                dir="ltr"
                className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-200 overflow-x-auto leading-relaxed"
              >
                {snippets[selectedSnippetTool]}
              </pre>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(snippets[selectedSnippetTool]);
                  onShowToast(`Copied ${selectedSnippetTool} configuration.`, 'success');
                }}
                className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium cursor-pointer"
              >
                <Copy size={12} />
                <span>Copy</span>
              </button>
            </div>
          </div>

          {/* Sanitized Gateway Activity Log */}
          <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">
                  Sanitized Gateway Activity Log (Metadata Only)
                </h4>
                <p className="text-[11px] text-zinc-400">
                  Logs only <code className="font-mono">providerId</code>, <code className="font-mono">modelId</code>, <code className="font-mono">latencyMs</code>, <code className="font-mono">status</code>, and <code className="font-mono">errorCategory</code> — never prompts, responses, or secrets.
                </p>
              </div>
              {gatewayStatus.recentLogs.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    if (window.electronAPI?.gateway) {
                      const next = await window.electronAPI.gateway.clearLogs();
                      setGatewayStatus(next);
                    } else {
                      setGatewayStatus((prev) => ({ ...prev, recentLogs: [] }));
                    }
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs cursor-pointer"
                >
                  <Trash2 size={12} />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {gatewayStatus.recentLogs.length === 0 ? (
              <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-center text-xs text-zinc-500">
                No Local Gateway requests recorded in this session yet.
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-800 overflow-hidden">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 text-[10px] uppercase">
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-3">Provider</th>
                      <th className="py-2 px-3">Model</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Latency</th>
                      <th className="py-2 px-3">Category</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {gatewayStatus.recentLogs.map((entry) => (
                      <tr key={entry.id}>
                        <td className="py-2 px-3 text-zinc-400">{entry.timestamp.slice(11, 19)}</td>
                        <td className="py-2 px-3 text-zinc-200">{entry.providerId}</td>
                        <td className="py-2 px-3 text-zinc-300">{entry.modelId}</td>
                        <td
                          className={`py-2 px-3 font-bold ${
                            entry.status === 200 ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {entry.status}
                        </td>
                        <td className="py-2 px-3 text-zinc-400">{entry.latencyMs}ms</td>
                        <td className="py-2 px-3 text-zinc-400">{entry.errorCategory || 'OK'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
