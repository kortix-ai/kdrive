'use client';

// The upload link page body: a drop zone (files and folders), an optional
// "Your name", and the files sent in this visit with their progress. The
// sender never sees what else is in the folder: only what they sent here.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, FolderUp, Upload } from 'lucide-react';
import { formatBytes, UPLOAD_LINK_SENDER_MAX, type PublicUploadMeta } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { Input } from '@/components/ui/input';
import { Meter } from '@/components/ui/meter';
import { ApiError } from '@/lib/api/client';
import { sendFile } from '@/lib/upload/link-send';
import { collectDrop, hasFiles, pickUploadSources, type UploadSources } from '@/lib/upload/walk';

type Status = 'queued' | 'sending' | 'done' | 'error';

interface Item {
  id: number;
  file: File;
  /** Relative path as sent ("a.pdf", "Trip/a.jpg"). */
  name: string;
  sent: number;
  status: Status;
  error?: string;
}

/** Files sent at once. */
const PARALLEL = 2;

/** Errors that stop everything still waiting: the link will not take more. */
const FINAL = new Set(['folder_full', 'upload_limit', 'link_expired', 'link_revoked', 'not_found']);

function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'The file could not be sent.';
  if (e.code === 'link_expired') return 'This link has expired.';
  if (e.code === 'link_revoked' || e.code === 'not_found') return 'This link is no longer active.';
  if (e.code === 'rate_limited') return 'Too many files at once. Try again in a minute.';
  if (e.code === 'payload_too_large') return 'This file is larger than this link accepts.';
  return e.message;
}

function useSendQueue(token: string, maxFileBytes: number, sender: string) {
  // The queue lives in a ref (sends start outside any state updater); `items` mirrors it for rendering.
  const queue = useRef<Item[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const running = useRef(0);
  const stopped = useRef<string | null>(null);
  const senderRef = useRef(sender);
  senderRef.current = sender;

  const patch = useCallback((id: number, p: Partial<Item>) => {
    queue.current = queue.current.map((x) => (x.id === id ? { ...x, ...p } : x));
    setItems(queue.current);
  }, []);

  const pump = useCallback(() => {
    for (const it of queue.current) {
      if (running.current >= PARALLEL) break;
      if (it.status !== 'queued') continue;
      if (stopped.current) {
        patch(it.id, { status: 'error', error: stopped.current });
        continue;
      }
      running.current++;
      patch(it.id, { status: 'sending' });
      const who = senderRef.current.trim() || null;
      void sendFile(token, it.file, it.name, who, (sent) => patch(it.id, { sent }))
        .then(() => patch(it.id, { status: 'done', sent: it.file.size }))
        .catch((e: unknown) => {
          const msg = errorText(e);
          if (e instanceof ApiError && FINAL.has(e.code)) stopped.current = msg;
          patch(it.id, { status: 'error', error: msg });
        })
        .finally(() => {
          running.current--;
          pump();
        });
    }
  }, [token, patch]);

  const add = useCallback(
    (src: UploadSources) => {
      const fresh: Item[] = src.files.map(({ file, relPath }) => {
        const base: Item = { id: next.current++, file, name: relPath, sent: 0, status: 'queued' };
        if (file.size > maxFileBytes) return { ...base, status: 'error', error: `Larger than ${formatBytes(maxFileBytes)}, the most this link accepts.` };
        return base;
      });
      if (!fresh.length) return;
      queue.current = [...queue.current, ...fresh];
      setItems(queue.current);
      pump();
    },
    [maxFileBytes, pump],
  );

  return { items, add };
}

function ItemRow({ it }: { it: Item }) {
  const p = it.file.size ? it.sent / it.file.size : it.status === 'done' ? 1 : 0;
  return (
    <li className="flex min-h-12 items-center gap-3 border-b border-vx-hair-soft py-2 last:border-b-0">
      <FileIcon name={it.name} type="file" size={20} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] leading-5 text-vx-text-1" title={it.name}>
          {it.name}
        </div>
        {it.status === 'sending' ? (
          <Meter value={p} className="mt-1.5" />
        ) : it.status === 'error' ? (
          <div className="mt-0.5 text-[13px] leading-[18px] text-vx-danger">{it.error}</div>
        ) : (
          <div className="vx-meta mt-0.5 text-vx-text-3">{formatBytes(it.file.size)}</div>
        )}
      </div>
      <span className="vx-meta w-20 shrink-0 text-right text-vx-text-3">
        {it.status === 'done' ? (
          <span className="inline-flex items-center gap-1 text-vx-ok">
            <Check size={16} strokeWidth={2.25} aria-hidden />
            Sent
          </span>
        ) : it.status === 'error' ? (
          <CircleAlert size={16} strokeWidth={1.75} className="ml-auto inline text-vx-danger" aria-label="Not sent" />
        ) : it.status === 'sending' ? (
          `${Math.round(p * 100)}%`
        ) : (
          'Waiting'
        )}
      </span>
    </li>
  );
}

