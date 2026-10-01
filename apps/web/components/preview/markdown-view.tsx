'use client';

import { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '@/components/ui/cx';
import { Segmented } from '@/components/ui/segmented';
import { useTextContent } from './content';
import { HighlightedSource } from './code-view';
import { PreviewError, PreviewSkeleton } from './states';

/**
 * A reference definition is written once and can be used thousands of times, each use
 * rendering the full URL. A link or image target longer than MARKDOWN_MAX_URL_CHARS is never
 * followed, and the document's targets together stop at max(MARKDOWN_URL_BUDGET_MIN, twice
 * the file); links past that are shown as text.
 */
export const MARKDOWN_MAX_URL_CHARS = 4096;
export const MARKDOWN_URL_BUDGET_MIN = 512 * 1024;
const TITLE_MAX_CHARS = 200;

/** Only absolute http(s) / mailto links and in-page anchors are followed; anything else is shown as text. */
export function safeHref(href: string | undefined | null): string | null {
  if (!href || href.length > MARKDOWN_MAX_URL_CHARS) return null;
  const h = href.trim();
  if (h.startsWith('#')) return h;
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  return null;
}

/** Only absolute http(s) images load (no referrer); relative or scriptable sources never do. */
export function safeImageSrc(src: string | undefined | null): string | null {
  if (!src || src.length > MARKDOWN_MAX_URL_CHARS) return null;
  return /^https?:\/\//i.test(src.trim()) ? src.trim() : null;
}

/**
 * GFM pads every table row to the header's width, so a small file with a wide header and
 * short rows describes a huge table. Tables show at most this many columns, and the whole
 * document at most this many cells; a note under a shortened table says what it left out.
 */
export const MARKDOWN_TABLE_MAX_COLUMNS = 50;
export const MARKDOWN_TABLE_MAX_CELLS = 20_000;

type MdNode = { type: string; children?: MdNode[]; align?: (string | null)[]; value?: string; data?: { hProperties?: Record<string, unknown> } };

const n = (x: number) => x.toLocaleString('en-US');
const mdNote = (text: string): MdNode => ({
  type: 'paragraph',
  data: { hProperties: { className: ['vx-micro', 'text-vx-text-3'] } },
  children: [{ type: 'text', value: text }],
});

/** Remark plugin: cuts tables to MARKDOWN_TABLE_MAX_COLUMNS columns and the document to MARKDOWN_TABLE_MAX_CELLS cells. */
export function remarkBoundTables() {
  return (tree: MdNode) => {
    let budget = MARKDOWN_TABLE_MAX_CELLS;
    const walk = (node: MdNode) => {
      const kids = node.children;
      if (!kids) return;
      for (let i = 0; i < kids.length; i++) {
        const t = kids[i];
        if (t.type !== 'table') {
          walk(t);
          continue;
        }
        const rows = t.children ?? [];
        let columns = t.align?.length ?? 0;
        for (const r of rows) columns = Math.max(columns, r.children?.length ?? 0);
        const shownColumns = Math.min(columns, MARKDOWN_TABLE_MAX_COLUMNS);
        const fit = shownColumns ? Math.floor(budget / shownColumns) : rows.length;
        if (fit < 1) {
          kids[i] = mdNote(`Table left out: this file has more table cells than the preview shows.`);
          continue;
        }
        const keptRows = Math.min(rows.length, fit);
        budget -= keptRows * shownColumns;
        if (keptRows === rows.length && shownColumns === columns) continue;
        t.align = (t.align ?? []).slice(0, shownColumns);
        t.children = rows.slice(0, keptRows).map((r) => ({ ...r, children: (r.children ?? []).slice(0, shownColumns) }));
        const parts: string[] = [];
        if (keptRows < rows.length) parts.push(`${n(Math.max(0, keptRows - 1))} of ${n(rows.length - 1)} rows`);
        if (shownColumns < columns) parts.push(`${n(shownColumns)} of ${n(columns)} columns`);
        kids.splice(i + 1, 0, mdNote(`Table shortened: showing ${parts.join(' and ')}.`));
        i++;
      }
    };
    walk(tree);
  };
}

type HastNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/**
 * Rehype plugin: drops link and image targets (href, src) that are too long, and every one
 * after the document's targets add up to `budget` characters. Those render as text.
 */
export function rehypeBoundUrls(opts: { budget: number }) {
  return (tree: HastNode) => {
    let left = opts.budget;
    const stack: HastNode[] = [tree];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.type === 'element' && node.properties) {
        for (const prop of ['href', 'src'] as const) {
          const v = node.properties[prop];
          if (typeof v !== 'string') continue;
          if (v.length > MARKDOWN_MAX_URL_CHARS || v.length > left) delete node.properties[prop];
          else left -= v.length;
        }
      }
      if (node.children) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
  };
}

