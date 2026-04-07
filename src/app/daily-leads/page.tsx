'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { Filters } from '@/components/filters';
import { CreatorCard } from '@/components/creator-card';
import { CreatorTable } from '@/components/creator-table';
import { ExportMenu } from '@/components/export-menu';
import type { Creator, CreatorAccount } from '@/lib/types';

type CreatorWithAccounts = Creator & { accounts: CreatorAccount[] };
type RefreshStatus = 'idle' | 'running' | 'success' | 'error';

function DailyLeadsContent() {
  const searchParams = useSearchParams();
  const [creators, setCreators] = useState<CreatorWithAccounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'grid' | 'table'>('table');

  // Refresh state
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle');
  const [refreshMessage, setRefreshMessage] = useState('');

  const fetchCreators = useCallback(() => {
    setLoading(true);
    fetch(`/api/creators?${searchParams.toString()}`)
      .then(r => r.json())
      .then(data => {
        setCreators(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [searchParams]);

  useEffect(() => {
    fetchCreators();
  }, [fetchCreators]);

  const handleRefresh = async () => {
    setRefreshStatus('running');
    setRefreshMessage('');
    try {
      const res = await fetch('/api/refresh-leads', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setRefreshStatus('error');
        setRefreshMessage(data.error ?? `Request failed (${res.status})`);
        return;
      }

      // Aggregate results across all platforms
      const platforms = data.platforms ?? { youtube: data.youtube, x: data.x };
      let totalNew = 0, totalUpdated = 0, totalErrors = 0;
      const skipped: string[] = [];

      for (const [name, result] of Object.entries(platforms)) {
        const r = result as { new?: number; updated?: number; errors?: number; skippedReason?: string } | null;
        if (!r) continue;
        if (r.skippedReason) { skipped.push(name); continue; }
        totalNew += r.new ?? 0;
        totalUpdated += r.updated ?? 0;
        totalErrors += r.errors ?? 0;
      }

      const enriched = data.enrichment?.enriched ?? 0;

      const parts: string[] = [];
      if (totalNew > 0) parts.push(`${totalNew} new`);
      if (totalUpdated > 0) parts.push(`${totalUpdated} updated`);
      if (enriched > 0) parts.push(`${enriched} enriched`);
      if (skipped.length > 0) parts.push(`${skipped.join(', ')} skipped (no API key/credits)`);
      if (totalErrors > 0) parts.push(`${totalErrors} errors`);

      setRefreshStatus('success');
      setRefreshMessage(parts.length > 0 ? parts.join(' | ') : 'No new creators found — check API keys and quotas');

      // Refetch the table data
      fetchCreators();

      // Clear success banner after 8 seconds
      setTimeout(() => {
        setRefreshStatus(prev => prev === 'success' ? 'idle' : prev);
        setRefreshMessage('');
      }, 8000);
    } catch (err) {
      setRefreshStatus('error');
      setRefreshMessage(err instanceof Error ? err.message : 'Network error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Daily Leads</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {creators.length} creator{creators.length !== 1 ? 's' : ''} found
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Refresh Leads button */}
          <button
            onClick={handleRefresh}
            disabled={refreshStatus === 'running'}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <svg
              className={`h-4 w-4 ${refreshStatus === 'running' ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {refreshStatus === 'running' ? 'Refreshing...' : 'Refresh Leads'}
          </button>

          <ExportMenu creators={creators} />
          <div className="flex gap-1">
            <button
              onClick={() => setView('grid')}
              className={`rounded-md px-3 py-1.5 text-sm ${view === 'grid' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
            >
              Grid
            </button>
            <button
              onClick={() => setView('table')}
              className={`rounded-md px-3 py-1.5 text-sm ${view === 'table' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Refresh status banner */}
      {refreshStatus === 'running' && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400/30 border-t-blue-400" />
          <p className="text-sm text-blue-300">
            Searching the internet for the best leads for you...
          </p>
        </div>
      )}
      {refreshStatus === 'success' && refreshMessage && (
        <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3">
          <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-green-300">Refresh complete — {refreshMessage}</p>
        </div>
      )}
      {refreshStatus === 'error' && refreshMessage && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <svg className="h-4 w-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-sm text-red-300">{refreshMessage}</p>
          </div>
          <button
            onClick={() => { setRefreshStatus('idle'); setRefreshMessage(''); }}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      <Filters />

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
          <p className="mt-3 text-sm text-zinc-500">Loading creators...</p>
        </div>
      ) : creators.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
            <svg className="h-6 w-6 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">No leads found</h2>
          <p className="mt-2 text-sm text-zinc-500">
            {searchParams.toString()
              ? 'No creators match your current filters. Try adjusting or clearing them.'
              : 'Click "Refresh Leads" above to discover creators from YouTube and X.'}
          </p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {creators.map(c => (
            <CreatorCard key={c.id} creator={c} />
          ))}
        </div>
      ) : (
        <CreatorTable creators={creators} />
      )}
    </div>
  );
}

export default function DailyLeadsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-zinc-500">Loading...</div>}>
      <DailyLeadsContent />
    </Suspense>
  );
}
