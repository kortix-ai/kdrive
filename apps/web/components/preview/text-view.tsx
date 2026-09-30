'use client';

import { useMemo } from 'react';
import { useTextContent } from './content';
import { SourceLines } from './code-view';
import { prettyJsonResult } from '@/lib/json-pretty';
import { PreviewError, PreviewSkeleton } from './states';

export { PRETTY_JSON_MAX_CHARS, prettyJson, prettyJsonResult, prettyJsonSizeBound, type PrettyJson } from '@/lib/json-pretty';

/** Plain text (wrapped mono `<pre>`) and JSON (pretty-printed, line-numbered). */
export function TextView({ src, kind = 'text' }: { src: string; kind?: 'text' | 'json' }) {
  const { data, error, isLoading, mutate } = useTextContent(src);
  const pretty = useMemo(() => (kind === 'json' && data !== undefined ? prettyJsonResult(data) : null), [kind, data]);
  if (error) return <PreviewError status={error.status} code={error.code} onRetry={() => void mutate()} />;
  if (isLoading || data === undefined) return <PreviewSkeleton />;
  if (data.length === 0) return <p className="vx-body px-4 py-6 text-vx-text-3">This file is empty.</p>;
  if (kind === 'json') {
    return (
      <div className="flex min-w-0 flex-col">
        {pretty?.status === 'invalid' ? <p className="vx-meta px-4 pb-1 pt-3 text-vx-text-3">Not valid JSON. Shown as it is stored.</p> : null}
        {pretty?.status === 'too-large' ? <p className="vx-meta px-4 pb-1 pt-3 text-vx-text-3">Too deeply nested to format. Shown as it is stored.</p> : null}
        <SourceLines text={pretty?.text ?? data} />
      </div>
    );
  }
  return <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-[13px] leading-5 text-vx-text-1">{data}</pre>;
}

export default TextView;
