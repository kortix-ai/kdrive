'use client';

// Admin → Logs → Server log: the API's own recent warnings and errors and every request it
// answered with a 5xx, newest first. The server keeps them in memory (the last 2,000, redacted:
// no bodies, headers, query strings or anything that looks like a key). Refreshes every few
// seconds while "Live" is on.
import { useState } from 'react';
import useSWR from 'swr';
import { Pause, Play, RefreshCw } from 'lucide-react';
import type { ServerLogEntry } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { Segmented } from '@/components/ui/segmented';
import { api } from '@/lib/api/endpoints';
import { isoTitle } from '@/lib/format';
import { LoadError, Loading } from './parts';

export const SERVER_LOG_REFRESH_MS = 5000;

/** "14:02:07" in the viewer's time zone. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

const th = 'vx-colhead h-9 border-b border-vx-hair px-3 text-left font-medium';
const td = 'border-b border-vx-hair-soft px-3 py-2 align-top';

export function ServerLog() {
  const [level, setLevel] = useState<'all' | 'error'>('all');
  const [live, setLive] = useState(true);
  const { data, error, mutate, isValidating } = useSWR(['admin-server-log', level], () => api.admin.logs({ level, limit: 500 }), {
    refreshInterval: live ? SERVER_LOG_REFRESH_MS : 0,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    keepPreviousData: true,
  });

  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<'all' | 'error'>
          size="sm"
          label="Level"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: 'Warnings and errors' },
            { value: 'error', label: 'Errors only' },
          ]}
        />
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          aria-pressed={live}
          icon={live ? <Pause size={14} strokeWidth={1.75} aria-hidden /> : <Play size={14} strokeWidth={1.75} aria-hidden />}
          onClick={() => setLive((l) => !l)}
        >
          {live ? 'Live' : 'Paused'}
        </Button>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} strokeWidth={1.75} aria-hidden />} loading={isValidating && !live} onClick={() => void mutate()}>
          Refresh
        </Button>
      </div>
      {data ? (
        <p className="vx-micro mt-2 text-vx-text-3">
          Kept in memory since this API process started <span title={isoTitle(data.since)}>{formatWhen(data.since)}</span>; the last{' '}
          {data.capacity.toLocaleString('en')} entries. Secrets, request bodies and query strings are never recorded.
        </p>
      ) : null}
      <div className="mt-3">
        {error && !data ? (
          <LoadError what="the server log" onRetry={() => void mutate()} />
        ) : !data ? (
          <Loading />
        ) : data.entries.length === 0 ? (
          <EmptyState art={false} title={level === 'error' ? 'No errors.' : 'Nothing logged.'} body="Warnings and errors the API writes show up here." className="py-10" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="[&>th]:bg-vx-bg-2">
                  <th className={cx(th, 'w-[92px]')}>Time</th>
                  <th className={cx(th, 'w-[84px]')}>Level</th>
                  <th className={th}>Message</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <LogRow key={e.id} e={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function LogRow({ e }: { e: ServerLogEntry }) {
  return (
    <tr className="transition-colors duration-[120ms] hover:bg-vx-raise">
      <td className={cx(td, 'vx-meta-row whitespace-nowrap text-vx-text-3')} title={isoTitle(e.at)}>
        {clockTime(e.at)}
      </td>
      <td className={td}>
        <Badge tone={e.level === 'error' ? 'danger' : 'dashed'}>{e.level === 'error' ? 'Error' : 'Warning'}</Badge>
      </td>
      <td className={cx(td, 'break-all font-mono text-[12px] leading-[18px] text-vx-text-2')}>
        {e.source === 'request' ? <span className="mr-2 text-vx-text-4">request</span> : null}
        {e.message}
      </td>
    </tr>
  );
}

export default ServerLog;
