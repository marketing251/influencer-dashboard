'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Creator, CreatorAccount } from '@/lib/types';
import * as XLSX from 'xlsx';

type CreatorWithAccounts = Creator & { accounts: CreatorAccount[] };

interface Props {
  creators: CreatorWithAccounts[];
}

type ExportFormat = 'csv' | 'xlsx';
type ExportAction = 'download' | 'email';

// ─── Flatten creator data for export ────────────────────────────────

function flattenCreators(creators: CreatorWithAccounts[]) {
  return creators.map(c => ({
    Name: c.name,
    Status: c.status,
    'Lead Score': c.lead_score,
    'Confidence': c.confidence_score,
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
    'Has Course': c.has_course ? 'Yes' : 'No',
    'Has Discord': c.has_discord ? 'Yes' : 'No',
    'Has Telegram': c.has_telegram ? 'Yes' : 'No',
    'Has Skool': c.has_skool ? 'Yes' : 'No',
    'Has Whop': c.has_whop ? 'Yes' : 'No',
    'Prop Firms': c.promoting_prop_firms ? 'Yes' : 'No',
    'Prop Firms List': (c.prop_firms_mentioned ?? []).join(', '),
    Niche: c.niche ?? '',
    'Primary Platform': c.primary_platform ?? '',
    Source: c.source_type ?? '',
    'Source URL': c.source_url ?? '',
    Platforms: c.accounts.map(a => a.platform).join(', '),
    Handles: c.accounts.map(a => `${a.platform}: @${a.handle}`).join('; '),
    'First Seen': c.first_seen_at ? new Date(c.first_seen_at).toLocaleDateString() : '',
  }));
}

// ─── Generate file ──────────────────────────────────────────────────

function generateFile(creators: CreatorWithAccounts[], format: ExportFormat): { blob: Blob; filename: string } {
  const rows = flattenCreators(creators);
  const date = new Date().toISOString().split('T')[0];

  if (format === 'csv') {
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    return {
      blob: new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      filename: `influencer-leads-${date}.csv`,
    };
  }

  // XLSX
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const colWidths = Object.keys(rows[0] ?? {}).map(key => ({
    wch: Math.max(key.length, ...rows.map(r => String(r[key as keyof typeof r] ?? '').length)).valueOf(),
  }));
  ws['!cols'] = colWidths.map(w => ({ wch: Math.min(w.wch + 2, 50) }));

  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return {
    blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename: `influencer-leads-${date}.xlsx`,
  };
}

// ─── Download helper ────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Email helper (opens mailto with attachment note) ───────────────

function emailFile(blob: Blob, filename: string, format: ExportFormat) {
  // Browsers can't attach files to mailto: links directly.
  // Download the file first, then open a pre-filled mailto.
  downloadBlob(blob, filename);

  const subject = encodeURIComponent('Influencer Leads Export');
  const body = encodeURIComponent(
    `Hi,\n\nPlease find the influencer leads export attached.\n\nFile: ${filename}\nFormat: ${format.toUpperCase()}\n\nBest regards`,
  );
  window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
}

// ─── Component ──────────────────────────────────────────────────────

export function ExportMenu({ creators }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleExport = useCallback((format: ExportFormat, action: ExportAction) => {
    if (!creators.length) return;
    const { blob, filename } = generateFile(creators, format);

    if (action === 'download') {
      downloadBlob(blob, filename);
    } else {
      emailFile(blob, filename, format);
    }
    setOpen(false);
  }, [creators]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={!creators.length}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Export
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Download
          </p>
          <button
            onClick={() => handleExport('csv', 'download')}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            <FileIcon />
            Export as CSV
          </button>
          <button
            onClick={() => handleExport('xlsx', 'download')}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            <SpreadsheetIcon />
            Export as .xlsx
          </button>

          <div className="my-1 border-t border-zinc-800" />

          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Email
          </p>
          <button
            onClick={() => handleExport('csv', 'email')}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            <MailIcon />
            Email CSV
          </button>
          <button
            onClick={() => handleExport('xlsx', 'email')}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            <MailIcon />
            Email .xlsx
          </button>

          <div className="my-1 border-t border-zinc-800" />
          <p className="px-3 py-1.5 text-[11px] text-zinc-600">
            {creators.length} creator{creators.length !== 1 ? 's' : ''} will be exported
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────

function FileIcon() {
  return (
    <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function SpreadsheetIcon() {
  return (
    <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M10.875 12c-.621 0-1.125.504-1.125 1.125M12 12c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125M12 15.375c0 .621-.504 1.125-1.125 1.125" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );
}
