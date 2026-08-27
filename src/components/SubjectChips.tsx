'use client';

import { subjectLabel, SUBJECTS, type SubjectCode } from '@/config/subjects';

type Props = {
  available: readonly SubjectCode[];
  selected: SubjectCode[];
  onToggle: (code: SubjectCode) => void;
};

export function SubjectChips({ available, selected, onToggle }: Props) {
  const enabled = new Set(SUBJECTS.filter((s) => s.enabled).map((s) => s.code));

  return (
    <ul className="flex flex-wrap gap-2">
      {available
        .filter((code) => enabled.has(code))
        .map((code) => {
          const on = selected.includes(code);
          return (
            <li key={code}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(code)}
                className={[
                  'min-h-12 rounded-full border px-4 text-[15px] font-semibold transition-colors',
                  on
                    ? 'border-brand bg-brand text-white'
                    : 'border-line bg-background text-foreground active:bg-surface',
                ].join(' ')}
              >
                {subjectLabel(code)}
              </button>
            </li>
          );
        })}
    </ul>
  );
}
