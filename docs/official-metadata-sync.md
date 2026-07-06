# Official Metadata Sync

Purpose: refresh source facts without overwriting reviewed descriptions.

Authoritative inputs:

- `pacman -Si` for repository packages.
- `/var/lib/pacman/sync/packages-meta-ext-v1.json.gz` for AUR metadata.

Synced fields:

- package name
- English summary
- version
- URL
- license
- install size
- popularity
- raw metadata

Never overwrite reviewed long descriptions.

## Prepare

```bash
pnpm metadata:sync:prepare -- --source all --aur-min-votes 1 --out-dir /tmp/linux-meta-official-sync
```

Outputs:

- `/tmp/linux-meta-official-sync/official-metadata.tsv`
- `/tmp/linux-meta-official-sync/official-metadata-sync.sql`

## Apply

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /tmp/linux-meta-official-sync/official-metadata-sync.sql
```

SQL is transactional and writes audit data.

## Validate

```sql
SELECT count(*) AS official_summary_mismatches
FROM package_translation t
JOIN package_official_metadata o ON o.package_id = t.package_id
WHERE t.locale = 'en'
  AND o.official_summary IS NOT NULL
  AND t.summary IS DISTINCT FROM o.official_summary;
```

Expected: `0`.

## AUR

- Default: `--aur-min-votes 1`.
- Use `--aur-min-votes 0` only for deliberate full AUR import.
- Missing rows in current metadata may mean package disappeared upstream.
