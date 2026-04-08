'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Creator, CreatorAccount } from '@/lib/types';
import * as XLSX from 'xlsx';

type CreatorWithAccounts = Creator & { accounts: CreatorAccount[] };
type ExportFormat = 'csv' | 'xlsx';
type ExportAction = 'download' | 'email';

interface Props { creators: CreatorWithAccounts[] }

function flattenCreators(creators: CreatorWithAccounts[]) {
  return creators.map(c => ({
    Name: c.name,
    Status: c.status,
    'Lead Score': c.lead_score,
    Confidence: c.confidence_score,
    'Total Followers': c.total_followers,
    Website: c.website ?? '',
    Email: c.public_email ?? '',
    Phone: c.public_phone ?? '',
    Instagram: c.instagram_url ?? '',
    LinkedIn: c.linkedin_url ?? '',
    YouTube: c.youtube_url ?? '',
    X: c.x_url ?? '',
    Discord: c.discord_url ?? '',
    Telegram: c.telegram_url ?? '',
    'Link-in-Bio': c.link_in_bio_url ?? '',
    'Course URL': c.course_url ?? '',
    'Contact Form': c.contact_form_url ?? '',
    'Has Course': c.has_course ? 'Yes' : 'No',
    'Has Discord': c.has_discord ? 'Yes' : 'No',
    'Has Telegram': c.has_telegram ? 'Yes' : 'No',
    'Has Skool': c.has_skool ? 'Yes' : 'No',
    'Has Whop': c.has_whop ? 'Yes' : 'No',
    'Prop Firms': c.promoting_prop_firms ? 'Yes' : 'No',
    'Prop Firms List': (c.prop_firms_mentioned ?? []).join(', '),
    Niche: c.niche ?? '',
    Source: c.source_type ?? '',
    Platforms: (c.accounts ?? []).map(a => a.platform).join(', '),
    'First Seen': c.first_seen_at ? new Date(c.first_seen_at).toLocaleDateString() : '',
  }));
}

function generateFile(creators: CreatorWithAccounts[], format: ExportFormat) {
  const rows = flattenCreators(creators);
  const date = new Date().toISOString().split('T')[0];
  if (format === 'csv') {
    const ws = XLSX.utils.json_to_sheet(rows);
    return { blob: new Blob([XLSX.utils.sheet_to_csv(ws)], { type: 'text/csv;charset=utf-8;' }), filename: `leads-${date}.csv` };
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0] ?? {}).map(k => ({ wch: Math.min(Math.max(k.length, ...rows.map(r => String(r[k as keyof typeof r] ?? '').length)) + 2, 50) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  return { blob: new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename: `leads-${date}.xlsx` };
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function ExportMenu({ creators }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const doExport = useCallback((fmt: ExportFormat, action: ExportAction) => {
    if (!creators.length) return;
    const { blob, filename } = generateFile(creators, fmt);
    downloadBlob(blob, filename);
    if (action === 'email') {
      window.open(`mailto:?subject=${encodeURIComponent('Influencer Leads Export')}&body=${encodeURIComponent(`Attached: ${filename}`)}`, '_blank');
    }
    setOpen(false);
  }, [creators]);

  return (
    <div className="relative" ref={menuRef}>
      <button onClick={() => setOpen(!open)} disabled={!creators.length}
        className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Export
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl py-1"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Download</p>
          <MenuItem onClick={() => doExport('csv', 'download')} label="Export as CSV" />
          <MenuItem onClick={() => doExport('xlsx', 'download')} label="Export as .xlsx" />
          <div className="my-1" style={{ borderTop: '1px solid var(--border-subtle)' }} />
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Email</p>
          <MenuItem onClick={() => doExport('csv', 'email')} label="Email CSV" />
          <MenuItem onClick={() => doExport('xlsx', 'email')} label="Email .xlsx" />
          <div className="my-1" style={{ borderTop: '1px solid var(--border-subtle)' }} />
          <p className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {creators.length} creator{creators.length !== 1 ? 's' : ''} will be exported
          </p>
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors"
      style={{ color: 'var(--text-secondary)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
      {label}
    </button>
  );
}
