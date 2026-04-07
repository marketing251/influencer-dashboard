'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { CreatorDetail } from '@/lib/types';

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/20 text-blue-400',
  contacted: 'bg-amber-500/20 text-amber-400',
  replied: 'bg-green-500/20 text-green-400',
  qualified: 'bg-purple-500/20 text-purple-400',
  rejected: 'bg-red-500/20 text-red-400',
  converted: 'bg-emerald-500/20 text-emerald-400',
};

function formatFollowers(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function CreatorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [creator, setCreator] = useState<CreatorDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/creators/${id}`)
      .then(r => r.json())
      .then(data => {
        setCreator(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="py-12 text-center text-zinc-500">Loading...</div>;
  if (!creator) return <div className="py-12 text-center text-zinc-500">Creator not found.</div>;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link href="/daily-leads" className="text-sm text-zinc-500 hover:text-zinc-300">
          &larr; Back to leads
        </Link>
        <div className="mt-2 flex items-center gap-4">
          <h1 className="text-2xl font-bold text-white">{creator.name}</h1>
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusColors[creator.status]}`}>
            {creator.status}
          </span>
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-sm font-medium text-amber-400">
            Score: {creator.lead_score}
          </span>
          <span className="text-sm text-zinc-500">
            Confidence: {creator.confidence_score}%
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Info Panel */}
        <div className="space-y-4 lg:col-span-1">
          <Section title="Contact">
            <Field label="Website" value={creator.website} link />
            <Field label="Email" value={creator.public_email} />
            <Field label="Phone" value={creator.public_phone} />
          </Section>

          <Section title="Stats">
            <Field label="Total Followers" value={formatFollowers(creator.total_followers)} />
            <Field label="Niche" value={creator.niche} />
            <Field label="Primary Platform" value={creator.primary_platform} />
            <Field label="Source" value={creator.source_type} />
          </Section>

          <Section title="Profiles">
            <Field label="Instagram" value={creator.instagram_url} link />
            <Field label="LinkedIn" value={creator.linkedin_url} link />
            <Field label="YouTube" value={creator.youtube_url} link />
            <Field label="X" value={creator.x_url} link />
            <Field label="Discord" value={creator.discord_url} link />
            <Field label="Telegram" value={creator.telegram_url} link />
            <Field label="Link-in-Bio" value={creator.link_in_bio_url} link />
            <Field label="Course" value={creator.course_url} link />
          </Section>

          <Section title="Signals">
            <Field label="Has Course" value={creator.has_course ? 'Yes' : 'No'} />
            <Field label="Has Discord" value={creator.has_discord ? 'Yes' : 'No'} />
            <Field label="Has Telegram" value={creator.has_telegram ? 'Yes' : 'No'} />
            <Field label="Has Skool" value={creator.has_skool ? 'Yes' : 'No'} />
            <Field label="Has Whop" value={creator.has_whop ? 'Yes' : 'No'} />
            <Field label="Prop Firms" value={creator.promoting_prop_firms ? 'Yes' : 'No'} />
          </Section>

          {creator.prop_firms_mentioned.length > 0 && (
            <Section title="Prop Firms Mentioned">
              <div className="flex flex-wrap gap-1.5">
                {creator.prop_firms_mentioned.map(f => (
                  <span key={f} className="rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                    {f}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {creator.notes && (
            <Section title="Notes">
              <p className="text-sm text-zinc-400">{creator.notes}</p>
            </Section>
          )}
        </div>

        {/* Accounts & Posts */}
        <div className="space-y-6 lg:col-span-2">
          <Section title="Social Accounts">
            <div className="space-y-2">
              {creator.accounts.map(acc => (
                <div key={acc.id} className="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-zinc-700 px-2 py-0.5 text-xs font-bold capitalize text-zinc-300">
                      {acc.platform}
                    </span>
                    <span className="text-sm text-white">@{acc.handle}</span>
                    {acc.verified && <span className="text-xs text-blue-400">Verified</span>}
                  </div>
                  <div className="text-sm text-zinc-400">{formatFollowers(acc.followers)}</div>
                </div>
              ))}
            </div>
          </Section>

          {creator.posts && creator.posts.length > 0 && (
            <Section title="Recent Posts">
              <div className="space-y-2">
                {creator.posts.map(post => (
                  <div key={post.id} className="rounded border border-zinc-800 bg-zinc-900/50 p-3">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span className="capitalize">{post.platform}</span>
                      {post.published_at && (
                        <span>{new Date(post.published_at).toLocaleDateString()}</span>
                      )}
                      {post.mentions_prop_firm && (
                        <span className="rounded bg-green-500/20 px-1.5 text-green-400">Prop Firm</span>
                      )}
                      {post.mentions_course && (
                        <span className="rounded bg-purple-500/20 px-1.5 text-purple-400">Course</span>
                      )}
                    </div>
                    {post.title && <p className="mt-1 text-sm font-medium text-white">{post.title}</p>}
                    {post.content_snippet && (
                      <p className="mt-1 text-sm text-zinc-400">{post.content_snippet}</p>
                    )}
                    <div className="mt-2 flex gap-4 text-xs text-zinc-600">
                      <span>{formatFollowers(post.views)} views</span>
                      <span>{formatFollowers(post.likes)} likes</span>
                      <span>{formatFollowers(post.comments)} comments</span>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {creator.outreach_history && creator.outreach_history.length > 0 && (
            <Section title="Outreach History">
              <div className="space-y-2">
                {creator.outreach_history.map(o => (
                  <div key={o.id} className="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm capitalize text-zinc-400">{o.channel}</span>
                      <span className="text-sm text-zinc-300">{o.subject || '(no subject)'}</span>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[o.status] || 'text-zinc-400'}`}>
                      {o.status}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-400">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value, link }: { label: string; value: string | null; link?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-zinc-500">{label}</span>
      {value ? (
        link ? (
          <span className="text-sm text-blue-400">{value}</span>
        ) : (
          <span className="text-sm text-zinc-300">{value}</span>
        )
      ) : (
        <span className="text-sm text-zinc-700">—</span>
      )}
    </div>
  );
}
