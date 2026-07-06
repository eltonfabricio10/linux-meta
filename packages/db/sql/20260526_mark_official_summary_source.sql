BEGIN;

WITH updated AS (
  UPDATE package_translation t
  SET summary_source = 'upstream',
      updated_at = now()
  FROM package_official_metadata o
  WHERE t.package_id = o.package_id
    AND t.locale = 'en'
    AND o.official_summary IS NOT NULL
    AND t.summary = o.official_summary
    AND t.summary_source IS DISTINCT FROM 'upstream'
  RETURNING t.package_id
)
INSERT INTO audit_log (actor, action, entity_type, entity_id, before, after)
SELECT 'codex', 'mark_official_summary_source', 'package_translation', NULL, NULL,
       jsonb_build_object('locale', 'en', 'updated_rows', count(*))
FROM updated;

COMMIT;
