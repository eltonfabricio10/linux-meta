import type { JSX } from 'preact';

export type Role = 'visitor' | 'contributor' | 'translator' | 'reviewer' | 'admin';

export type RoleSelectLabels = {
  visitor: string;
  contributor: string;
  translator: string;
  reviewer: string;
  admin: string;
};

export default function RoleSelect({
  value,
  onChange,
  labels,
  disabled,
  id,
}: {
  value: Role;
  onChange: (next: Role) => void;
  labels: RoleSelectLabels;
  disabled?: boolean;
  id?: string;
}): JSX.Element {
  const opts: Role[] = ['visitor', 'contributor', 'translator', 'reviewer', 'admin'];
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value as Role)}
      class="role-select"
    >
      {opts.map((o) => (
        <option value={o}>{labels[o]}</option>
      ))}
      <style>{`
        .role-select {
          padding: 0.45rem 0.7rem;
          border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-elevated);
          color: var(--color-fg);
          font: inherit;
        }
        .role-select:focus { border-color: var(--color-teal-500); outline: none; }
        .role-select:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>
    </select>
  );
}
