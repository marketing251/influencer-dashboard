'use client';

import { useEffect, useState } from 'react';
import { OutreachRow } from '@/components/outreach-row';
import type { Outreach } from '@/lib/types';

type OutreachWithName = Outreach & { creator_name?: string };

const tabs = ['all', 'draft', 'queued', 'sent', 'opened', 'replied', 'bounced'] as const;

export default function OutreachPage() {
  const [items, setItems] = useState<OutreachWithName[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = filter !== 'all' ? `?status=${filter}` : '';
    fetch(`/api/outreach${params}`)
      .then(r => r.json())
      .then(data => {
        setItems(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Outreach Queue</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage outreach to discovered creators
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
              filter === tab ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-zinc-500">Loading...</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-zinc-500">No outreach items found.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/50 text-left text-xs text-zinc-500">
                <th className="px-4 py-3 font-medium">Creator</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">Response</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <OutreachRow key={item.id} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
