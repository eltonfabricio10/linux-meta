/**
 * Translation harness — DeepSeek-backed package-description translator with a
 * quality loop. Adapted from the LangForge approach (strong domain prompt +
 * validate + refine) but specialized for linux-meta package metadata.
 *
 * Flow: build domain prompt -> JSON completion -> validate (review-validation
 * rules + plausibility) -> if it fails, ONE refine pass feeding the critique
 * back. Returns the best result plus any remaining issues for the human to see.
 */
import { deepseekChat, addUsage, emptyUsage, type DeepseekUsage } from './deepseek';
import { validateSummary, validateDescription, MIN_PT_DESC, MIN_EN_DESC } from './review-validation';

const LOCALE_NAMES: Record<string, string> = {
  'pt-br': 'Brazilian Portuguese',
  'pt': 'Portuguese',
  'en': 'English',
  'es': 'Spanish',
  'de': 'German',
  'fr': 'French',
  'it': 'Italian',
  'nl': 'Dutch',
  'ja': 'Japanese',
  'ko': 'Korean',
  'zh-cn': 'Simplified Chinese',
  'zh': 'Chinese',
  'ru': 'Russian',
  'pl': 'Polish',
  'cs': 'Czech',
  'fi': 'Finnish',
  'el': 'Greek',
  'hu': 'Hungarian',
};

export function localeName(code: string): string {
  return LOCALE_NAMES[code.toLowerCase()] ?? code;
}

export type TranslateInput = {
  name: string;
  sourceSummary: string | null;
  sourceDescription: string | null;
  targetLocale: string;
  context?: string[]; // sibling/category names for disambiguation
};

export type TranslateResult = {
  summary: string;
  description: string;
  plainExplanation: string | null;
  issues: string[];
  attempts: number;
  refined: boolean;
  usage: DeepseekUsage;
};

const DOMAIN_RULES =
  `You write package metadata for a Linux software catalog. The reader is a normal ` +
  `user deciding whether to install. Tone: factual, calm, plain. No marketing words ` +
  `(best, powerful, leading), no exclamation marks.\n\n` +
  `SUMMARY: one short line, faithful to the source summary, no invented benefits.\n` +
  `DESCRIPTION (the main field): 2-3 short paragraphs that answer the user's real ` +
  `questions — what is this, what does it let you do, is it an app/CLI/service/library/` +
  `theme/data/plugin/driver, do you open it or run a command or get it as a dependency, ` +
  `who needs it, what changes after install, what to be careful about. Start with the ` +
  `plain role + practical purpose. Avoid vague words (support files, resources, runtime ` +
  `behavior) unless you explain them.\n` +
  `NEVER open with the package name, or with "opens/launches/provides/installs X".\n` +
  `Preserve proper nouns, the package name, commands, file paths and URLs EXACTLY ` +
  `as written — do not translate or alter them.`;

function buildSystem(input: TranslateInput): string {
  const target = localeName(input.targetLocale);
  const noPeriod = !input.targetLocale.toLowerCase().startsWith('en')
    ? `\nThe ${target} summary must NOT end with a period.`
    : '';
  const ctx = input.context && input.context.length
    ? `\n\nRelated packages in the same area (for disambiguation, do not translate these names): ${input.context.slice(0, 10).join(', ')}.`
    : '';
  return (
    `${DOMAIN_RULES}\n\n` +
    `Translate the package metadata into ${target}. Keep the package name "${input.name}" ` +
    `unchanged (proper noun).${noPeriod}${ctx}\n\n` +
    `Return ONLY a JSON object with keys "summary" and "description" (strings). ` +
    `Do not add any other keys or prose.`
  );
}

function buildUser(input: TranslateInput): string {
  return JSON.stringify({
    name: input.name,
    summary: input.sourceSummary ?? '',
    description: input.sourceDescription ?? '',
    target_locale: input.targetLocale,
  });
}

function parseJson(content: string): { summary?: string; description?: string } | null {
  let text = content.trim();
  // Strip ```json ... ``` fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : undefined,
      description: typeof obj.description === 'string' ? obj.description : undefined,
    };
  } catch {
    return null;
  }
}

/** Plausibility checks beyond the shared review-validation rules. */
function plausibility(input: TranslateInput, summary: string, description: string): string[] {
  const issues: string[] = [];
  const isEn = input.targetLocale.toLowerCase().startsWith('en');
  // Echoed English source verbatim (no translation happened).
  if (!isEn && input.sourceDescription && description.trim() === input.sourceDescription.trim()) {
    issues.push('A descrição parece idêntica ao inglês (não traduzida).');
  }
  // Extreme length ratio vs source (when a source exists).
  if (input.sourceDescription) {
    const ratio = description.length / Math.max(input.sourceDescription.length, 1);
    if (ratio > 4 || ratio < 0.25) {
      issues.push('Tamanho da descrição muito diferente do original.');
    }
  }
  // Package name should survive if it was in the source.
  const src = `${input.sourceSummary ?? ''} ${input.sourceDescription ?? ''}`;
  if (src.includes(input.name) && !`${summary} ${description}`.includes(input.name)) {
    issues.push(`O nome "${input.name}" sumiu da tradução.`);
  }
  return issues;
}

function collectIssues(input: TranslateInput, summary: string, description: string): string[] {
  const loc = input.targetLocale;
  return [
    ...validateSummary(summary, loc).map((i) => i.message),
    ...validateDescription(description, loc).map((i) => i.message),
    ...plausibility(input, summary, description),
  ];
}

export async function translatePackage(input: TranslateInput): Promise<TranslateResult> {
  const system = buildSystem(input);
  const user = buildUser(input);
  let usage = emptyUsage();

  const r1 = await deepseekChat({ system, user, json: true, maxTokens: 1400 });
  usage = addUsage(usage, r1.usage);
  const p1 = parseJson(r1.content);
  let summary = p1?.summary?.trim() ?? '';
  let description = p1?.description?.trim() ?? '';
  let issues = collectIssues(input, summary, description);
  let attempts = 1;
  let refined = false;

  // One refine pass if the first attempt fails the quality floor.
  if (issues.length > 0 && (summary || description)) {
    refined = true;
    attempts = 2;
    const minDesc = input.targetLocale.toLowerCase().startsWith('en') ? MIN_EN_DESC : MIN_PT_DESC;
    const refineUser =
      `Your previous translation has these problems:\n- ${issues.join('\n- ')}\n\n` +
      `Fix them. The description must be at least ${minDesc} characters and must not be ` +
      `generic filler. Re-output the corrected JSON for this package:\n${user}\n\n` +
      `Previous attempt:\n${JSON.stringify({ summary, description })}`;
    try {
      const r2 = await deepseekChat({ system, user: refineUser, json: true, maxTokens: 1400 });
      usage = addUsage(usage, r2.usage);
      const p2 = parseJson(r2.content);
      const s2 = p2?.summary?.trim() ?? '';
      const d2 = p2?.description?.trim() ?? '';
      const issues2 = collectIssues(input, s2, d2);
      // Keep the refined result only if it's at least as good.
      if ((s2 || d2) && issues2.length <= issues.length) {
        summary = s2; description = d2; issues = issues2;
      }
    } catch {
      // Refine failed (rate limit etc.) — keep the first attempt + its issues.
    }
  }

  return {
    summary,
    description,
    plainExplanation: null,
    issues,
    attempts,
    refined,
    usage,
  };
}
