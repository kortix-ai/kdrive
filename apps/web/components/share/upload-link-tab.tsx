'use client';

// The share dialog's "Upload link" tab (folders only): a link people use to
// send files into the folder. They never see what is in it. Options: expiry,
// a size limit per file, a file limit, and the same people / password gates
// as a share link. The dialog renders `body`, `footer`
// and `note`, so switching tabs keeps one dialog on screen.
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CircleAlert, Inbox, Lock } from 'lucide-react';
import { GiB, MiB, type ShareLink, type UpdateLinkRequest } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DateTimePicker, roundUpToSlot } from '@/components/ui/date-time-picker';
import { api } from '@/lib/api/endpoints';
import { formatMoment, isoTitle } from '@/lib/format';
import { accessRequest, OPEN_ACCESS, type AccessDraft } from './access';
import { AccessFields } from './access-fields';
import { copyText, CopyButton } from './copy-button';
import { expiryToIso, linkStatus, sortLinks, toLocalInput, type ExpiryChoice } from './expiry';
import { LinkRow } from './link-row';

const noRetry = { revalidateOnFocus: false, shouldRetryOnError: false } as const;

const EXPIRY: { value: ExpiryChoice; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom…' },
];

const SIZES: { value: number | null; label: string }[] = [
  { value: null, label: 'No limit' },
  { value: 10 * MiB, label: '10 MB' },
  { value: 100 * MiB, label: '100 MB' },
  { value: GiB, label: '1 GB' },
];

const COUNTS: { value: number | null; label: string }[] = [
  { value: null, label: 'No limit' },
  { value: 1, label: '1' },
  { value: 10, label: '10' },
  { value: 50, label: '50' },
  { value: 200, label: '200' },
];

const label = 'mb-2 block text-[14px] font-medium leading-5 text-vx-text-2';

