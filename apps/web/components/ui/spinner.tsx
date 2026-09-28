import { cx } from './cx';

/** Mono braille spinner (⠋⠙⠹⠸…), 80 ms per frame, width locked. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return <span role="status" aria-label={label ?? 'Loading'} className={cx('vx-spinner inline-block font-mono', className)} />;
}

export default Spinner;
