'use client';

import { useEffect, useMemo, useState } from 'react';
import { codeLanguage, isActiveContent } from '@volumes/shared';
import { highlightLines, splitLines, type HlLine } from '@/lib/highlight';
import { cx } from '@/components/ui/cx';
import { useTextContent } from './content';
import { PreviewError, PreviewSkeleton, ShownAsTextChip } from './states';

/**
 * Line-numbered source: a gutter (text-4) and the code, both `.vx-code`.
 * `tokens` (from Shiki) colour the lines; without them the text is plain.
 */
export function SourceLines({ text, tokens, className }: { text: string; tokens?: HlLine[] | null; className?: string }) {
  const lines = useMemo(() => splitLines(text), [text]);
  const gutter = useMemo(() => lines.map((_, i) => i + 1).join('\n'), [lines]);
  const width = String(lines.length).length;
  return (
    <div className={cx('flex min-w-0', className)} style={{ color: 'var(--sh-fg)' }}>
      <pre
        aria-hidden
        className="vx-code shrink-0 select-none border-r border-vx-hair-soft py-3 pl-3 pr-2 text-right text-vx-text-4"
        style={{ minWidth: `calc(${width}ch + 20px)` }}
      >
        {gutter}
      </pre>
      <pre className="vx-code min-w-0 flex-1 overflow-x-auto whitespace-pre py-3 pl-3 pr-4">
        <code>
          {tokens
            ? tokens.map((line, i) => (
                <span key={i}>
                  {line.map((t, j) => (
                    <span key={j} style={{ color: t.color, fontStyle: t.italic ? 'italic' : undefined }}>
                      {t.content}
                    </span>
                  ))}
                  {i < tokens.length - 1 ? '\n' : null}
                </span>
              ))
            : text}
        </code>
      </pre>
    </div>
  );
}

/** Highlights `text` as `lang` after first paint (plain source shows immediately, no flash). */
export function HighlightedSource({ text, lang, className }: { text: string; lang: string; className?: string }) {
  const [tokens, setTokens] = useState<{ key: string; lines: HlLine[] } | null>(null);
  const key = `${lang}:${text.length}:${text.slice(0, 64)}`;
  useEffect(() => {
    let alive = true;
    void highlightLines(text, lang).then((lines) => {
      if (alive && lines) setTokens({ key, lines });
    });
    return () => {
      alive = false;
    };
  }, [text, lang, key]);
  return <SourceLines text={text} tokens={tokens?.key === key ? tokens.lines : null} className={className} />;
}

/** Code files (and active content, which is only ever shown as its source). */
export function CodeView({ src, name }: { src: string; name: string }) {
  const { data, error, isLoading, mutate } = useTextContent(src);
  const active = isActiveContent(name);
  if (error) return <PreviewError status={error.status} code={error.code} onRetry={() => void mutate()} />;
  if (isLoading || data === undefined) return <PreviewSkeleton />;
  return (
    <div className="flex min-w-0 flex-col">
      {active ? (
        <div className="flex items-center gap-2 border-b border-vx-hair-soft px-4 py-2">
          <ShownAsTextChip />
          <span className="vx-micro text-vx-text-4">Never rendered: open or download to use it.</span>
        </div>
      ) : null}
      {data.length === 0 ? <p className="vx-meta px-4 py-6 text-vx-text-4">This file is empty.</p> : <HighlightedSource text={data} lang={codeLanguage(name)} />}
    </div>
  );
}

export default CodeView;
