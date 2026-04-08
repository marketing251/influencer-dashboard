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
  totalNew: number; totalUpdated: number; totalSkipped: number; totalErrors: number;
  attempted: number; target: number; targetReached: boolean; reason: string;
  enriched: number; emailsFound: number; phonesFound: number;
  sources: { name: string; discovered: number; inserted: number }[];
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
      let data;
      try {
        data = await res.json();
      } catch {
        // Server returned non-JSON (likely Vercel timeout HTML page)
        setRefreshStatus('error');
        setRefreshError(res.status === 504 || res.status === 502
          ? 'Request timed out — Vercel Hobby has a 10s limit. Try upgrading to Pro for longer refreshes.'
          : `Server returned invalid response (${res.status}). The refresh may still be running — check back in a moment.`);
        setTimeout(() => fetchCreators(), 5000); // refresh table in case data was partially saved
        return;
      }
      if (!res.ok) { setRefreshStatus('error'); setRefreshError(data.error ?? `Failed (${res.status})`); return; }

      const s = data.summary ?? {};
      const totalNew = s.total_new ?? 0;
      const totalUpdated = s.total_updated ?? 0;
      const totalSkipped = s.total_skipped ?? 0;
      const totalErrors = s.total_errors ?? 0;
      const targetReached = s.target_reached ?? false;
      const target = s.target ?? 100;
      const reason = s.reason ?? '';

      const enriched = data.enrichment?.enriched ?? 0;
      const emailsFound = data.enrichment?.emails_found ?? 0;
      const phonesFound = data.enrichment?.phones_found ?? 0;

      // Per-source breakdown
      const sources: { name: string; discovered: number; inserted: number }[] = [];
      let attempted = 0;
      for (const [name, result] of Object.entries(data.platforms ?? {})) {
        const r = result as { discovered?: number; new?: number; skippedReason?: string } | null;
        if (!r || r.skippedReason) continue;
        const disc = r.discovered ?? 0;
        const ins = r.new ?? 0;
        attempted += disc;
        if (disc > 0) sources.push({ name, discovered: disc, inserted: ins });
      }

      setRefreshStats({
        totalNew, totalUpdated, totalSkipped, totalErrors,
        attempted, target, targetReached, reason,
        enriched, emailsFound, phonesFound, sources,
        timestamp: new Date().toLocaleTimeString(),
      });

      if (totalNew + totalUpdated > 0) setRefreshStatus('success');
      else if (totalErrors > 0) { setRefreshStatus('error'); setRefreshError(`${totalErrors} errors`); }
      else setRefreshStatus('success');

      fetchCreators();
      setTimeout(() => setRefreshStatus(s => s === 'success' ? 'idle' : s), 10000);
    } catch (err) {
      setRefreshStatus('error');
      setRefreshError(err instanceof Error ? err.message : 'Network error');
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Daily Leads</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{creators.length}</span> creators
            {refreshStats?.timestamp && <> &middot; Updated {refreshStats.timestamp}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} disabled={refreshStatus === 'running'}
            className="inline-flex items-center gap-2 rounded-[var(--radius)] px-4 py-2 text-[13px] font-semibold transition-all disabled:opacity-50"
            style={{ background: 'var(--accent-gold)', color: '#0A0F1A', boxShadow: '0 1px 8px rgba(242,205,122,0.2)' }}>
            <svg className={`h-3.5 w-3.5 ${refreshStatus === 'running' ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {refreshStatus === 'running' ? 'Searching...' : 'Refresh Leads'}
          </button>
          <ExportMenu creators={creators} />
          <div className="hidden sm:flex rounded-[var(--radius-sm)] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['table', 'grid'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider"
                style={{ background: view === v ? 'var(--accent)' : 'transparent', color: view === v ? '#fff' : 'var(--text-muted)' }}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Status banners ── */}
      {refreshStatus === 'running' && (
        <StatusBanner type="info"><Spinner /> Searching the internet for the best leads for you...</StatusBanner>
      )}
      {refreshStatus === 'success' && refreshStats && (
        <div className="space-y-2">
          <StatusBanner type="success">
            <CheckIcon />
            <div className="flex-1">
              <div className="font-medium">
                {refreshStats.totalNew > 0 ? `${refreshStats.totalNew} new leads inserted` : 'All leads up to date'}
                {refreshStats.targetReached && ' \u2014 Target reached'}
              </div>
              <div className="mt-0.5 text-[12px] opacity-80">
                Attempted: {refreshStats.attempted}
                {refreshStats.totalUpdated > 0 && ` \u00b7 ${refreshStats.totalUpdated} dupes updated`}
                {refreshStats.totalSkipped > 0 && ` \u00b7 ${refreshStats.totalSkipped} rejected`}
                {refreshStats.emailsFound > 0 && ` \u00b7 ${refreshStats.emailsFound} emails`}
                {refreshStats.phonesFound > 0 && ` \u00b7 ${refreshStats.phonesFound} phones`}
              </div>
              {refreshStats.sources.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] opacity-70">
                  {refreshStats.sources.map(s => (
                    <span key={s.name} className="capitalize">{s.name}: {s.inserted}/{s.discovered}</span>
                  ))}
                </div>
              )}
              {!refreshStats.targetReached && refreshStats.reason && (
                <div className="mt-1 text-[11px] opacity-60">{refreshStats.reason}</div>
              )}
            </div>
          </StatusBanner>
        </div>
      )}
      {refreshStatus === 'error' && refreshError && (
        <StatusBanner type="error">
          <ErrorIcon /> {refreshError}
          <button onClick={() => setRefreshStatus('idle')} className="ml-auto text-xs opacity-60 hover:opacity-100">Dismiss</button>
        </StatusBanner>
      )}

      {/* ── Filters ── */}
      <Filters />

      {/* ── Content ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Spinner large />
          <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>Loading leads...</p>
        </div>
      ) : creators.length === 0 ? (
        <div className="rounded-[var(--radius)] p-16 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'var(--accent-gold-dim)' }}>
            <svg className="h-6 w-6" style={{ color: 'var(--accent-gold)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>No leads found</h2>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {searchParams.toString() ? 'Try adjusting your filters.' : 'Click "Refresh Leads" to discover trading creators.'}
          </p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{creators.map(c => <CreatorCard key={c.id} creator={c} />)}</div>
      ) : (
        <CreatorTable creators={creators} />
      )}
    </div>
  );
}

function StatusBanner({ children, type }: { children: React.ReactNode; type: 'info' | 'success' | 'error' }) {
  const colors = { info: { bg: 'var(--info-bg)', border: 'var(--info)', fg: 'var(--info)' }, success: { bg: 'var(--success-bg)', border: 'var(--success)', fg: 'var(--success)' }, error: { bg: 'var(--error-bg)', border: 'var(--error)', fg: 'var(--error)' } };
  const c = colors[type];
  return <div className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3.5 py-2.5 text-[13px]" style={{ background: c.bg, borderLeft: `3px solid ${c.border}`, color: c.fg }}>{children}</div>;
}

function Spinner({ large }: { large?: boolean }) {
  return <div className={`${large ? 'h-7 w-7 border-[2.5px]' : 'h-3.5 w-3.5 border-2'} animate-spin rounded-full`} style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />;
}
function CheckIcon() { return <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
function ErrorIcon() { return <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>; }

export default function DailyLeadsPage() {
  return <Suspense fallback={<div className="py-24 text-center" style={{ color: 'var(--text-muted)' }}>Loading...</div>}><DailyLeadsContent /></Suspense>;
}
