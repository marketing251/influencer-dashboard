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

interface RefreshStats {
  totalNew: number;
  totalUpdated: number;
  totalErrors: number;
  skipped: string[];
  enriched: number;
  timestamp: string;
}

function DailyLeadsContent() {
  const searchParams = useSearchParams();
  const [creators, setCreators] = useState<CreatorWithAccounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle');
  const [refreshStats, setRefreshStats] = useState<RefreshStats | null>(null);
  const [refreshError, setRefreshError] = useState('');

  const fetchCreators = useCallback(() => {
    setLoading(true);
    fetch(`/api/creators?${searchParams.toString()}`)
      .then(r => r.json())
      .then(data => { setCreators(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [searchParams]);

  useEffect(() => { fetchCreators(); }, [fetchCreators]);

  const handleRefresh = async () => {
    setRefreshStatus('running');
    setRefreshError('');
    try {
      const res = await fetch('/api/refresh-leads', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setRefreshStatus('error');
        setRefreshError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      const platforms = data.platforms ?? {};
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

      setRefreshStats({
        totalNew, totalUpdated, totalErrors, skipped, enriched,
        timestamp: new Date().toLocaleTimeString(),
      });

      if (totalNew + totalUpdated > 0) {
        setRefreshStatus('success');
      } else if (totalErrors > 0) {
        setRefreshStatus('error');
        setRefreshError(`Encountered ${totalErrors} errors during discovery`);
      } else {
        setRefreshStatus('success');
      }

      fetchCreators();
      setTimeout(() => { if (refreshStatus === 'success') setRefreshStatus('idle'); }, 10000);
    } catch (err) {
      setRefreshStatus('error');
      setRefreshError(err instanceof Error ? err.message : 'Network error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Daily Leads</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {creators.length} creator{creators.length !== 1 ? 's' : ''} found
            {refreshStats?.timestamp && (
              <span style={{ color: 'var(--text-muted)' }}> &middot; Last refresh: {refreshStats.timestamp}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleRefresh} disabled={refreshStatus === 'running'}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-60"
            style={{ background: 'var(--accent-gold)', color: '#07101D', boxShadow: '0 2px 12px rgba(242,205,122,0.3)' }}>
            <svg className={`h-4 w-4 ${refreshStatus === 'running' ? 'animate-spin' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {refreshStatus === 'running' ? 'Searching...' : 'Refresh New Leads'}
          </button>
          <ExportMenu creators={creators} />
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['table', 'grid'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className="px-3 py-1.5 text-xs font-medium capitalize"
                style={{
                  background: view === v ? 'var(--accent)' : 'transparent',
                  color: view === v ? '#fff' : 'var(--text-muted)',
                }}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Status banners */}
      {refreshStatus === 'running' && (
        <Banner bg="var(--info-bg)" border="var(--info)" color="var(--info)">
          <Spinner /> Searching the internet for the best leads for you...
        </Banner>
      )}
      {refreshStatus === 'success' && refreshStats && (
        <Banner bg="var(--success-bg)" border="var(--success)" color="var(--success)">
          <CheckIcon />
          {refreshStats.totalNew > 0
            ? `${refreshStats.totalNew} new leads found`
            : 'All leads up to date'}
          {refreshStats.totalUpdated > 0 && ` | ${refreshStats.totalUpdated} updated`}
          {refreshStats.enriched > 0 && ` | ${refreshStats.enriched} enriched`}
          {refreshStats.skipped.length > 0 && ` | ${refreshStats.skipped.join(', ')} skipped`}
        </Banner>
      )}
      {refreshStatus === 'error' && refreshError && (
        <Banner bg="var(--error-bg)" border="var(--error)" color="var(--error)">
          <ErrorIcon /> {refreshError}
          <button onClick={() => setRefreshStatus('idle')}
            className="ml-auto text-xs opacity-60 hover:opacity-100">Dismiss</button>
        </Banner>
      )}

      <Filters />

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Spinner large />
          <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>Loading leads...</p>
        </div>
      ) : creators.length === 0 ? (
        <div className="rounded-xl p-16 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-gold-dim)' }}>
            <svg className="h-7 w-7" style={{ color: 'var(--accent-gold)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>No leads found</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {searchParams.toString()
              ? 'No creators match your current filters. Try adjusting or clearing them.'
              : 'Click "Refresh New Leads" to discover trading creators from YouTube, Instagram, and LinkedIn.'}
          </p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {creators.map(c => <CreatorCard key={c.id} creator={c} />)}
        </div>
      ) : (
        <CreatorTable creators={creators} />
      )}
    </div>
  );
}

// ─── Small UI helpers ───────────────────────────────────────────────

function Banner({ children, bg, border, color }: { children: React.ReactNode; bg: string; border: string; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm"
      style={{ background: bg, border: `1px solid ${border}`, color }}>{children}</div>
  );
}

function Spinner({ large }: { large?: boolean }) {
  const size = large ? 'h-8 w-8' : 'h-4 w-4';
  return <div className={`${size} animate-spin rounded-full border-2`}
    style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />;
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  );
}

export default function DailyLeadsPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center" style={{ color: 'var(--text-muted)' }}>Loading...</div>}>
      <DailyLeadsContent />
    </Suspense>
  );
}
