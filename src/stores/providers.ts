/**
 * Provider State Store
 * Manages AI provider configurations
 */
import { create } from 'zustand';
import type { ProviderConfig, ProviderWithKeyInfo } from '@/lib/providers';

// Re-export types for consumers that imported from here
export type { ProviderConfig, ProviderWithKeyInfo } from '@/lib/providers';

function sanitizeApiKeyInput(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '').trim();
}

function sanitizeBaseUrlInput(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '').replace(/%00/gi, '').trim();
}

function sanitizeModelIdInput(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '')
    .replace(/%00/gi, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

interface ProviderState {
  providers: ProviderWithKeyInfo[];
  defaultProviderId: string | null;
  loading: boolean;
  error: string | null;
  
  // Actions
  fetchProviders: () => Promise<void>;
  addProvider: (config: Omit<ProviderConfig, 'createdAt' | 'updatedAt'>, apiKey?: string) => Promise<void>;
  updateProvider: (providerId: string, updates: Partial<ProviderConfig>, apiKey?: string) => Promise<void>;
  deleteProvider: (providerId: string) => Promise<void>;
  setApiKey: (providerId: string, apiKey: string) => Promise<void>;
  updateProviderWithKey: (
    providerId: string,
    updates: Partial<ProviderConfig>,
    apiKey?: string
  ) => Promise<void>;
  deleteApiKey: (providerId: string) => Promise<void>;
  setDefaultProvider: (providerId: string) => Promise<void>;
  validateApiKey: (
    providerId: string,
    apiKey: string,
    options?: { baseUrl?: string; model?: string }
  ) => Promise<{ valid: boolean; error?: string }>;
  getApiKey: (providerId: string) => Promise<string | null>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  defaultProviderId: null,
  loading: false,
  error: null,
  
  fetchProviders: async () => {
    set({ loading: true, error: null });
    
    try {
      const providers = await window.electron.ipcRenderer.invoke('provider:list') as ProviderWithKeyInfo[];
      const defaultId = await window.electron.ipcRenderer.invoke('provider:getDefault') as string | null;
      
      set({ 
        providers, 
        defaultProviderId: defaultId,
        loading: false 
      });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
  
  addProvider: async (config, apiKey) => {
    try {
      const fullConfig: ProviderConfig = {
        ...config,
        baseUrl: config.baseUrl ? sanitizeBaseUrlInput(config.baseUrl) : undefined,
        model: config.model ? sanitizeModelIdInput(config.model) : undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const sanitizedApiKey = apiKey !== undefined ? sanitizeApiKeyInput(apiKey) : undefined;
      
      const result = await window.electron.ipcRenderer.invoke('provider:save', fullConfig, sanitizedApiKey) as { success: boolean; error?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to save provider');
      }
      
      // Refresh the list
      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to add provider:', error);
      throw error;
    }
  },
  
  updateProvider: async (providerId, updates, apiKey) => {
    try {
      const existing = get().providers.find((p) => p.id === providerId);
      if (!existing) {
        throw new Error('Provider not found');
      }

      const { hasKey: _hasKey, keyMasked: _keyMasked, ...providerConfig } = existing;
      
      const updatedConfig: ProviderConfig = {
        ...providerConfig,
        ...updates,
        baseUrl: updates.baseUrl !== undefined
          ? (updates.baseUrl ? sanitizeBaseUrlInput(updates.baseUrl) : undefined)
          : providerConfig.baseUrl,
        model: updates.model !== undefined
          ? (updates.model ? sanitizeModelIdInput(updates.model) : undefined)
          : providerConfig.model,
        updatedAt: new Date().toISOString(),
      };
      const sanitizedApiKey = apiKey !== undefined ? sanitizeApiKeyInput(apiKey) : undefined;
      
      const result = await window.electron.ipcRenderer.invoke('provider:save', updatedConfig, sanitizedApiKey) as { success: boolean; error?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider');
      }
      
      // Refresh the list
      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to update provider:', error);
      throw error;
    }
  },
  
  deleteProvider: async (providerId) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('provider:delete', providerId) as { success: boolean; error?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete provider');
      }
      
      // Refresh the list
      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to delete provider:', error);
      throw error;
    }
  },
  
  setApiKey: async (providerId, apiKey) => {
    try {
      const sanitizedApiKey = sanitizeApiKeyInput(apiKey);
      const result = await window.electron.ipcRenderer.invoke('provider:setApiKey', providerId, sanitizedApiKey) as { success: boolean; error?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set API key');
      }
      
      // Refresh the list
      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to set API key:', error);
      throw error;
    }
  },

  updateProviderWithKey: async (providerId, updates, apiKey) => {
    try {
      const sanitizedUpdates: Partial<ProviderConfig> = {
        ...updates,
        baseUrl: updates.baseUrl !== undefined
          ? (updates.baseUrl ? sanitizeBaseUrlInput(updates.baseUrl) : undefined)
          : undefined,
        model: updates.model !== undefined
          ? (updates.model ? sanitizeModelIdInput(updates.model) : undefined)
          : undefined,
      };
      const sanitizedApiKey = apiKey !== undefined ? sanitizeApiKeyInput(apiKey) : undefined;
      const result = await window.electron.ipcRenderer.invoke(
        'provider:updateWithKey',
        providerId,
        sanitizedUpdates,
        sanitizedApiKey
      ) as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider');
      }

      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to update provider with key:', error);
      throw error;
    }
  },
  
  deleteApiKey: async (providerId) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('provider:deleteApiKey', providerId) as { success: boolean; error?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete API key');
      }
      
      // Refresh the list
      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to delete API key:', error);
      throw error;
    }
  },
  
  setDefaultProvider: async (providerId) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('provider:setDefault', providerId) as { success: boolean; error?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set default provider');
      }
      
      set({ defaultProviderId: providerId });
    } catch (error) {
      console.error('Failed to set default provider:', error);
      throw error;
    }
  },
  
  validateApiKey: async (providerId, apiKey, options) => {
    try {
      const sanitizedApiKey = sanitizeApiKeyInput(apiKey);
      const sanitizedOptions = options
        ? {
          baseUrl: options.baseUrl ? sanitizeBaseUrlInput(options.baseUrl) : undefined,
          model: options.model ? sanitizeModelIdInput(options.model) : undefined,
        }
        : options;
      const result = await window.electron.ipcRenderer.invoke(
        'provider:validateKey',
        providerId,
        sanitizedApiKey,
        sanitizedOptions
      ) as { valid: boolean; error?: string };
      return result;
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  },
  
  getApiKey: async (providerId) => {
    try {
      return await window.electron.ipcRenderer.invoke('provider:getApiKey', providerId) as string | null;
    } catch {
      return null;
    }
  },
}));
