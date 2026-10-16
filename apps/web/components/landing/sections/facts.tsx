// What is kept: the concrete answer to "how much does it remember?", right after How it works. Retention
// counts versions of the whole drive, never "per file". Label on top, the numeral, then a caption.
const FACTS: { label: string; value: string; caption?: string }[] = [
  { label: 'Every version', value: '7 days', caption: 'every version, per drive' },
  { label: 'Newest versions', value: '50', caption: 'per drive, always kept' },
  { label: 'Checkpoints', value: 'Forever', caption: 'up to 100 per drive, until you remove them' },
  { label: 'Recently deleted', value: '7 days', caption: 'to restore' },
  { label: 'Storage to start', value: '10 GB', caption: "history doesn't count" },
];

export const RETENTION_COPY = 'Every version from the last 7 days, your newest 50 always, and checkpoints forever.';

export function Facts() {
  return (
    <section className="kd-facts-band" aria-labelledby="kd-facts-title">
      <div className="kd-container">
        <h2 id="kd-facts-title" className="kd-sr-only">
          Retention and space
        </h2>
        <dl className="kd-facts kd-reveal">
          {FACTS.map((f) => (
            <div key={f.label} className="kd-facts__cell">
              <dt>{f.label}</dt>
              <dd className="kd-facts__value">{f.value}</dd>
              {f.caption && <dd className="kd-facts__caption">{f.caption}</dd>}
            </div>
          ))}
        </dl>
        <p className="kd-sr-only">{RETENTION_COPY}</p>
      </div>
    </section>
  );
}
