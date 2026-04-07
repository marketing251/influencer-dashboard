'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { Filters } from '@/components/filters';
import { CreatorCard } from '@/components/creator-card';
import { CreatorTable } from '@/components/creator-table';
import { ExportMenu } from '@/components/export-menu';
import type { Creator, CreatorAccount } from '@/lib/types';

type CreatorWithAccounts = Creator & { accounts: CreatorAccount[] };

function DailyLeadsContent() {
  const searchParams = useSearchParams();
  const [creators, setCreators] = useState<CreatorWithAccounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'grid' | 'table'>('table');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/creators?${searchParams.toString()}`)
      .then(r => r.json())
      .then(data => {
        setCreators(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [searchParams]);

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
              : 'Run a discovery to start finding creators. Use the YouTube Test page or trigger the discovery API.'}
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
