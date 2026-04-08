'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { CreatorDetail } from '@/lib/types';

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function CreatorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [creator, setCreator] = useState<CreatorDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/creators/${id}`).then(r => r.json()).then(data => { setCreator(data); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
    </div>
  );
  if (!creator) return <div className="py-20 text-center" style={{ color: 'var(--text-muted)' }}>Creator not found.</div>;

  return (
    <div className="space-y-8">
      {/* Back + Header */}
      <div>
        <Link href="/daily-leads" className="text-sm hover:underline" style={{ color: 'var(--text-muted)' }}>&larr; Back to leads</Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{creator.name}</h1>
          <Badge bg="var(--accent)" fg="#fff">{creator.status}</Badge>
          <Badge bg="var(--accent-gold-dim)" fg="var(--accent-gold)">Score: {creator.lead_score}</Badge>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Confidence: {creator.confidence_score}%</span>
          {creator.niche && <Badge bg="var(--bg-hover)" fg="var(--text-secondary)">{creator.niche}</Badge>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-4 lg:col-span-1">
          <Section title="Contact">
            <Field label="Website" value={creator.website} link />
            <Field label="Email" value={creator.public_email} />
            <Field label="Phone" value={creator.public_phone} />
            <Field label="Contact Form" value={creator.contact_form_url} link />
          </Section>

          <Section title="Stats">
            <Field label="Total Followers" value={fmt(creator.total_followers)} />
            <Field label="Primary Platform" value={creator.primary_platform} />
            <Field label="Niche" value={creator.niche} />
            <Field label="Source" value={creator.source_type} />
            <Field label="First Seen" value={creator.first_seen_at ? new Date(creator.first_seen_at).toLocaleDateString() : null} />
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
            <div className="flex flex-wrap gap-1.5">
              {creator.has_course && <Pill>Course</Pill>}
              {creator.has_discord && <Pill>Discord</Pill>}
              {creator.has_telegram && <Pill>Telegram</Pill>}
              {creator.has_skool && <Pill>Skool</Pill>}
              {creator.has_whop && <Pill>Whop</Pill>}
              {creator.promoting_prop_firms && <Pill gold>Prop Firms</Pill>}
            </div>
          </Section>

          {(creator.prop_firms_mentioned ?? []).length > 0 && (
            <Section title="Prop Firms Mentioned">
              <div className="flex flex-wrap gap-1.5">
                {creator.prop_firms_mentioned.map(f => <Pill key={f} gold>{f}</Pill>)}
              </div>
            </Section>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6 lg:col-span-2">
          <Section title="Social Accounts">
            {(creator.accounts ?? []).length > 0 ? (
              <div className="space-y-2">
                {creator.accounts.map(acc => (
                  <div key={acc.id} className="flex items-center justify-between rounded-lg px-3 py-2"
                    style={{ background: 'var(--bg-hover)' }}>
                    <div className="flex items-center gap-3">
                      <span className="rounded px-2 py-0.5 text-xs font-bold capitalize"
                        style={{ background: 'var(--accent-gold-dim)', color: 'var(--accent-gold)' }}>{acc.platform}</span>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>@{acc.handle}</span>
                      {acc.verified && <span className="text-xs" style={{ color: 'var(--accent)' }}>Verified</span>}
                    </div>
                    <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{fmt(acc.followers)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No linked accounts</p>
            )}
          </Section>

          {creator.posts && creator.posts.length > 0 && (
            <Section title="Recent Posts">
              <div className="space-y-2">
                {creator.posts.map(post => (
                  <div key={post.id} className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span className="capitalize">{post.platform}</span>
                      {post.published_at && <span>{new Date(post.published_at).toLocaleDateString()}</span>}
                      {post.mentions_prop_firm && <Pill gold>Prop Firm</Pill>}
                      {post.mentions_course && <Pill>Course</Pill>}
                    </div>
                    {post.title && <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{post.title}</p>}
                    {post.content_snippet && <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{post.content_snippet}</p>}
                    <div className="mt-2 flex gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>{fmt(post.views)} views</span>
                      <span>{fmt(post.likes)} likes</span>
                      <span>{fmt(post.comments)} comments</span>
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
                  <div key={o.id} className="flex items-center justify-between rounded-lg px-3 py-2"
                    style={{ background: 'var(--bg-hover)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm capitalize" style={{ color: 'var(--text-secondary)' }}>{o.channel}</span>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{o.subject || '(no subject)'}</span>
                    </div>
                    <Badge bg="var(--bg-hover)" fg="var(--text-secondary)">{o.status}</Badge>
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
    <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value, link }: { label: string; value: string | null; link?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
      {value ? (
        link ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm truncate max-w-[200px] hover:underline" style={{ color: 'var(--accent)' }}>{value.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</a>
        ) : (
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{value}</span>
        )
      ) : (
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>—</span>
      )}
    </div>
  );
}

function Badge({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: bg, color: fg }}>{children}</span>;
}

function Pill({ children, gold }: { children: React.ReactNode; gold?: boolean }) {
  return (
    <span className="rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: gold ? 'var(--accent-gold-dim)' : 'var(--bg-hover)', color: gold ? 'var(--accent-gold)' : 'var(--text-secondary)' }}>
      {children}
    </span>
  );
}
