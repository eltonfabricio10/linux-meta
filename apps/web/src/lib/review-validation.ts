/**
 * review-validation — shared quality rules for package descriptions.
 *
 * Single source of truth for "what counts as a generic/low-value description",
 * mirrored from tools/package-review-workbench.mjs. Used by the in-UI review
 * flow (live warnings) and by quality scans. Keep the patterns in sync with the
 * workbench until that CLI imports this module directly.
 */

export const MIN_EN_DESC = 120;
export const MIN_PT_DESC = 140;

/* Boilerplate that adds no information. */
export const FILLER_RE =
  /Install it when this capability is needed directly|provides:|Packaged for the official Manjaro repositories|metadados oficiais não trazem|repositórios oficiais do Manjaro|Empacotado para/i;

/* Vague openers and "opens/launches X" non-descriptions, EN + PT. */
export const LOW_VALUE_RE =
  /é um programa que|este programa é|disponibilizado pelos repositórios|consulte a página do projeto|sem atrasos|alta qualidade e sem atrasos|^(open|opens|launch|launches|start|starts|run|runs|show|shows|display|displays)\s+(the\s+)?[\p{L}0-9_.+-]+|^(abre|abra|abrir|inicia|inicie|iniciar|executa|execute|executar|roda|rode|rodar|mostra|mostre|mostrar|exibe|exiba|exibir)\s+((o|a|os|as|um|uma)\s+)?[\p{L}0-9_.+-]+|^(allows|lets)\s+(you\s+)?(to\s+)?(open|launch|start|run|show|display)\s+(the\s+)?[\p{L}0-9_.+-]+|^(permite|deixa)\s+(abrir|iniciar|executar|rodar|mostrar|exibir)\s+((o|a|os|as|um|uma)\s+)?[\p{L}0-9_.+-]+|^(gives|provides)\s+access\s+to\s+(the\s+)?[\p{L}0-9_.+-]+|^(da|dá|fornece)\s+acesso\s+(ao|a|à|aos|às|para)\s+[\p{L}0-9_.+-]+/iu;

export type FieldIssue = { field: 'summary' | 'description'; code: string; message: string };

export function isGenericText(text: string | null | undefined): boolean {
  if (!text) return false;
  return FILLER_RE.test(text) || LOW_VALUE_RE.test(text);
}

/**
 * Validate a translated description for a given locale. Returns blocking issues
 * (too short, generic). Empty array = passes the quality floor.
 */
export function validateDescription(
  text: string | null | undefined,
  locale: string,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const t = (text ?? '').trim();
  const min = locale.startsWith('pt') ? MIN_PT_DESC : MIN_EN_DESC;
  if (t.length < min) {
    issues.push({
      field: 'description',
      code: 'too-short',
      message: locale.startsWith('pt')
        ? `Descrição muito curta (mín. ${min} caracteres).`
        : `Description too short (min ${min} characters).`,
    });
  }
  if (t && isGenericText(t)) {
    issues.push({
      field: 'description',
      code: 'generic',
      message: locale.startsWith('pt')
        ? 'Descrição genérica ou de baixo valor — explique o que é e para quem serve.'
        : 'Generic or low-value description — explain what it is and who it is for.',
    });
  }
  return issues;
}

/**
 * Validate a summary. PT summaries must not end with a period (project rule).
 */
export function validateSummary(
  text: string | null | undefined,
  locale: string,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const t = (text ?? '').trim();
  if (!t) {
    issues.push({
      field: 'summary',
      code: 'empty',
      message: locale.startsWith('pt') ? 'Resumo obrigatório.' : 'Summary is required.',
    });
    return issues;
  }
  if (locale.startsWith('pt') && t.endsWith('.')) {
    issues.push({
      field: 'summary',
      code: 'trailing-period',
      message: 'O resumo não deve terminar com ponto.',
    });
  }
  return issues;
}

/** Convenience: all blocking issues for a summary+description pair. */
export function validateTranslation(
  summary: string | null | undefined,
  description: string | null | undefined,
  locale: string,
): FieldIssue[] {
  return [...validateSummary(summary, locale), ...validateDescription(description, locale)];
}
