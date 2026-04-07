/**
 * Provider registry — central place to register and query discovery providers.
 */

import type { DiscoveryProvider } from './provider';
import { youtubeProvider } from './youtube-provider';
import { xProvider } from './x-provider';
import { instagramProvider } from './instagram-provider';
import { linkedinProvider } from './linkedin-provider';
import { webSearchInstagramProvider, webSearchLinkedInProvider } from './web-search-provider';

/** All registered providers, in execution order. */
const providers: DiscoveryProvider[] = [
  youtubeProvider,
  xProvider,
  webSearchInstagramProvider,
  webSearchLinkedInProvider,
  instagramProvider,   // import-only fallback
  linkedinProvider,    // import-only fallback
];

/** Get all registered providers. */
export function getAllProviders(): DiscoveryProvider[] {
  return providers;
}

/** Get providers that can run automated discovery (type === 'api'). */
export function getApiProviders(): DiscoveryProvider[] {
  return providers.filter(p => p.type === 'api');
}

/** Get providers that accept imported data (type === 'import'). */
export function getImportProviders(): DiscoveryProvider[] {
  return providers.filter(p => p.type === 'import');
}

/** Get a specific provider by platform name. */
export function getProvider(platform: string): DiscoveryProvider | undefined {
  return providers.find(p => p.platform === platform);
}

/** Get a summary of all providers for the UI. */
export function getProviderStatus() {
  return providers.map(p => ({
    platform: p.platform,
    type: p.type,
    label: p.label,
    configured: p.isConfigured(),
    hint: p.isConfigured() ? null : p.configHint(),
  }));
}