const clip = (s: string | undefined | null) => (s && s.length > TITLE_MAX_CHARS ? s.slice(0, TITLE_MAX_CHARS) + '…' : (s ?? undefined));

const components: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-7 text-[24px] font-semibold leading-8 tracking-[-0.025em] text-vx-text-1 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-6 text-[19px] font-semibold leading-7 tracking-[-0.02em] text-vx-text-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-[16px] font-semibold leading-6 tracking-[-0.01em] text-vx-text-1 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1.5 mt-4 text-[15px] font-semibold text-vx-text-1">{children}</h4>,
  h5: ({ children }) => <h5 className="mb-1.5 mt-4 text-[14px] font-semibold text-vx-text-2">{children}</h5>,
  h6: ({ children }) => <h6 className="mb-1.5 mt-4 text-[13px] font-semibold text-vx-text-3">{children}</h6>,
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) return <span className="text-vx-text-1 underline decoration-vx-hair-strong decoration-dashed underline-offset-2" title={clip(href)}>{children}</span>;
    const external = !safe.startsWith('#');
    return (
      <a
        href={safe}
        className="rounded-vx-xs text-vx-text-1 underline decoration-vx-hair-strong underline-offset-[3px] hover:decoration-vx-text-1"
        {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const safe = safeImageSrc(typeof src === 'string' ? src : null);
    if (!safe) return <span className="vx-meta rounded-vx-xs border border-dashed border-vx-hair-dash px-1.5 py-0.5 text-vx-text-3">Image: {alt || 'not shown'}</span>;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={safe} alt={alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="my-2 max-w-full rounded-vx-sm" />;
  },
  // GFM task lists (`contains-task-list` / `task-list-item`) show their checkbox instead of a bullet.
  ul: ({ className, children }) => (
    <ul className={cx('my-3 space-y-1', className?.includes('contains-task-list') ? 'list-none pl-1' : 'list-disc pl-6 marker:text-vx-text-4')}>{children}</ul>
  ),
  ol: ({ className, children }) => (
    <ol className={cx('my-3 space-y-1', className?.includes('contains-task-list') ? 'list-none pl-1' : 'list-decimal pl-6 marker:text-vx-text-4')}>{children}</ol>
  ),
  li: ({ className, children }) => <li className={className?.includes('task-list-item') ? 'list-none' : 'pl-1'}>{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-vx-hair-strong pl-4 text-vx-text-3">{children}</blockquote>,
  hr: () => <hr className="my-6 border-0 border-t border-vx-hair" />,
  code: ({ className, children }) => {
    const block = /language-/.test(className ?? '');
    if (block) return <code className={className}>{children}</code>;
    return <code className="rounded-vx-xs border border-vx-hair bg-vx-surface-2 px-1 py-px font-mono text-[13px] text-vx-text-1">{children}</code>;
  },
  pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-vx-sm border border-vx-hair bg-vx-surface-2 px-4 py-3 font-mono text-[13px] leading-5 text-vx-text-1">{children}</pre>,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-vx-sm border border-vx-hair">
      <table className="w-full border-collapse text-[14px] leading-5">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border-b border-vx-hair bg-vx-bg-2 px-3 py-2 text-left font-semibold text-vx-text-1 [&:not(:last-child)]:border-r">
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
            ? 'mr-2 inline-flex h-4 w-4 translate-y-[3px] items-center justify-center rounded-vx-xs bg-vx-accent text-vx-on-accent'
            : 'mr-2 inline-flex h-4 w-4 translate-y-[3px] rounded-vx-xs border-[1.5px] border-vx-outline'
        }
      >
        {checked ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
    ) : null,
  del: ({ children }) => <del className="text-vx-text-3">{children}</del>,
  strong: ({ children }) => <strong className="font-semibold text-vx-text-1">{children}</strong>,
};

/** Markdown rendered safely (GFM; raw HTML is dropped, never rendered), or its source. */
export function MarkdownBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={'min-w-0 break-words text-[15px] leading-6 text-vx-text-2 ' + (className ?? '')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBoundTables]}
        rehypePlugins={[[rehypeBoundUrls, { budget: Math.max(MARKDOWN_URL_BUDGET_MIN, text.length * 2) }]]}
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
      <div className="flex h-11 items-center px-3">
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
        // One container level: the prose sits straight in the preview well (no card inside the panel), at a reading measure.
        <MarkdownBody text={data} className="max-w-[72ch] px-5 pb-6 pt-2 max-[480px]:px-4" />
      ) : (
        <HighlightedSource text={data} lang="markdown" />
      )}
    </div>
  );
}

export default MarkdownView;
