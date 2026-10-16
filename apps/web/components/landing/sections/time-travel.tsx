import { TimeTravelMock } from '../mocks/time-travel';
import { SectionHead } from './head';

// Time travel: the signature stage, set on a stone mat with the dot grid. The docked proof panels follow
// directly under it, in <Docked/>.
export function TimeTravel() {
  return (
    <section id="time-travel" className="kd-section kd-section--stage" aria-labelledby="time-travel-title">
      <div className="kd-container">
        <SectionHead
          id="time-travel-title"
          eyebrow="02 · Time travel"
          hue={262}
          title="See the whole drive"
          em="as it was."
          lead="Not a backup you hope works. The history is the drive: browse it, compare it, bring it back."
        />
        <div className="kd-mat kd-reveal">
          <div className="kd-dotgrid" aria-hidden="true" />
          <TimeTravelMock />
        </div>
      </div>
    </section>
  );
}
