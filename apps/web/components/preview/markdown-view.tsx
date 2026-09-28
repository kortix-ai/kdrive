'use client';

import { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Segmented } from '@/components/ui/segmented';
import { useTextContent } from './content';
import { HighlightedSource } from './code-view';
import { PreviewError, PreviewSkeleton } from './states';

/** Only absolute http(s) / mailto links and in-page anchors are followed; anything else is shown as text. */
export function safeHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const h = href.trim();
  if (h.startsWith('#')) return h;
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  return null;
}

/** Only absolute http(s) images load (no referrer); relative or scriptable sources never do. */
export function safeImageSrc(src: string | undefined | null): string | null {
  if (!src) return null;
  return /^https?:\/\//i.test(src.trim()) ? src.trim() : null;
}

const components: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-7 text-[24px] font-bold leading-8 tracking-[-0.02em] text-vx-text-1 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-6 text-[19px] font-semibold leading-7 tracking-[-0.02em] text-vx-text-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-[16px] font-semibold leading-6 tracking-[-0.01em] text-vx-text-1 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1.5 mt-4 text-[15px] font-semibold text-vx-text-1">{children}</h4>,
  h5: ({ children }) => <h5 className="mb-1.5 mt-4 text-[14px] font-semibold text-vx-text-2">{children}</h5>,
  h6: ({ children }) => <h6 className="mb-1.5 mt-4 text-[13px] font-semibold text-vx-text-3">{children}</h6>,
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) return <span className="text-vx-text-1 underline decoration-vx-hair-strong decoration-dashed underline-offset-2" title={href ?? undefined}>{children}</span>;
    const external = !safe.startsWith('#');
    return (
      <a
        href={safe}
        className="rounded-[2px] text-vx-accent underline decoration-vx-accent/40 underline-offset-2 hover:text-vx-accent-strong hover:decoration-vx-accent"
        {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const safe = safeImageSrc(typeof src === 'string' ? src : null);
    if (!safe) return <span className="vx-meta rounded-vx-xs border border-dashed border-vx-hair-dash px-1.5 py-0.5 text-vx-text-4">Image: {alt || 'not shown'}</span>;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={safe} alt={alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="my-2 max-w-full rounded-vx-sm" />;
  },
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6 marker:text-vx-text-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6 marker:text-vx-text-4">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-4 border-l-[3px] border-vx-hair-strong pl-4 text-vx-text-3">{children}</blockquote>,
  hr: () => <hr className="my-6 border-0 border-t border-vx-hair" />,
  code: ({ className, children }) => {
    const block = /language-/.test(className ?? '');
    if (block) return <code className={className}>{children}</code>;
    return <code className="rounded-vx-xs bg-vx-surface-3 px-1.5 py-0.5 font-mono text-[13px] text-vx-text-1">{children}</code>;
  },
  pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-vx-sm bg-vx-surface-2 px-4 py-3 font-mono text-[13px] leading-5 text-vx-text-1">{children}</pre>,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-vx-sm border border-vx-hair">
      <table className="w-full border-collapse text-[14px] leading-5">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border-b border-vx-hair bg-vx-surface-2 px-3 py-2 text-left font-semibold text-vx-text-1 [&:not(:last-child)]:border-r">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-t border-vx-hair-soft px-3 py-2 align-top [&:not(:last-child)]:border-r">
      {children}
    </td>
  ),
  input: ({ checked, type }) =>
    type === 'checkbox' ? (
      <span
        aria-hidden
        className={
          checked
            ? 'mr-2 inline-flex h-4 w-4 translate-y-[3px] items-center justify-center rounded-[4px] bg-vx-accent text-vx-on-accent'
            : 'mr-2 inline-flex h-4 w-4 translate-y-[3px] rounded-[4px] border-2 border-vx-outline'
        }
      >
        {checked ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
    ) : null,
  del: ({ children }) => <del className="text-vx-text-4">{children}</del>,
  strong: ({ children }) => <strong className="font-semibold text-vx-text-1">{children}</strong>,
};

/** Markdown rendered safely (GFM; raw HTML is dropped, never rendered), or its source. */
export function MarkdownBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={'min-w-0 break-words text-[15px] leading-6 text-vx-text-2 ' + (className ?? '')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function MarkdownView({ src }: { src: string }) {
  const { data, error, isLoading, mutate } = useTextContent(src);
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
  if (error) return <PreviewError status={error.status} code={error.code} onRetry={() => void mutate()} />;
  if (isLoading || data === undefined) return <PreviewSkeleton />;
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex h-12 items-center px-3">
        <Segmented
          size="sm"
          label="Markdown view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'rendered', label: 'Rendered' },
            { value: 'source', label: 'Source' },
          ]}
        />
      </div>
      {data.length === 0 ? (
        <p className="vx-body px-4 pb-6 pt-2 text-vx-text-3">This file is empty.</p>
      ) : mode === 'rendered' ? (
        <div className="px-3 pb-3">
          <MarkdownBody text={data} className="rounded-vx-sm bg-vx-surface p-6 shadow-vx-1 max-[480px]:p-4" />
        </div>
      ) : (
        <HighlightedSource text={data} lang="markdown" />
      )}
    </div>
  );
}

export default MarkdownView;
