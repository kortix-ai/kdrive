// STUB (owned by the SECTIONS builder): the facts strip, LANDING-SPEC §6.0.
const FACTS = [
  { label: 'Every version', value: '7 days' },
  { label: 'Newest versions of a drive', value: '50', caption: 'always kept' },
  { label: 'Checkpoints', value: '∞', caption: 'until you remove them' },
  { label: 'Recently deleted', value: '7 days', caption: 'to restore' },
  { label: 'Storage to start', value: '10 GB' },
];

export function Facts() {
  return (
    <section className="kd-facts" aria-label="Retention and storage">
      <dl className="kd-container kd-facts__grid">
        {FACTS.map((f) => (
          <div key={f.label} className="kd-facts__cell">
            <dt className="kd-eyebrow">{f.label}</dt>
            <dd className="kd-facts__value">{f.value}</dd>
            {f.caption && <dd className="kd-facts__caption">{f.caption}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
