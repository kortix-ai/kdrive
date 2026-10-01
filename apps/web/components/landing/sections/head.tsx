// The section head (LANDING-SPEC §2, §3): mono eyebrow `NN · NAME`, a one-colour
// balanced H2 (large or compact) and an optional lead. Large heads with a lead
// split 6/6 at ≥960 (H2 left, lead right on its first line), so no half of the
// row sits empty. Server component.
export function SectionHead({
  id,
  eyebrow,
  title,
  lead,
  size = 'large',
  className,
}: {
  id: string;
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  size?: 'large' | 'compact';
  className?: string;
}) {
  return (
    <header className={`kd-head kd-head--${size}${size === 'large' && lead ? ' kd-head--split' : ''} kd-reveal${className ? ` ${className}` : ''}`}>
      <p className="kd-eyebrow">{eyebrow}</p>
      <h2 id={id} className="kd-h2">
        {title}
      </h2>
      {lead && <p className="kd-lead">{lead}</p>}
    </header>
  );
}
