/**
 * The authenticated PRINCIPAL — who is making the request.
 *
 * Today there is exactly one principal: the holder of the static bearer token
 * (single-user app, localhost/tunnel bind). `userId` is therefore null. When a
 * real identity provider lands (Clerk/Auth0/Supabase), the bearer hook is
 * swapped for one that verifies a session and produces `{ userId, kind: 'user' }`
 * — and nothing downstream changes, because every project-scoped route already
 * runs through the single ownership guard that consults this principal.
 *
 * See docs/decisions.md → "Bearer → user session: the remaining auth lift".
 */
export interface Principal {
  /** Owning user id, or null in single-user/static-bearer mode (no auth yet). */
  userId: string | null;
  /** How this principal was authenticated. */
  kind: 'bearer' | 'user';
}

/** The single principal in single-user mode: the static-bearer holder. */
export const BEARER_PRINCIPAL: Principal = { userId: null, kind: 'bearer' };

/** A stable string key for per-user accounting (execution quotas, etc.). Today
 *  every request is the one static-bearer principal → a single shared key; once
 *  real users exist this becomes their id with no caller change. */
export function principalKey(principal: Principal): string {
  return principal.userId ?? 'bearer';
}

/**
 * THE ownership rule — the one place that decides whether a principal may touch a
 * project. Used by the ownership guard for project-scoped routes and by the
 * project list filter, so "what I can see" and "what I can act on" never diverge.
 *
 * An unowned project (userId null — every project today) belongs to the
 * static-bearer principal, so single-user behaviour is unchanged. Once projects
 * carry real owners, only the owner matches. The `userId === null` allowance is
 * the single line to delete after backfilling owners (see docs/decisions.md).
 */
export function principalOwnsProject(
  principal: Principal,
  project: { userId: string | null },
): boolean {
  return project.userId === null || project.userId === principal.userId;
}

/**
 * Prisma `where` fragment for "projects this principal owns", mirroring
 * principalOwnsProject so list endpoints and the guard agree. Today (userId null)
 * this matches every legacy project; later it scopes to the user's own + unowned.
 */
export function ownedProjectsWhere(principal: Principal): { OR: Array<{ userId: string | null }> } {
  return { OR: [{ userId: null }, { userId: principal.userId }] };
}
