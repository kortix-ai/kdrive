// The section head: a mono eyebrow `NN · NAME` led by the glass object's 16 × 13 dot in the section's hue, a
// balanced H2 whose last phrase sets in Instrument Serif italic (pass it as `em`), and an optional lead. With a
// lead the head splits 1:1 (H2 left, lead right, bottom-aligned). Server component.
export function SectionHead({
  id,
  eyebrow,
  title,
  em,
  lead,
  hue,
  as: Tag = 'h2',
  className,
}: {
  id: string;
  eyebrow: string;
  title: React.ReactNode;
  /** the emphasised phrase that ends the title */
  em?: React.ReactNode;
  lead?: React.ReactNode;
  /** oklch hue angle of the eyebrow's dot */
  hue?: number;
  as?: 'h1' | 'h2';
  className?: string;
}) {
  return (
    <header className={`kd-head${lead ? ' kd-head--split' : ''} kd-reveal${className ? ` ${className}` : ''}`}>
      <div>
        <p className="kd-eyebrow kd-head__eyebrow">
          {hue != null && <span className="kd-fdot" style={{ '--h': hue } as React.CSSProperties} aria-hidden="true" />}
          {eyebrow}
        </p>
        <Tag id={id} className="kd-h2">
          {title}
          {em && (
            <>
              {' '}
              <em className="kd-serif">{em}</em>
            </>
          )}
        </Tag>
      </div>
      {lead && <p className="kd-lead">{lead}</p>}
    </header>
  );
}
