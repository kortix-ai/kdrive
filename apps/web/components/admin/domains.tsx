'use client';

// Admin → Domains: usage grouped by the domain of each person's address (kortix.ai, gmail.com, …),
// most storage first. A row expands into the people at that domain; a person opens their detail.
import { useState } from 'react';
import useSWR from 'swr';
import { ChevronRight } from 'lucide-react';
import { formatBytes } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { api } from '@/lib/api/endpoints';
import { LoadError, Loading } from './parts';
import { InlineMeter } from './users-table';

const th = 'vx-colhead h-9 border-b border-vx-hair px-3 font-medium';

export function Domains({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const { data, error, mutate } = useSWR(['admin-domains'], () => api.admin.domains(), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (error && !data) return <LoadError what="usage by domain" onRetry={() => void mutate()} />;
  if (!data) return <Loading />;
  if (!data.domains.length) return <EmptyState art={false} title="No users yet." className="py-10" />;

  const toggle = (d: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  return (
    <div className="overflow-x-auto pt-3">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
        <thead>
          <tr className="[&>th]:bg-vx-bg-2">
            <th className={cx(th, 'pl-3')}>Domain</th>
            <th className={cx(th, 'text-right')}>Users</th>
            <th className={cx(th, 'text-right')}>Drives</th>
            <th className={cx(th, 'text-right')}>Used</th>
            <th className={cx(th, 'text-right')}>Quota</th>
            <th className={cx(th, 'pr-3')} aria-label="Usage" />
          </tr>
        </thead>
        <tbody>
          {data.domains.map((d) => {
            const expanded = open.has(d.domain);
            return [
              <tr key={d.domain} className="transition-colors duration-[120ms] hover:bg-vx-raise [&>td]:border-b [&>td]:border-vx-hair-soft">
                <td className="h-11 pl-1 pr-3">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggle(d.domain)}
                    className="flex items-center gap-1.5 rounded-vx-xs px-2 py-1 text-[14px] font-medium leading-5 text-vx-text-1"
                  >
                    <ChevronRight
                      size={14}
                      strokeWidth={1.75}
                      aria-hidden
                      className={cx('text-vx-text-3 transition-transform duration-[120ms]', expanded && 'rotate-90')}
                    />
                    {d.domain || '(no domain)'}
                  </button>
                </td>
                <td className="vx-meta-row px-3 text-right text-vx-text-2">{d.users}</td>
                <td className="vx-meta-row px-3 text-right text-vx-text-2">{d.drives}</td>
                <td className="vx-meta-row px-3 text-right text-vx-text-1">{formatBytes(d.usedBytes)}</td>
                <td className="vx-meta-row px-3 text-right text-vx-text-3">{formatBytes(d.quotaBytes)}</td>
                <td className="pr-3 text-right">
                  <InlineMeter used={d.usedBytes} quota={d.quotaBytes} />
                </td>
              </tr>,
              ...(expanded
                ? d.members.map((m) => (
                    <tr key={`${d.domain}:${m.id}`} className="bg-vx-surface-2/40 transition-colors duration-[120ms] hover:bg-vx-raise [&>td]:border-b [&>td]:border-vx-hair-soft">
                      <td className="h-10 pl-10 pr-3">
                        <button
                          type="button"
                          onClick={() => onOpenUser(m.id)}
                          className="block max-w-[320px] truncate rounded-vx-xs text-left text-[13px] leading-5 text-vx-text-2 hover:text-vx-text-1 hover:underline hover:underline-offset-[3px]"
                          title={m.name ? `${m.name} · ${m.email}` : m.email}
                        >
                          {m.email}
                        </button>
                      </td>
                      <td className="px-3" />
                      <td className="vx-meta-row px-3 text-right text-vx-text-3">{m.workspaceCount}</td>
                      <td className="vx-meta-row px-3 text-right text-vx-text-2">{formatBytes(m.usedBytes)}</td>
                      <td className="vx-meta-row px-3 text-right text-vx-text-3">{formatBytes(m.quotaBytes)}</td>
                      <td className="pr-3 text-right">
                        <InlineMeter used={m.usedBytes} quota={m.quotaBytes} />
                      </td>
                    </tr>
                  ))
                : []),
            ];
          })}
        </tbody>
      </table>
      <p className="vx-micro mt-4 text-vx-text-3">Grouped by the part of each address after the @. Sizes are cached for up to 30 seconds.</p>
    </div>
  );
}

export default Domains;
