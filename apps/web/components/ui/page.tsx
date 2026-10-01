import { cx } from './cx';

/**
 * The one frame for top-level pages inside the work sheet (checkpoints, recently deleted, proposals,
 * admin, settings): left-aligned, max 1040 wide, padding 28 24 (20 16 on phones). Titles land on the same
 * x on every page, so moving through the sidebar never makes the heading jump.
 */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('vx-page', className)}>{children}</div>;
}

/**
 * Page head: always an eyebrow, then the `.vx-h1` title, an optional lead line and right-aligned actions.
 * `back` sits above the eyebrow (sub-pages such as Settings → AI agents).
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
  back,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cx('vx-page-head', className)}>
      {back ? <div className="mb-3">{back}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="vx-eyebrow">{eyebrow}</p>
          <h1 className="vx-h1 mt-1.5">{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {lead ? <div className="vx-body mt-2 max-w-[640px] text-vx-text-3">{lead}</div> : null}
    </header>
  );
}

export default PageHeader;