/** The upload link page body: "Your name", the drop zone and the files sent in this visit. */
export function UploadDrop({ token, meta }: { token: string; meta: PublicUploadMeta }) {
  const [sender, setSender] = useState('');
  const [over, setOver] = useState(false);
  const { items, add } = useSendQueue(token, meta.maxFileBytes, sender);
  const depth = useRef(0);

  const pick = (folder: boolean) => {
    void pickUploadSources(folder).then((src) => src && add(src));
  };

  const busy = items.some((i) => i.status === 'queued' || i.status === 'sending');
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error').length;

  // Leaving while files are still going: the browser asks first.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div className="max-w-[320px]">
        <Input
          label="Your name"
          hint={`Optional. ${meta.ownerName ?? 'The owner'} sees it next to your files.`}
          value={sender}
          maxLength={UPLOAD_LINK_SENDER_MAX}
          autoComplete="name"
          onChange={(e) => setSender(e.target.value)}
        />
      </div>

      <div
        onDragEnter={(e) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          depth.current++;
          setOver(true);
        }}
        onDragOver={(e) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setOver(false);
        }}
        onDrop={(e) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          void collectDrop(e.dataTransfer).then(add);
        }}
        className={cx(
          'flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-vx-lg border border-dashed px-6 py-10 text-center transition-colors duration-[120ms] ease-vx',
          over ? 'border-vx-accent bg-vx-selection' : 'border-vx-hair-strong bg-vx-surface-2',
        )}
      >
        <span aria-hidden className="inline-flex h-10 w-10 items-center justify-center rounded-vx-md bg-vx-surface-3 text-vx-text-2">
          <Upload size={20} strokeWidth={1.75} />
        </span>
        <div>
          <div className="vx-title">{over ? 'Drop to send' : 'Drop files or folders here'}</div>
          <p className="vx-body mt-1 text-vx-text-3">Up to {formatBytes(meta.maxFileBytes)} per file. You can&apos;t see what is already in the folder.</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" icon={<Upload size={16} strokeWidth={1.75} aria-hidden />} onClick={() => pick(false)}>
            Choose files
          </Button>
          <Button variant="outline" icon={<FolderUp size={16} strokeWidth={1.75} aria-hidden />} onClick={() => pick(true)}>
            Choose folder
          </Button>
        </div>
      </div>

      {items.length ? (
        <section aria-live="polite">
          {!busy && done > 0 ? (
            <div className="mb-3 flex items-start gap-2 rounded-vx-sm bg-vx-ok-wash px-3 py-2 text-[13px] leading-5 text-vx-text-1">
              <Check size={16} strokeWidth={2.25} className="mt-0.5 shrink-0 text-vx-ok" aria-hidden />
              <span>
                Done. {done === 1 ? '1 file' : `${done} files`} sent to {meta.ownerName ?? 'the owner'}
                {failed ? `; ${failed === 1 ? '1 file was' : `${failed} files were`} not sent` : ''}.
              </span>
            </div>
          ) : null}
          <div className="flex h-8 items-center justify-between border-b border-vx-hair">
            <h2 className="vx-colhead">Sent in this visit</h2>
            <span className="vx-meta text-vx-text-3">
              {done} of {items.length}
            </span>
          </div>
          <ul>
            {items.map((it) => (
              <ItemRow key={it.id} it={it} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default UploadDrop;
