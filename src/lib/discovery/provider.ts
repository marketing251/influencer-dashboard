/**
 * DiscoveryProvider — the abstraction layer for platform discovery.
 *
 * Each platform implements this interface. The registry runs all enabled
 * providers in parallel during a refresh.
 *
 * Provider types:
 *   - "api"    : fully automated via official API (YouTube, X)
 *   - "import" : manual CSV/JSON upload or third-party enrichment (Instagram, LinkedIn)
 *   - "stub"   : placeholder — interface defined, not yet callable
 */

import type { DiscoveredCreator, DiscoveredPost } from '../pipeline';
import type { Platform } from '../types';

export interface DiscoveryResult {
  creator: DiscoveredCreator;
  posts: DiscoveredPost[];
}

export type ProviderType = 'api' | 'import' | 'stub';

export interface DiscoveryProvider {
  /** Platform identifier. */
  platform: Platform;

  /** How this provider sources data. */
  type: ProviderType;

  /** Human-readable name for logs and UI. */
  label: string;

  /**
   * Whether this provider can run right now.
   * Checks for required API keys, credits, etc.
   */
  isConfigured(): boolean;

  /**
   * Run discovery and return normalized creator + post objects.
   * Only callable when type === 'api' and isConfigured() === true.
   * Import providers return [] here — data comes via the import route.
   */
  discover(): Promise<DiscoveryResult[]>;

  /**
   * Human-readable reason why this provider can't run.
   * Shown in the UI and logs when isConfigured() returns false.
   */
  configHint(): string;
}