function ChipGroup<T>({ id, title, options, value, onChange }: { id: string; title: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div>
      <span className={label} id={id}>
        {title}
      </span>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={o.label} on={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function useUploadLinkTab({ ws, path, name, onClose }: { ws: string; path: string; name: string; onClose: () => void }) {
  const [expiry, setExpiry] = useState<ExpiryChoice>('7d');
  const [custom, setCustom] = useState(() => roundUpToSlot(new Date(Date.now() + 7 * 24 * 3600_000)));
  const [maxFileBytes, setMaxFileBytes] = useState<number | null>(null);
  const [maxFiles, setMaxFiles] = useState<number | null>(null);
  const [access, setAccess] = useState<AccessDraft>(OPEN_ACCESS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ShareLink | null>(null);
  const [autoCopied, setAutoCopied] = useState(false);

  // Same key as the share tab: one fetch serves both.
  const links = useSWR(['links', ws, path], () => api.links.list(ws, { path }), noRetry);
  const sorted = useMemo(() => sortLinks((links.data?.links ?? []).filter((l) => l.kind === 'upload')), [links.data]);
  const activeCount = sorted.filter((l) => linkStatus(l) === 'active').length;

  const create = async () => {
    if (busy) return;
    setError(null);
    let expiresAt: string | null;
    let gates: Pick<UpdateLinkRequest, 'password' | 'allowedEmails'>;
    try {
      expiresAt = expiryToIso(expiry, toLocalInput(custom));
      // Downloads do not apply: only the people and password gates are sent.
      const { password, allowedEmails } = accessRequest(access);
      gates = { password, allowedEmails };
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    try {
      const { link } = await api.links.create(ws, { path, mode: 'live', kind: 'upload', expiresAt, maxFileBytes, maxFiles, ...gates });
      setAccess((a) => ({ ...a, password: '' }));
      setAutoCopied(await copyText(link.url));
      setCreated(link);
      await links.mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  const update = async (link: ShareLink, req: UpdateLinkRequest) => {
    const { link: next } = await api.links.update(ws, link.id, req);
    if (created?.id === link.id) setCreated(next);
    await links.mutate();
  };

  const revoke = async (link: ShareLink) => {
    await api.links.revoke(ws, link.id);
    if (created?.id === link.id) setCreated(null);
    await links.mutate();
  };

  const body = (
    <div className="flex flex-col gap-5 pb-2">
      <p className="vx-body text-vx-text-3">
        People with this link can send files into &ldquo;{name}&rdquo; without signing in. Each file is saved as a new version, and a name already
        in use gets a number.
      </p>

      <div>
        <span className={label} id="upload-expiry">
          Expires
        </span>
        <div role="group" aria-labelledby="upload-expiry" className="flex flex-wrap gap-2">
          {EXPIRY.map((o) => (
            <Chip
              key={o.value}
              on={expiry === o.value}
              onClick={() => {
                setExpiry(o.value);
                setError(null);
              }}
            >
              {o.label}
            </Chip>
          ))}
        </div>
        {expiry === 'custom' ? (
          <div className="mt-3">
            <DateTimePicker
              label="Expires at"
              value={custom}
              min={new Date(Date.now() + 60_000)}
              onChange={(d) => {
                setCustom(d);
                setError(null);
              }}
            />
            <p className="vx-meta mt-2 text-vx-text-3" title={isoTitle(custom)}>
              Expires <span className="text-vx-text-2">{formatMoment(custom)}</span>
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-5 max-[520px]:grid-cols-1">
        <ChipGroup id="upload-size" title="Largest file" options={SIZES} value={maxFileBytes} onChange={setMaxFileBytes} />
        <ChipGroup id="upload-count" title="Number of files" options={COUNTS} value={maxFiles} onChange={setMaxFiles} />
      </div>

      <div>
        <span className={label} id="upload-access">
          Access
        </span>
        <div role="group" aria-labelledby="upload-access" className="-my-2.5">
          <AccessFields
            upload
            value={access}
            onChange={(a) => {
              setAccess(a);
              setError(null);
            }}
          />
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2.5 text-[14px] leading-5 text-vx-danger">
          <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0">{error}</span>
        </div>
      ) : null}

      {created ? (
        <div className="flex h-10 items-center gap-2 rounded-vx-sm border border-vx-hair bg-vx-surface-2 pl-3 pr-1">
          <Inbox size={16} strokeWidth={1.75} className="shrink-0 text-vx-text-3" aria-hidden />
          <input
            readOnly
            value={created.url}
            aria-label="Upload link"
            onFocus={(e) => e.currentTarget.select()}
            className="vx-inset-focus min-w-0 flex-1 truncate rounded-vx-xs bg-transparent px-1 py-1 font-mono text-[12.5px] text-vx-text-1 outline-none"
          />
          <CopyButton key={created.id} text={created.url} flashOnMount={autoCopied} />
        </div>
      ) : null}

      <section className="border-t border-vx-hair pt-4">
        <div className="flex h-8 items-center justify-between border-b border-vx-hair">
          <h3 className="vx-colhead">Upload links</h3>
          <span className="vx-meta text-vx-text-3">{links.data ? activeCount : ''}</span>
        </div>
        {links.error ? (
          <div className="flex items-center gap-2 py-3">
            <span className="text-[13px] text-vx-danger">Couldn&apos;t load the links.</span>
            <Button size="sm" variant="text" onClick={() => void links.mutate()}>
              Retry
            </Button>
          </div>
        ) : !links.data ? (
          <div className="py-3">
            <span className="skeleton skel-line w-3/4" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="vx-body py-3 text-vx-text-3">No upload links yet.</p>
        ) : (
          <ul>
            {sorted.map((l) => (
              <LinkRow key={l.id} link={l} onRevoke={revoke} onUpdate={update} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  const footer = (
    <>
      <Button variant="outline" onClick={onClose} disabled={busy}>
        Done
      </Button>
      <Button variant="primary" onClick={() => void create()} loading={busy}>
        Create upload link
      </Button>
    </>
  );

  const note = (
    <>
      <Lock size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <span>People with an upload link can only add files. They can&apos;t see, open or change anything in this folder.</span>
    </>
  );

  return { body, footer, note, busy, create };
}
