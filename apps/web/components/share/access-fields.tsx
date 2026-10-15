'use client';

import { useState } from 'react';
import { KeyRound, Mail, X } from 'lucide-react';
import { LINK_EMAILS_MAX, LINK_PASSWORD_MAX } from '@volumes/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/input';
import { addEmails, parseEmails, type AccessDraft } from './access';

/** One switchable option: a checkbox row (title + one line), and its field underneath while on. */
function OptionRow({
  on,
  onChange,
  title,
  body,
  children,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  title: string;
  body: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-2.5">
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox checked={on} onChange={onChange} label={title} className="mt-0.5" />
        <span className="min-w-0">
          <span className="block text-[14px] font-medium leading-5 text-vx-text-1">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-[18px] text-vx-text-3">{body}</span>
        </span>
      </label>
      {on && children ? <div className="mt-2.5 pl-7">{children}</div> : null}
    </div>
  );
}

/** Address field: Enter, comma or space turns typed text into chips; pasting a list adds them all. */
function EmailsField({ emails, onChange }: { emails: string[]; onChange: (emails: string[]) => void }) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);
  const full = emails.length >= LINK_EMAILS_MAX;

  const commit = (raw: string) => {
    const { valid, invalid: bad } = parseEmails(raw);
    if (valid.length) onChange(addEmails(emails, valid));
    setText(bad.join(' '));
    setInvalid(bad.length ? `${bad[0]} is not an email address.` : null);
  };

  return (
    <div>
      {emails.length ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="People">
          {emails.map((e) => (
            <li
              key={e}
              className="inline-flex h-6 max-w-full items-center gap-1 rounded-vx-xs bg-vx-surface-3 pl-2 pr-0.5 text-[12.5px] leading-4 text-vx-text-1"
            >
              <span className="truncate">{e}</span>
              <button
                type="button"
                aria-label={`Remove ${e}`}
                onClick={() => onChange(emails.filter((x) => x !== e))}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-vx-xs text-vx-text-3 transition-colors duration-[120ms] hover:bg-vx-raise hover:text-vx-text-1"
              >
                <X size={12} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        size="sm"
        type="text"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        aria-label="Add people by email"
        placeholder={full ? `Up to ${LINK_EMAILS_MAX} people` : 'name@example.com, …'}
        leading={<Mail size={14} strokeWidth={1.75} aria-hidden />}
        disabled={full}
        value={text}
        invalid={invalid}
        hint="They sign in to KDRIVE with this address to open the link. We email each of them the link."
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;\s]$/.test(v) || /[,;\s]\S/.test(v)) commit(v);
          else {
            setText(v);
            setInvalid(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(text);
          } else if (e.key === 'Backspace' && !text && emails.length) onChange(emails.slice(0, -1));
        }}
        onBlur={() => (text ? commit(text) : undefined)}
      />
    </div>
  );
}

/**
 * Who can open a link and what they can do: a password, specific people, and downloads.
 * Shared by the create form and a link's Edit panel. `hadPassword`: editing a link that has one.
 */
export function AccessFields({
  value,
  onChange,
  hadPassword = false,
  className,
}: {
  value: AccessDraft;
  onChange: (next: AccessDraft) => void;
  hadPassword?: boolean;
  className?: string;
}) {
  const set = (patch: Partial<AccessDraft>) => onChange({ ...value, ...patch });
  return (
    <div className={cx('divide-y divide-vx-hair-soft', className)}>
      <OptionRow
        on={value.peopleOn}
        onChange={(peopleOn) => set({ peopleOn })}
        title="Only specific people"
        body="Viewers sign in with an address you list. Off: anyone with the link."
      >
        <EmailsField emails={value.emails} onChange={(emails) => set({ emails })} />
      </OptionRow>
      <OptionRow
        on={value.passwordOn}
        onChange={(passwordOn) => set({ passwordOn, password: '' })}
        title="Require a password"
        body="Asked once per browser, then remembered for 12 hours."
      >
        <div className="max-w-[300px]">
          <Input
            size="sm"
            type="password"
            autoComplete="new-password"
            aria-label="Link password"
            maxLength={LINK_PASSWORD_MAX}
            leading={<KeyRound size={14} strokeWidth={1.75} aria-hidden />}
            placeholder={hadPassword ? 'Leave empty to keep the current one' : 'At least 4 characters'}
            value={value.password}
            onChange={(e) => set({ password: e.target.value })}
            hint={hadPassword && value.password ? 'Saving signs out everyone who typed the old one.' : undefined}
          />
        </div>
      </OptionRow>
      <OptionRow
        on={value.allowDownload}
        onChange={(allowDownload) => set({ allowDownload })}
        title="Allow downloads"
        body={
          value.allowDownload
            ? 'Viewers can download files and folders.'
            : "View only: previews, no download buttons. This discourages saving copies; it can't stop screenshots."
        }
      />
    </div>
  );
}

export default AccessFields;
