/**
 * Axe-core accessibility smoke for key public routes.
 *
 * Fails on any violation of impact `serious` or `critical`. Other impacts
 * (`minor`, `moderate`) are logged but do not fail the build.
 *
 * @axe-core/playwright is loaded via dynamic import so it can be installed
 * ephemerally in CI (`npx --package=@axe-core/playwright`) without becoming
 * a permanent dependency in any package.json.
 */
import { test, expect } from '@playwright/test';

const PUBLIC_ROUTES: readonly string[] = [
  '/pt',
  '/pt/browse',
  '/pt/p/firefox',
  '/pt/status',
  '/pt/transparencia',
];

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

type AxeViolationNode = { target: ReadonlyArray<string>; html?: string };
type AxeViolation = {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: ReadonlyArray<AxeViolationNode>;
};

for (const route of PUBLIC_ROUTES) {
  test(`a11y: ${route} has no serious/critical violations`, async ({ page }) => {
    // Dynamic import so the dep can be supplied via ephemeral npx install in CI.
    const mod = (await import('@axe-core/playwright')) as unknown as {
      default: new (opts: { page: typeof page }) => {
        withTags(tags: string[]): {
          analyze(): Promise<{ violations: AxeViolation[] }>;
        };
      };
    };
    const AxeBuilder = mod.default;

    const response = await page.goto(route, { waitUntil: 'networkidle' });
    expect(response, `no response for ${route}`).not.toBeNull();
    expect(response!.ok(), `bad status for ${route}: ${response!.status()}`).toBeTruthy();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter((v) =>
      BLOCKING_IMPACTS.has(String(v.impact ?? '')),
    );

    if (blocking.length > 0) {
      const report = blocking
        .map((v) => {
          const targets = v.nodes
            .slice(0, 5)
            .map((n) => n.target.join(' '))
            .join('\n      ');
          return `- [${v.impact}] ${v.id}: ${v.help}\n      ${v.helpUrl}\n      ${targets}`;
        })
        .join('\n');
      throw new Error(
        `Axe found ${blocking.length} serious/critical violation(s) on ${route}:\n${report}`,
      );
    }
  });
}
