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
  const [view, setView] = useState<'grid' | 'table'>('grid');

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
        <div className="py-12 text-center text-zinc-500">Loading creators...</div>
      ) : creators.length === 0 ? (
        <div className="py-12 text-center text-zinc-500">No creators match your filters.</div>
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
