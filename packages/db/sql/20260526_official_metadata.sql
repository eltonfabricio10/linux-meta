BEGIN;

ALTER TABLE package_translation
  ADD COLUMN IF NOT EXISTS summary_source varchar(64),
  ADD COLUMN IF NOT EXISTS description_source varchar(64),
  ADD COLUMN IF NOT EXISTS plain_explanation_source varchar(64);

CREATE TABLE IF NOT EXISTS package_official_metadata (
  package_id integer PRIMARY KEY REFERENCES package(id) ON DELETE CASCADE,
  source varchar(32) NOT NULL,
  source_id text NOT NULL,
  repo text,
  official_name text NOT NULL,
  official_summary text,
  official_version text,
  official_url text,
  official_license text,
  install_size_kb bigint,
  popularity integer,
  raw_metadata jsonb NOT NULL,
  extracted_from text NOT NULL,
  extracted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_official_metadata_source_idx
  ON package_official_metadata (source);
CREATE INDEX IF NOT EXISTS package_official_metadata_name_idx
  ON package_official_metadata (official_name);

INSERT INTO audit_log (actor, action, entity_type, entity_id, before, after)
VALUES (
  'codex',
  'schema_official_metadata_added',
  'schema',
  'package_official_metadata',
  NULL,
  jsonb_build_object(
    'migration', 'packages/db/sql/20260526_official_metadata.sql',
    'purpose', 'store official package-manager metadata and per-field translation provenance'
  )
);

COMMIT;
