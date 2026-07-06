# Embedding Backfill

One-shot resumable worker for missing `package_embedding` rows.

Uses:

- locale: `en`
- model: `nomic-embed-text`
- dimension: 768
- provider: local Ollama

## Requirements

```bash
ollama pull nomic-embed-text
```

`DATABASE_URL` must point to PostgreSQL with pgvector.

## Run

```bash
DATABASE_URL=postgres://linuxmeta:linuxmeta@localhost:5433/linuxmeta \
OLLAMA_URL=http://localhost:11434 \
EMBED_RPS=5 \
node workers/embed-backfill.mjs
```

## Env

- `DATABASE_URL`: required.
- `OLLAMA_URL`: default `http://localhost:11434`.
- `EMBED_MODEL`: default `nomic-embed-text`.
- `EMBED_LOCALE`: default `en`.
- `EMBED_BATCH`: default `100`.
- `EMBED_RPS`: default `5`.
- `EMBED_MAX`: default `0` means unlimited.
- `EMBED_TEXT_MAX`: default `8000`.

## Resume

No checkpoint file.

The query skips rows that already have an embedding for the model/locale.

Restarting continues from remaining rows.

## Verify

```sql
SELECT count(*)
FROM package_embedding
WHERE model = 'nomic-embed-text';
```

```sql
SELECT source, count(*) AS missing
FROM package p
JOIN package_translation t ON t.package_id = p.id AND t.locale = 'en'
LEFT JOIN package_embedding e
  ON e.package_id = p.id
 AND e.locale = 'en'
 AND e.model = 'nomic-embed-text'
WHERE t.summary IS NOT NULL
  AND e.package_id IS NULL
GROUP BY source;
```
