import { useState, useEffect, useCallback } from 'react';
import { ApiKeyRecord } from '../types/key';
import { StorageService } from '../services/storage';
import { generateKeyFingerprint, maskKey } from '../services/crypto';
import { ProviderRegistry } from '../services/providerRegistry';

export function useKeys() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshKeys = useCallback(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.keys
        .list()
        .then((list) => {
          for (const k of list) {
            StorageService.saveKeyMetadata(k);
          }
          setKeys(list);
          setLoading(false);
        })
        .catch(() => {
          setKeys(StorageService.getKeys());
          setLoading(false);
        });
      return;
    }

    const list = StorageService.getKeys();
    setKeys(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshKeys();
  }, [refreshKeys]);

  const addKey = async (params: {
    label: string;
    providerId: string;
    secret: string;
    customBaseUrl?: string;
    selectedModel?: string;
    group?: string;
    labels?: string[];
    expiresAt?: string;
    expiryNote?: string;
  }): Promise<ApiKeyRecord> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const savedMeta = await window.electronAPI.keys.save({
        providerId: params.providerId,
        label: params.label.trim(),
        secret: params.secret.trim(),
        baseUrl: params.customBaseUrl?.trim() || undefined,
        selectedModel: params.selectedModel,
        group: params.group,
        labels: params.labels,
      });
      const withExpiry: ApiKeyRecord = {
        ...savedMeta,
        expiresAt: params.expiresAt || undefined,
        expiryNote: params.expiryNote?.trim() || undefined,
      };
      StorageService.saveKeyMetadata(withExpiry);
      refreshKeys();
      return withExpiry;
    }

    const provider = ProviderRegistry.get(params.providerId);
    if (!provider) {
      throw new Error(`Provider "${params.providerId}" not found`);
    }

    const boundHost = params.customBaseUrl
      ? new URL(params.customBaseUrl).hostname
      : provider.allowedHosts[0] || 'localhost';

    const installSalt = StorageService.getInstallSalt();
    const fingerprint = await generateKeyFingerprint(params.secret, installSalt);
    const masked = maskKey(params.secret);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const newKey: ApiKeyRecord = {
      id,
      label: params.label.trim(),
      providerId: params.providerId,
      boundHost,
      keyFingerprint: fingerprint,
      maskedKey: masked,
      status: 'untested',
      authVerified: 'unknown',
      selectedModel: params.selectedModel,
      customBaseUrl: params.customBaseUrl?.trim() || undefined,
      group: params.group,
      labels: params.labels || [],
      expiresAt: params.expiresAt || undefined,
      expiryNote: params.expiryNote?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    // Save secret into storage vault
    await StorageService.saveSecret(id, params.secret.trim());
    // Save metadata
    StorageService.saveKeyMetadata(newKey);

    refreshKeys();
    return newKey;
  };

  const updateKey = async (key: ApiKeyRecord, newSecret?: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      if (newSecret && newSecret.trim()) {
        const saved = await window.electronAPI.keys.save({
          id: key.id,
          providerId: key.providerId,
          label: key.label,
          secret: newSecret.trim(),
          baseUrl: key.customBaseUrl,
          selectedModel: key.selectedModel,
          group: key.group,
          labels: key.labels,
        });
        StorageService.saveKeyMetadata({
          ...saved,
          expiresAt: key.expiresAt,
          expiryNote: key.expiryNote,
        });
      } else {
        const updatedMeta = await window.electronAPI.keys.updateMeta(key.id, {
          label: key.label,
          status: key.status,
          authVerified: key.authVerified,
          lastTestedAt: key.lastTestedAt,
          lastKnownGood: key.lastKnownGood,
          selectedModel: key.selectedModel,
          customBaseUrl: key.customBaseUrl,
          customParams: key.customParams,
          group: key.group,
          labels: key.labels,
        });
        StorageService.saveKeyMetadata({
          ...updatedMeta,
          expiresAt: key.expiresAt,
          expiryNote: key.expiryNote,
        });
      }
      refreshKeys();
      return;
    }

    const updated = { ...key, updatedAt: new Date().toISOString() };

    if (newSecret && newSecret.trim()) {
      const installSalt = StorageService.getInstallSalt();
      const fingerprint = await generateKeyFingerprint(newSecret, installSalt);
      const masked = maskKey(newSecret);
      updated.keyFingerprint = fingerprint;
      updated.maskedKey = masked;
      updated.status = 'untested'; // Reset to untested on key edit
      await StorageService.saveSecret(key.id, newSecret.trim());
    }

    StorageService.saveKeyMetadata(updated);
    refreshKeys();
  };


  const deleteKey = (id: string) => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      void window.electronAPI.keys.delete(id).then(() => {
        StorageService.deleteKey(id);
        refreshKeys();
      });
      return;
    }
    StorageService.deleteKey(id);
    refreshKeys();
  };

  const markUntested = (id: string) => {
    const key = keys.find((k) => k.id === id);
    if (key) {
      const updated: ApiKeyRecord = {
        ...key,
        status: 'untested',
        authVerified: 'unknown',
        updatedAt: new Date().toISOString(),
      };
      if (typeof window !== 'undefined' && window.electronAPI) {
        void window.electronAPI.keys.updateMeta(id, {
          status: 'untested',
          authVerified: 'unknown',
        });
      }
      StorageService.saveKeyMetadata(updated);
      refreshKeys();
    }
  };

  return {
    keys,
    loading,
    refreshKeys,
    addKey,
    updateKey,
    deleteKey,
    markUntested,
  };
}
