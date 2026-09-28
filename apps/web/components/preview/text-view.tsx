'use client';

import { useMemo } from 'react';
import { useTextContent } from './content';
import { SourceLines } from './code-view';
import { PreviewError, PreviewSkeleton } from './states';

/** Pretty-prints JSON; returns null when `text` is not valid JSON. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

/** Plain text (wrapped mono `<pre>`) and JSON (pretty-printed, line-numbered). */
export function TextView({ src, kind = 'text' }: { src: string; kind?: 'text' | 'json' }) {
  const { data, error, isLoading, mutate } = useTextContent(src);
  const pretty = useMemo(() => (kind === 'json' && data !== undefined ? prettyJson(data) : null), [kind, data]);
  if (error) return <PreviewError status={error.status} code={error.code} onRetry={() => void mutate()} />;
  if (isLoading || data === undefined) return <PreviewSkeleton />;
  if (data.length === 0) return <p className="vx-meta px-4 py-6 text-vx-text-4">This file is empty.</p>;
  if (kind === 'json') {
    return (
      <div className="flex min-w-0 flex-col">
        {pretty === null ? <p className="vx-micro border-b border-vx-hair-soft px-4 py-2 text-vx-text-4">Not valid JSON. Shown as it is stored.</p> : null}
        <SourceLines text={pretty ?? data} />
      </div>
    );
  }
  return <pre className="vx-code whitespace-pre-wrap break-words px-4 py-3 text-vx-text-2">{data}</pre>;
}

export default TextView;
