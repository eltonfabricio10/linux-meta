/** Slugify package name keeping it URL-safe and reversible-ish.
 *  Preserves digits, lowercases, replaces non [a-z0-9] with `-`. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}
