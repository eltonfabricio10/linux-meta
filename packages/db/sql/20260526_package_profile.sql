BEGIN;

CREATE TABLE IF NOT EXISTS package_profile (
  package_id integer PRIMARY KEY REFERENCES package(id) ON DELETE CASCADE,
  component_type varchar(40) NOT NULL DEFAULT 'unknown',
  interface_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,
  audience_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  launchable boolean NOT NULL DEFAULT false,
  launch_kind varchar(32) NOT NULL DEFAULT 'none',
  launch_id text,
  launch_command text,
  launch_source varchar(32) NOT NULL DEFAULT 'unknown',
  launch_confidence varchar(16) NOT NULL DEFAULT 'unknown',
  provided_binaries jsonb NOT NULL DEFAULT '[]'::jsonb,
  provided_libraries jsonb NOT NULL DEFAULT '[]'::jsonb,
  mime_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_terminal boolean NOT NULL DEFAULT false,
  is_background_service boolean NOT NULL DEFAULT false,
  is_dependency_only boolean NOT NULL DEFAULT false,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_profile_component_type_idx
  ON package_profile (component_type);
CREATE INDEX IF NOT EXISTS package_profile_launchable_idx
  ON package_profile (launchable);
CREATE INDEX IF NOT EXISTS package_profile_launch_kind_idx
  ON package_profile (launch_kind);
CREATE INDEX IF NOT EXISTS package_profile_dependency_only_idx
  ON package_profile (is_dependency_only);

CREATE TABLE IF NOT EXISTS package_screenshot (
  id serial PRIMARY KEY,
  package_id integer NOT NULL REFERENCES package(id) ON DELETE CASCADE,
  locale varchar(8),
  url text NOT NULL,
  caption text,
  width integer,
  height integer,
  source varchar(32) NOT NULL DEFAULT 'admin',
  status varchar(16) NOT NULL DEFAULT 'draft',
  sort_order integer NOT NULL DEFAULT 0,
  added_by text,
  reviewed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_screenshot_package_idx
  ON package_screenshot (package_id);
CREATE INDEX IF NOT EXISTS package_screenshot_status_idx
  ON package_screenshot (status);
CREATE INDEX IF NOT EXISTS package_screenshot_package_order_idx
  ON package_screenshot (package_id, sort_order);

INSERT INTO audit_log (actor, action, entity_type, entity_id, before, after)
VALUES (
  'codex',
  'schema_package_profile_added',
  'schema',
  'package_profile',
  NULL,
  jsonb_build_object(
    'migration', 'packages/db/sql/20260526_package_profile.sql',
    'summary_rule', 'preserve imported English summary; translate summary to pt-br',
    'screenshots', 'optional admin-managed support only'
  )
);

COMMIT;
