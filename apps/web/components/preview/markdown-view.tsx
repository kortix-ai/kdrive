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
  h1: ({ children }) => <h1 className="mb-3 mt-6 border-b border-vx-hair pb-2 text-[20px] font-medium leading-7 text-vx-text-1 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-6 border-b border-vx-hair-soft pb-1.5 text-[17px] font-medium leading-6 text-vx-text-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-[15px] font-medium leading-6 text-vx-text-1 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1.5 mt-4 text-[14px] font-medium text-vx-text-1">{children}</h4>,
  h5: ({ children }) => <h5 className="vx-label mb-1.5 mt-4">{children}</h5>,
  h6: ({ children }) => <h6 className="vx-label mb-1.5 mt-4 text-vx-text-4">{children}</h6>,
  p: ({ children }) => <p className="my-3 first:mt-0">{children}</p>,
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) return <span className="text-vx-text-1 underline decoration-vx-hair-strong decoration-dashed underline-offset-2" title={href ?? undefined}>{children}</span>;
    const external = !safe.startsWith('#');
    return (
      <a
        href={safe}
        className="text-vx-accent underline decoration-vx-accent-edge underline-offset-2 hover:decoration-vx-accent"
        {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const safe = safeImageSrc(typeof src === 'string' ? src : null);
    if (!safe) return <span className="vx-meta border border-dashed border-vx-hair-dash px-1 text-vx-text-4">[image: {alt || 'not shown'}]</span>;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={safe} alt={alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="my-2 max-w-full border border-vx-hair" />;
  },
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5 marker:text-vx-text-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5 marker:font-mono marker:text-vx-text-4">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-vx-hair-strong pl-3 text-vx-text-3">{children}</blockquote>,
  hr: () => <hr className="my-5 border-0 border-t border-vx-hair" />,
  code: ({ className, children }) => {
    const block = /language-/.test(className ?? '');
    if (block) return <code className={className}>{children}</code>;
    return <code className="border border-vx-hair bg-vx-surface-2 px-1 font-mono text-[12px] text-vx-text-1">{children}</code>;
  },
  pre: ({ children }) => <pre className="vx-code my-3 overflow-x-auto border border-vx-hair bg-vx-bg px-3 py-2 text-vx-text-2">{children}</pre>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border border-vx-hair bg-vx-surface-2 px-2 py-1.5 text-left font-medium text-vx-text-1">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border border-vx-hair px-2 py-1.5 align-top">
      {children}
    </td>
  ),
  input: ({ checked, type }) =>
    type === 'checkbox' ? (
      <span aria-hidden className="mr-1.5 inline-flex h-3.5 w-3.5 translate-y-0.5 items-center justify-center border border-vx-hair-strong text-[9px]" style={checked ? { background: 'var(--pt-100)', color: 'var(--vx-text-inv)' } : undefined}>
        {checked ? '✓' : ''}
      </span>
    ) : null,
  del: ({ children }) => <del className="text-vx-text-4">{children}</del>,
  strong: ({ children }) => <strong className="font-medium text-vx-text-1">{children}</strong>,
};

/** Markdown rendered safely (GFM; raw HTML is dropped, never rendered), or its source. */
export function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="vx-body min-w-0 break-words px-5 py-4 text-vx-text-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={components}
      >
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
      <div className="flex h-10 items-center border-b border-vx-hair-soft px-4">
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
        <p className="vx-meta px-4 py-6 text-vx-text-4">This file is empty.</p>
      ) : mode === 'rendered' ? (
        <MarkdownBody text={data} />
      ) : (
        <HighlightedSource text={data} lang="markdown" />
      )}
    </div>
  );
}

export default MarkdownView;
