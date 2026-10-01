import { TimeTravelMock } from '../mocks/time-travel';
import { SectionHead } from './head';

// Time travel (LANDING-SPEC §6.2): the signature stage. The docked proof panels
// (§6.3) follow directly under it, in <Docked/>.
export function TimeTravel() {
  return (
    <section id="time-travel" className="kd-section kd-section--stage" aria-labelledby="time-travel-title">
      <div className="kd-container">
        <SectionHead
          id="time-travel-title"
          eyebrow="02 · Time travel"
          title="See the whole drive as it was."
          lead="Not a backup you hope works. The history is the drive: browse it, compare it, bring it back."
        />
        <div className="kd-reveal">
          <TimeTravelMock />
        </div>
      </div>
    </section>
  );
}
