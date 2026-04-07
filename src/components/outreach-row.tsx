import type { Outreach } from '@/lib/types';

const statusColors: Record<string, string> = {
  draft: 'bg-zinc-700 text-zinc-300',
  queued: 'bg-blue-500/20 text-blue-400',
  sent: 'bg-amber-500/20 text-amber-400',
  opened: 'bg-purple-500/20 text-purple-400',
  replied: 'bg-green-500/20 text-green-400',
  bounced: 'bg-red-500/20 text-red-400',
};

interface Props {
  item: Outreach & { creator_name?: string };
}

export function OutreachRow({ item }: Props) {
  return (
    <tr className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
      <td className="px-4 py-3 font-medium text-white">
        {item.creator_name || item.creator_id.slice(0, 8)}
      </td>
      <td className="px-4 py-3 text-zinc-400">{item.channel}</td>
      <td className="max-w-[250px] truncate px-4 py-3 text-zinc-400">
        {item.subject || '—'}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status]}`}>
          {item.status}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-zinc-500">
        {item.sent_at ? new Date(item.sent_at).toLocaleDateString() : '—'}
      </td>
      <td className="max-w-[200px] truncate px-4 py-3 text-xs text-zinc-500">
        {item.response || '—'}
      </td>
    </tr>
  );
}
