import test from 'node:test';
import assert from 'node:assert/strict';

import { validateReviewRecords } from './package-review-workbench.mjs';

const baseRecord = {
  package_id: 42,
  category: 'apps/utilities',
  pt_summary: 'Ferramenta de exemplo',
  en_description:
    'This package provides a small utility for managing a specific local workflow. It explains the package role clearly enough for users who are deciding whether they need it.',
  pt_description:
    'Fornece uma ferramenta local para organizar uma tarefa específica do sistema. A descrição explica a função do pacote de forma direta, para ajudar pessoas sem conhecimento técnico a decidir se precisam dele.',
  age_min: 0,
  component_type: 'app',
  interface_kinds: ['cli'],
  audience_tags: ['end-user'],
  launchable: true,
  launch_kind: 'command',
  launch_command: 'example',
  launch_source: 'manual_review',
  launch_confidence: 'probable',
  keywords: ['example'],
  requires_terminal: true,
  is_background_service: false,
  is_dependency_only: false,
};

test('accepts a complete didactic review record', () => {
  const result = validateReviewRecords([baseRecord], { expect: 1 });
  assert.deepEqual(result.errors, []);
  assert.equal(result.records[0].package_id, 42);
});

test('rejects duplicate package ids and short descriptions', () => {
  const bad = { ...baseRecord, en_description: 'Too short.', pt_description: 'Curta demais.' };
  const result = validateReviewRecords([bad, bad], { expect: 2 });
  assert.match(result.errors.join('\n'), /duplicate package_id/);
  assert.match(result.errors.join('\n'), /en_description must be didactic/);
  assert.match(result.errors.join('\n'), /pt_description must be didactic/);
});

test('rejects unreviewed other categories unless explicitly allowed', () => {
  const record = { ...baseRecord, category: 'other/uncategorized' };
  assert.match(validateReviewRecords([record]).errors.join('\n'), /category must be reviewed/);
  assert.deepEqual(validateReviewRecords([record], { allowOther: true }).errors, []);
});

test('rejects launch metadata that cannot start the package', () => {
  const record = { ...baseRecord, launch_kind: 'command', launch_command: null };
  assert.match(validateReviewRecords([record]).errors.join('\n'), /launch_command is required/);
});

test('rejects obvious launch wording as description value', () => {
  const en = {
    ...baseRecord,
    en_description:
      'Open Pure Data, a visual programming environment for live audio and multimedia work. It helps creators build patches and experiment with sound workflows.',
  };
  const pt = {
    ...baseRecord,
    pt_description:
      'Abre o Pure Data, um ambiente de programação visual em tempo real para música. Ajuda criadores a montar patches e testar fluxos de som.',
  };
  assert.match(validateReviewRecords([en]).errors.join('\n'), /low-value wording/);
  assert.match(validateReviewRecords([pt]).errors.join('\n'), /low-value wording/);
});

test('rejects access or self-display wording as description lead', () => {
  const en = {
    ...baseRecord,
    en_description:
      'Displays Pure Data, a visual programming environment for live audio and multimedia work. It helps creators build patches and experiment with sound workflows.',
  };
  const pt = {
    ...baseRecord,
    pt_description:
      'Fornece acesso ao Pure Data, um ambiente de programação visual em tempo real para música. Ajuda criadores a montar patches e testar fluxos de som.',
  };
  assert.match(validateReviewRecords([en]).errors.join('\n'), /low-value wording/);
  assert.match(validateReviewRecords([pt]).errors.join('\n'), /low-value wording/);
});

test('rejects softened launch wording as description lead', () => {
  const en = {
    ...baseRecord,
    en_description:
      'Allows you to open Pure Data for visual programming in live audio and multimedia work. It helps creators build patches and experiment with sound workflows.',
  };
  const pt = {
    ...baseRecord,
    pt_description:
      'Permite abrir o Pure Data para programação visual em tempo real para música. Ajuda criadores a montar patches e testar fluxos de som.',
  };
  assert.match(validateReviewRecords([en]).errors.join('\n'), /low-value wording/);
  assert.match(validateReviewRecords([pt]).errors.join('\n'), /low-value wording/);
});
