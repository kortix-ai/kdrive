'use client';

import { useEffect, useMemo, useState } from 'react';
import { codeLanguage, isActiveContent } from '@volumes/shared';
import { highlightLines, splitLines, type HlLine } from '@/lib/highlight';
import { cx } from '@/components/ui/cx';
import { useCodeWrap } from '@/lib/code-wrap';
import { useOverflowFade } from '@/lib/use-overflow-fade';
import { useTextContent } from './content';
import { PreviewError, PreviewSkeleton, ShownAsTextChip } from './states';

/**
 * Line-numbered source: a text-3 gutter on a hair rule and the code, both mono 13/20.
 * `tokens` (from Shiki) colour the lines; without them the text is plain. Unwrapped, long lines scroll
 * sideways and the right edge fades while more is hidden; `wrap` breaks them, one numbered row per line.
 */
export function SourceLines({ text, tokens, className, wrap }: { text: string; tokens?: HlLine[] | null; className?: string; wrap?: boolean }) {
  const lines = useMemo(() => splitLines(text), [text]);
  const gutter = useMemo(() => lines.map((_, i) => i + 1).join('\n'), [lines]);
  const width = String(lines.length).length;
  const scroller = useOverflowFade<HTMLPreElement>();
  const line = (i: number) =>
    tokens
      ? tokens[i]?.map((t, j) => (
          <span key={j} style={{ color: t.color, fontStyle: t.italic ? 'italic' : undefined }}>
            {t.content}
          </span>
        ))
      : lines[i];
  if (wrap) {
    return (
      <div className={cx('min-w-0 py-3 font-mono text-[13px] leading-5', className)} style={{ color: 'var(--sh-fg)' }}>
        {lines.map((_, i) => (
          <div key={i} className="flex min-w-0">
            <span aria-hidden className="shrink-0 select-none border-r border-vx-hair-soft pl-3 pr-3 text-right text-vx-text-3" style={{ minWidth: `calc(${width}ch + 20px)` }}>
              {i + 1}
            </span>
            <code className="min-w-0 flex-1 whitespace-pre-wrap pl-3 pr-4 [overflow-wrap:anywhere]">{line(i)}</code>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={cx('flex min-w-0', className)} style={{ color: 'var(--sh-fg)' }}>
      <pre
        aria-hidden
        className="shrink-0 select-none border-r border-vx-hair-soft py-3 pl-3 pr-3 text-right font-mono text-[13px] leading-5 text-vx-text-3"
        style={{ minWidth: `calc(${width}ch + 20px)` }}
      >
        {gutter}
      </pre>
      <pre ref={scroller} className="vx-fade-x min-w-0 flex-1 overflow-x-auto whitespace-pre py-3 pl-3 pr-4 font-mono text-[13px] leading-5">
        <code>
          {tokens
            ? tokens.map((_, i) => (
                <span key={i}>
                  {line(i)}
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
export function HighlightedSource({ text, lang, className, wrap }: { text: string; lang: string; className?: string; wrap?: boolean }) {
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
  return <SourceLines text={text} tokens={tokens?.key === key ? tokens.lines : null} className={className} wrap={wrap} />;
}

/** Code files (and active content, which is only ever shown as its source). */
export function CodeView({ src, name }: { src: string; name: string }) {
  const { data, error, isLoading, mutate } = useTextContent(src);
  const wrap = useCodeWrap();
  const active = isActiveContent(name);
  if (error) return <PreviewError status={error.status} code={error.code} onRetry={() => void mutate()} />;
  if (isLoading || data === undefined) return <PreviewSkeleton />;
  return (
    <div className="flex min-w-0 flex-col">
      {active ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-vx-hair-soft px-3 py-2.5">
          <ShownAsTextChip />
          <span className="vx-micro text-vx-text-3">Never rendered here. Download it to use it.</span>
        </div>
      ) : null}
      {data.length === 0 ? <p className="vx-body px-4 py-6 text-vx-text-3">This file is empty.</p> : <HighlightedSource text={data} lang={codeLanguage(name)} wrap={wrap} />}
    </div>
  );
}

export default CodeView;
