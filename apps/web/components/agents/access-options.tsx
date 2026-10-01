'use client';

// Access level + mode option cards (DESIGN-v2 §5 "Option card"), shared by the token dialog,
// the consent card and "Change access…" on a connected app; plus the workspace menu button.
import { ChevronDown, Eye, Inbox, Layers, MessageSquareDiff, PencilLine, Zap } from 'lucide-react';
import { MODE_COPY, SCOPE_COPY, type AgentMode, type AgentScope } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { Menu } from '@/components/ui/menu';

export interface AccessValue {
  scope: AgentScope;
  mode: AgentMode;
}

export const SCOPES: readonly AgentScope[] = ['drive:read', 'drive:propose', 'drive:write'];
const LEVEL: Record<AgentScope, number> = { 'drive:read': 0, 'drive:propose': 1, 'drive:write': 2 };
export const scopeAtMost = (s: AgentScope, max: AgentScope) => LEVEL[s] <= LEVEL[max];

const SCOPE_ICON: Record<AgentScope, React.ReactNode> = {
  'drive:read': <Eye size={18} strokeWidth={1.75} />,
  'drive:propose': <MessageSquareDiff size={18} strokeWidth={1.75} />,
  'drive:write': <PencilLine size={18} strokeWidth={1.75} />,
};
const MODE_ICON: Record<AgentMode, React.ReactNode> = {
  review: <Inbox size={18} strokeWidth={1.75} />,
  direct: <Zap size={18} strokeWidth={1.75} />,
};

/** The line shown instead of the mode cards for suggest-only access. */
export const PROPOSE_MODE_LINE = 'Its changes always wait for your review.';

/** Short badge labels for lists. */
export const SCOPE_BADGE: Record<AgentScope, string> = { 'drive:read': 'Read only', 'drive:propose': 'Suggest changes', 'drive:write': 'Make changes' };
export const MODE_BADGE: Record<AgentMode, string> = { review: 'Review', direct: 'Direct' };

/** Keeps the mode legal for the scope: only "Make changes" may apply directly. */
export function normalizeAccess(v: AccessValue): AccessValue {
  return v.scope === 'drive:write' ? v : { scope: v.scope, mode: 'review' };
}

/** Option card (r12): a 36 px icon disc, a title and one line; `on` gets a 2 px accent border and the selection tint. */
export function OptionCard({
  on,
  disabled,
  reason,
  icon,
  title,
  body,
  onSelect,
}: {
  on: boolean;
  disabled?: boolean;
  /** Why it is disabled (a text-3 line). */
  reason?: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      title={disabled ? reason : undefined}
      onClick={onSelect}
      className={cx(
        'vx-inset-focus flex min-w-0 items-center gap-3 rounded-vx-md px-3.5 py-3 text-left transition-colors duration-[120ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38] max-[720px]:min-h-11',
        on ? 'bg-vx-selection shadow-[inset_0_0_0_1px_var(--vx-accent-edge)]' : 'shadow-[inset_0_0_0_1px_var(--vx-hair-strong)] enabled:hover:bg-vx-raise',
      )}
    >
      <span
        aria-hidden
        className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-vx-sm', on ? 'bg-vx-accent text-vx-on-accent' : 'bg-vx-surface-3 text-vx-text-2')}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cx('block text-[14px] font-semibold leading-5', on ? 'text-vx-on-selection' : 'text-vx-text-1')}>{title}</span>
        <span className="mt-0.5 block text-[13px] leading-[18px] text-vx-text-3">{disabled && reason ? reason : body}</span>
      </span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[13px] font-medium leading-5 text-vx-text-2">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
        {children}
      </div>
    </fieldset>
  );
}

/**
 * **Access** (Read only / Suggest changes / Make changes) and, for Make changes, **When it
 * changes files** (review / direct). Levels above `maxScope` are disabled with `disabledReason`.
 */
export function AccessOptions({
  value,
  onChange,
  maxScope = 'drive:write',
  disabledReason = 'Not requested by this app',
}: {
  value: AccessValue;
  onChange: (v: AccessValue) => void;
  maxScope?: AgentScope;
  disabledReason?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Group label="Access">
        {SCOPES.map((s) => (
          <OptionCard
            key={s}
            on={value.scope === s}
            disabled={!scopeAtMost(s, maxScope)}
            reason={disabledReason}
            icon={SCOPE_ICON[s]}
            title={SCOPE_COPY[s].title}
            body={SCOPE_COPY[s].line}
            onSelect={() => onChange(normalizeAccess({ scope: s, mode: value.mode }))}
          />
        ))}
      </Group>
      {value.scope === 'drive:write' ? (
        <Group label="When it changes files">
          {(['review', 'direct'] as const).map((m) => (
            <OptionCard
              key={m}
              on={value.mode === m}
              icon={MODE_ICON[m]}
              title={MODE_COPY[m].title}
              body={MODE_COPY[m].line}
              onSelect={() => onChange({ scope: value.scope, mode: m })}
            />
          ))}
        </Group>
      ) : value.scope === 'drive:propose' ? (
        <div>
          <p className="mb-1 text-[13px] font-medium leading-5 text-vx-text-2">When it changes files</p>
          <p className="vx-body text-vx-text-3">{PROPOSE_MODE_LINE}</p>
        </div>
      ) : null}
    </div>
  );
}

/** "All my workspaces" or one workspace: a menu button (label above). */
export function WorkspacePicker({
  workspaces,
  value,
  onChange,
  label = 'Drive',
}: {
  workspaces: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
}) {
  const current = value ? workspaces.find((w) => w.id === value)?.name ?? 'Unknown drive' : 'All my drives';
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[13px] font-medium leading-5 text-vx-text-2">{label}</p>
      <Menu
        items={[
          { id: 'all', label: 'All my drives', checked: value === null, onSelect: () => onChange(null) },
          ...(workspaces.length ? [{ type: 'separator' as const, id: 'sep' }] : []),
          ...workspaces.map((w) => ({ id: w.id, label: w.name, checked: value === w.id, onSelect: () => onChange(w.id) })),
        ]}
        trigger={(p) => (
          <button
            type="button"
            {...p}
            aria-label={`${label}: ${current}`}
            className="vx-inset-focus inline-flex h-9 w-full min-w-0 items-center gap-2 rounded-vx-sm border border-vx-hair-strong bg-vx-field px-3 text-left text-[14px] text-vx-text-1 transition-colors duration-[120ms] hover:border-vx-outline"
          >
            <Layers size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-vx-text-2" />
            <span className="min-w-0 flex-1 truncate">{current}</span>
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-vx-text-2" />
          </button>
        )}
      />
    </div>
  );
}

/** The three list badges: access, mode (write only) and workspace. */
export function AccessBadges({ scope, mode, workspaceName, workspaceId }: { scope: AgentScope; mode: AgentMode; workspaceId: string | null; workspaceName: string | null }) {
  return (
    <>
      <Badge>{SCOPE_BADGE[scope]}</Badge>
      {scope !== 'drive:read' ? <Badge tone={mode === 'direct' ? 'accent' : 'neutral'}>{MODE_BADGE[mode]}</Badge> : null}
      <Badge title={workspaceId ? workspaceName ?? undefined : undefined}>{workspaceId ? workspaceName ?? 'Removed drive' : 'All drives'}</Badge>
    </>
  );
}

export default AccessOptions;
