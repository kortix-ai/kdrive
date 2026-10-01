// Time-travel stage data (LANDING-SPEC §6.2). Each version is the whole drive's
// state; change chips are computed against the previous shown version.

export type Chip = 'added' | 'changed' | 'renamed' | 'deleted';

interface Entry {
  name: string;
  size: string;
  dir?: boolean;
}

export interface Version {
  v: number;
  when: string;
  /** Short date for the chip ("Tue 14:08"); "2 min ago" at now. */
  checkpoint?: string;
  restoreOf?: number;
  files: Record<string, Entry>;
}

const F = {
  brief: (size: string): Entry => ({ name: 'brief.md', size }),
  mood: { name: 'moodboard', size: '12 items', dir: true } as Entry,
  notes: (size: string): Entry => ({ name: 'notes.md', size }),
  hero: { name: 'hero.png', size: '2.4 MB' } as Entry,
  logo: (name: string): Entry => ({ name, size: '18 KB' }),
  budget: { name: 'budget.csv', size: '6 KB' } as Entry,
  spec: { name: 'type-specimen.pdf', size: '1.1 MB' } as Entry,
  launch: (size: string): Entry => ({ name: 'launch.pdf', size }),
};

const v30 = { brief: F.brief('4 KB'), mood: F.mood, notes: F.notes('2 KB') };
const v33 = { ...v30, hero: F.hero, logo: F.logo('logo.svg') };
const v36 = { ...v33, budget: F.budget, notes: F.notes('3 KB') };
const v38 = { ...v36, logo: F.logo('logo-final.svg'), spec: F.spec };
const { mood: _gone, ...v38NoMood } = v38;
const v40 = { ...v38NoMood, launch: F.launch('3.8 MB') };
const v44 = { ...v40, launch: F.launch('3.9 MB'), brief: F.brief('5 KB') };

export const VERSIONS: Version[] = [
  { v: 30, when: 'Mon 09:12', files: v30 },
  { v: 33, when: 'Mon 16:40', checkpoint: 'first draft', files: v33 },
  { v: 36, when: 'Tue 11:02', files: v36 },
  { v: 38, when: 'Tue 14:08', files: v38 },
  { v: 40, when: 'Wed 10:30', checkpoint: 'before launch', files: v40 },
  { v: 44, when: '2 min ago', files: v44 },
];

/** Every file id in display order: the stage always renders these rows (8), so its height never changes. */
export const ROW_ORDER = ['launch', 'spec', 'budget', 'logo', 'hero', 'brief', 'notes', 'mood'] as const;

/** Modified times, by the version that last touched each file. */
export const TOUCHED: Record<number, string> = { 30: 'Mon 09:12', 33: 'Mon 16:40', 36: 'Tue 11:02', 38: 'Tue 14:08', 40: 'Wed 10:30', 44: '2 min ago', 45: 'just now' };

export function restoreVersion(of: Version, head: Version): Version {
  return { v: head.v + 1, when: 'just now', restoreOf: of.v, files: of.files };
}

export interface Row {
  id: string;
  name: string;
  size: string;
  dir: boolean;
  modified: string;
  chip?: Chip;
  /** The file does not exist yet at the viewed version. */
  notYet?: boolean;
  /** For a "not yet" row, the version that adds it. */
  addedIn?: number;
}

/** The rows to show at `index` of `list`; hidden rows (deleted earlier) are omitted. */
export function rowsAt(list: Version[], index: number): Row[] {
  const cur = list[index];
  const prev = index > 0 ? list[index - 1] : undefined;
  const rows: Row[] = [];
  for (const id of ROW_ORDER) {
    const now = cur.files[id];
    const before = prev?.files[id];
    const touched = lastTouched(list, index, id);
    if (now) {
      let chip: Chip | undefined;
      if (prev && !before) chip = 'added';
      else if (before && before.name !== now.name) chip = 'renamed';
      else if (before && before.size !== now.size) chip = 'changed';
      rows.push({ id, ...now, dir: !!now.dir, modified: TOUCHED[touched] ?? cur.when, chip });
    } else if (before) {
      rows.push({ id, ...before, dir: !!before.dir, modified: TOUCHED[cur.v] ?? cur.when, chip: 'deleted' });
    } else if (!list.slice(0, index).some((x) => x.files[id])) {
      const adds = list.find((x) => x.files[id]);
      const first = adds?.files[id];
      if (first) rows.push({ id, ...first, dir: !!first.dir, modified: '', notYet: true, addedIn: adds.v });
    }
  }
  // Existing rows first, then deleted, then "not yet".
  const rank = (r: Row) => (r.notYet ? 2 : r.chip === 'deleted' ? 1 : 0);
  return rows.sort((a, b) => rank(a) - rank(b));
}

function lastTouched(list: Version[], index: number, id: string): number {
  for (let i = index; i > 0; i--) {
    const a = list[i].files[id];
    const b = list[i - 1].files[id];
    if (a && (!b || a.name !== b.name || a.size !== b.size)) return list[i].v;
  }
  return list[0].v;
}
