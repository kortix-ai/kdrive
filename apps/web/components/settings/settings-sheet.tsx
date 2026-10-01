import { Page, PageHeader } from '@/components/ui/page';

/**
 * The settings frame (UNIFY-SPEC §14.4): the same full-height work sheet and 1040 page frame as every other
 * top-level page, with the shared PageHeader, then a 720 text column of hairline-separated blocks.
 */
export function SettingsSheet({
  title,
  eyebrow = 'Account',
  back,
  children,
}: {
  title: string;
  eyebrow?: string;
  back?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Page>
      <PageHeader eyebrow={eyebrow} title={title} back={back} className="max-w-[720px] border-b border-vx-hair pb-6" />
      <div className="max-w-[720px] divide-y divide-vx-hair">{children}</div>
    </Page>
  );
}

export default SettingsSheet;
