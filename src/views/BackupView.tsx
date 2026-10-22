import React, { useState } from 'react';
import { ExportService } from '../services/exportService';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { t } from '../locales/i18n';
import {
  HardDriveDownload,
  Lock,
  FileJson,
  FileSpreadsheet,
  FileCode,
  Upload,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';

export const BackupView: React.FC = () => {
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restoreFileJson, setRestoreFileJson] = useState('');

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showRawSecretExportConfirm, setShowRawSecretExportConfirm] = useState(false);

  // 1. Create Encrypted Backup
  const handleCreateEncrypted = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupPassphrase || backupPassphrase.length < 8) {
      setStatusMessage({ type: 'error', text: 'Passphrase must be at least 8 characters long.' });
      return;
    }

    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const res = await window.electronAPI.backup.create({
          includeSecrets: true,
          passphrase: backupPassphrase,
        });
        if (res.saved) {
          setStatusMessage({ type: 'success', text: `Encrypted backup saved to ${res.filePath || 'disk'}.` });
          setBackupPassphrase('');
        }
        return;
      }

      const backupJson = await ExportService.createEncryptedBackup(backupPassphrase);
      downloadFile(backupJson, `ai-api-key-lab-encrypted-backup-${Date.now()}.json`, 'application/json');
      setStatusMessage({ type: 'success', text: 'Encrypted backup generated and downloaded successfully.' });
      setBackupPassphrase('');
    } catch (err: unknown) {
      setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Backup generation failed.' });
    }
  };

  // 2. Restore Encrypted Backup
  const handleRestoreEncrypted = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restorePassphrase || !restoreFileJson) {
      setStatusMessage({ type: 'error', text: 'Please provide backup JSON and password.' });
      return;
    }

    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const report = await window.electronAPI.backup.importFile({
          passphrase: restorePassphrase,
          rawJsonContent: restoreFileJson,
        });
        setStatusMessage({
          type: 'success',
          text: `Restored ${report.keysImported} API keys and ${report.providersImported} custom providers into macOS Keychain!`,
        });
        setRestorePassphrase('');
        setRestoreFileJson('');
        return;
      }

      const res = await ExportService.restoreEncryptedBackup(restoreFileJson, restorePassphrase);
      setStatusMessage({ type: 'success', text: `Restored ${res.keysRestored} API keys and data successfully!` });
      setRestorePassphrase('');
      setRestoreFileJson('');
    } catch (err: unknown) {
      setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : 'Restore failed: wrong password or corrupt file.' });
    }
  };

  // 3. Export Masked Formats
  const handleExportFormat = async (format: 'json' | 'csv' | 'env') => {
    let data = '';
    let defaultName = '';
    let mime = 'text/plain';

    if (format === 'json') {
      data = ExportService.exportJson(false);
      defaultName = `ai-api-key-lab-export-${Date.now()}.json`;
      mime = 'application/json';
    } else if (format === 'csv') {
      data = ExportService.exportCsv();
      defaultName = `ai-api-key-lab-keys-${Date.now()}.csv`;
      mime = 'text/csv';
    } else if (format === 'env') {
      data = ExportService.exportDotEnv(false);
      defaultName = `.env.ai-api-keys`;
      mime = 'text/plain';
    }

    if (typeof window !== 'undefined' && window.electronAPI) {
      const res = await window.electronAPI.files.exportText({
        defaultName,
        content: data,
      });
      if (res.saved) {
        setStatusMessage({ type: 'success', text: `Exported ${format.toUpperCase()} (masked) to ${res.filePath}.` });
      }
      return;
    }

    downloadFile(data, defaultName, mime);
    setStatusMessage({ type: 'success', text: `Exported ${format.toUpperCase()} (masked) successfully.` });
  };

  // 4. Raw Secrets Export (Dangerous)
  const handleExportRawSecrets = async () => {
    const data = ExportService.exportJson(true);
    const defaultName = `ai-api-key-lab-UNMASKED-SECRETS-${Date.now()}.json`;
    if (typeof window !== 'undefined' && window.electronAPI) {
      const res = await window.electronAPI.files.exportText({
        defaultName,
        content: data,
      });
      if (res.saved) {
        setStatusMessage({ type: 'success', text: 'Unmasked secrets exported. Please store safely.' });
      }
      return;
    }
    downloadFile(data, defaultName, 'application/json');
    setStatusMessage({ type: 'success', text: 'Unmasked secrets exported. Please store safely.' });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        setRestoreFileJson((ev.target?.result as string) || '');
      };
      reader.readAsText(file);
    }
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <HardDriveDownload size={20} className="text-blue-400" />
          <span>{t('backup.title')}</span>
        </h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          {t('backup.subtitle')}
        </p>
      </div>

      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
          }`}
        >
          {statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Encrypted Backup Creation per §6 */}
      <section className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
            <Lock size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              {t('backup.createEncrypted')}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
              {t('backup.createEncryptedDesc')}
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateEncrypted} className="space-y-3 pt-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={backupPassphrase}
              onChange={e => setBackupPassphrase(e.target.value)}
              placeholder="Enter encryption password for backup (min 8 chars)..."
              className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
            >
              Export Encrypted .json
            </button>
          </div>
        </form>
      </section>

      {/* Restore Encrypted Backup */}
      <section className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 shrink-0">
            <Upload size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              {t('backup.restoreBackup')}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Decrypt and import an existing encrypted backup file into this session.
            </p>
          </div>
        </div>

        <form onSubmit={handleRestoreEncrypted} className="space-y-3 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Backup File</label>
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="w-full text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Backup Password</label>
              <input
                type="password"
                value={restorePassphrase}
                onChange={e => setRestorePassphrase(e.target.value)}
                placeholder="Enter password used when backing up..."
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={!restoreFileJson || !restorePassphrase}
              className="px-5 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded-xl transition-all cursor-pointer shadow-sm shadow-purple-500/20"
            >
              Decrypt & Restore
            </button>
          </div>
        </form>
      </section>

      {/* Masked Plain Exports */}
      <section className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            {t('backup.exportPlain')}
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Keys are safely masked (<span className="font-mono">sk-••••7F3A</span>) for team sharing and audits.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <button
            type="button"
            onClick={() => handleExportFormat('json')}
            className="flex items-center gap-2.5 p-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition-colors cursor-pointer"
          >
            <FileJson size={16} className="text-blue-400" />
            <span>Export JSON</span>
          </button>

          <button
            type="button"
            onClick={() => handleExportFormat('csv')}
            className="flex items-center gap-2.5 p-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition-colors cursor-pointer"
          >
            <FileSpreadsheet size={16} className="text-emerald-400" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => handleExportFormat('env')}
            className="flex items-center gap-2.5 p-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition-colors cursor-pointer"
          >
            <FileCode size={16} className="text-purple-400" />
            <span>Export .env</span>
          </button>
        </div>
      </section>

      {/* Dangerous Raw Secrets Export per §6 */}
      <section className="p-6 rounded-2xl border border-rose-500/20 bg-rose-950/10 backdrop-blur-sm space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-rose-300">
              {t('backup.exportSecrets')}
            </h3>
            <p className="text-xs text-zinc-400">
              {t('backup.dangerWarning')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowRawSecretExportConfirm(true)}
            className="px-4 py-2 text-xs font-semibold text-rose-300 hover:text-white bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 rounded-xl transition-colors cursor-pointer"
          >
            Export Raw Secrets
          </button>
        </div>
      </section>

      <ConfirmDialog
        isOpen={showRawSecretExportConfirm}
        onClose={() => setShowRawSecretExportConfirm(false)}
        onConfirm={handleExportRawSecrets}
        title="Export Raw Unmasked API Secrets?"
        description="WARNING: The exported file will contain plaintext API keys that can be read by anyone who accesses the file."
        itemsToRemove={['Security masking protections']}
        confirmLabel="Export Raw Secrets"
      />
    </div>
  );
};
