/** Admin audit log helper.
 *
 * Inserts into `audit_log` (see packages/db/src/schema/audit.ts). Drizzle
 * serialises `before`/`after` to `jsonb` automatically. Never throws on the
 * caller path: an audit-store outage must not block the admin mutation that
 * triggered it. Failures are logged to stderr so they show up in container
 * logs and can be picked up by the observability stack.
 */
import { db, schema } from '~/lib/db';

export interface AdminAuditInput {
  /** Actor id (better-auth user.id) or 'system' for automated changes. */
  actor: string;
  /** Action verb, e.g. 'user.role.update', 'user.ban', 'user.sessions.revoke'. */
  action: string;
  /** Entity kind, e.g. 'user'. */
  entityType: string;
  /** Optional entity primary key as text. */
  entityId?: string | null;
  /** Snapshot before the mutation (null for create). */
  before?: unknown;
  /** Snapshot after the mutation (null for delete). */
  after?: unknown;
}

export async function logAdminAction(input: AdminAuditInput): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      actor: input.actor,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: (input.before ?? null) as never,
      after: (input.after ?? null) as never,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write audit_log entry', {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
