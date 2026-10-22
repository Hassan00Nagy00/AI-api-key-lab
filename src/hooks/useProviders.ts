import { useState, useEffect, useCallback } from 'react';
import { ProviderConfig } from '../types/provider';
import { ProviderRegistry } from '../services/providerRegistry';

export function useProviders() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);

  const refreshProviders = useCallback(() => {
    const list = ProviderRegistry.getAll();
    setProviders(list);
  }, []);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  const addCustomProvider = (config: ProviderConfig) => {
    ProviderRegistry.registerProvider(config);
    refreshProviders();
  };

  return {
    providers,
    refreshProviders,
    addCustomProvider,
  };
}
