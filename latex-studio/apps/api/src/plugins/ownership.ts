import fp from 'fastify-plugin';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Project } from '@prisma/client';
import { BEARER_PRINCIPAL, principalOwnsProject, type Principal } from '../auth/principal.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated principal (today: the static-bearer holder). */
    principal: Principal;
    /**
     * The resolved, ownership-verified project for a project-scoped route. Set by
     * the single ownership guard before the handler runs; undefined on
     * public/principal routes. Handlers may treat it as non-null (`request.project!`).
     */
    project?: Project;
  }
}

/** A project-scoped child model whose row carries a `projectId`. */
type ChildModel = 'texFile' | 'chatThread' | 'literatureItem' | 'folder';

/** How to find the owning project's id for a request. */
type Resolver =
  | { from: 'param'; name: string } // params[name] IS a projectId (/projects/:id/…)
  | { from: 'body'; name: string } // body[name] is a projectId (/synctex/*)
  | { from: 'child'; param: string; model: ChildModel }; // params[param] is a child id

/**
 * Every route is exactly one of:
 *  - public:    no auth, no project (health probes, OAuth callback).
 *  - principal: authenticated but not tied to one project (lists, app-level
 *               folders, connector config, AI status, the stateless verifier).
 *  - project:   tied to one project; the guard resolves it and asserts ownership.
 */
type Classification =
  | { kind: 'public' }
  | { kind: 'principal' }
  | { kind: 'project'; resolver: Resolver };

const child = (param: string, model: ChildModel): Classification => ({
  kind: 'project',
  resolver: { from: 'child', param, model },
});

/**
 * Authenticated routes that are NOT scoped to a single project. Listed
 * explicitly so that any NEW route which isn't project-scoped must be added here
 * consciously — an unclassified route fails the boot-time audit rather than
 * silently bypassing the ownership guard.
 *
 * NB: the app-level project organisation (/project-folders, /project-trash) and
 * connector config are principal-scoped today but carry no userId; they become a
 * per-user concern when auth lands (see docs/decisions.md).
 */
const PRINCIPAL_ROUTES = new Set<string>([
  '/projects', // list (GET) + create (POST)
  '/projects-trash/purge',
  '/project-trash',
  '/project-trash/:trashId/restore',
  '/project-folders',
  '/project-folders/:folderId',
  '/ai/models',
  '/ai/status',
  '/ai/stats',
  '/healthz/model',
  '/connectors',
  '/connectors/:id',
  '/connectors/:id/connect',
  '/connectors/:id/configure',
  '/connectors/:id/disconnect',
  '/connectors/literature/:id/search',
  '/connectors/storage/:id/list',
  '/mathcheck/parse',
  '/mathcheck/equivalent',
  '/mathcheck/check-derivation',
]);

function normaliseMethods(method: string | string[]): string[] {
  return (Array.isArray(method) ? method : [method]).map((m) => m.toUpperCase());
}

/**
 * The single source of truth for how a route is guarded. Returns null when a
 * route can't be classified, which the audit turns into a hard boot failure.
 */
export function classifyRoute(method: string | string[], url: string): Classification | null {
  const methods = normaliseMethods(method);
  // CORS preflight needs no auth/project (cors plugin answers it earlier anyway).
  if (methods.length === 1 && methods[0] === 'OPTIONS') return { kind: 'public' };

  // Public (unauthenticated).
  if (url === '/healthz' || url === '/readyz') return { kind: 'public' };
  if (/^\/connectors\/[^/]+\/callback$/.test(url)) return { kind: 'public' };
  // Better Auth endpoints (sign-up/in/out, get-session). No USER session is
  // required to reach them (you can't have one yet); they stay behind the
  // service bearer like everything else.
  if (url === '/auth/*' || url.startsWith('/auth/')) return { kind: 'public' };

  // Project-scoped via the path: /projects/:id/… or /projects/:projectId/…
  const seg = url.split('/'); // ['', 'projects', ':id', …]
  if (seg[1] === 'projects' && seg[2]?.startsWith(':')) {
    return { kind: 'project', resolver: { from: 'param', name: seg[2].slice(1) } };
  }

  // Project-scoped via the body (projectId is a body field).
  if (url === '/synctex/forward' || url === '/synctex/inverse') {
    return { kind: 'project', resolver: { from: 'body', name: 'projectId' } };
  }

  // Project-scoped via a child id: resolve the parent project, then assert
  // ownership (the IDOR fix — never act on a by-id row without checking its owner).
  if (url === '/files/:id') return child('id', 'texFile');
  if (url === '/chat/threads/:tid' || url === '/chat/threads/:tid/messages') return child('tid', 'chatThread');
  if (url.startsWith('/library/items/:itemId')) return child('itemId', 'literatureItem');
  if (url === '/library/folders/:folderId') return child('folderId', 'folder');

  // Authenticated but not tied to one project.
  if (PRINCIPAL_ROUTES.has(url)) return { kind: 'principal' };

  return null;
}

/** Resolve the owning project's id for a request, per its resolver. */
async function resolveProjectId(
  app: FastifyInstance,
  request: FastifyRequest,
  r: Resolver,
): Promise<string | null> {
  if (r.from === 'param') {
    const v = (request.params as Record<string, string | undefined>)[r.name];
    return v ?? null;
  }
  if (r.from === 'body') {
    const v = (request.body as Record<string, unknown> | undefined)?.[r.name];
    return typeof v === 'string' && v.length > 0 ? v : null;
  }
  // child: look up the parent project's id from the child row.
  const childId = (request.params as Record<string, string | undefined>)[r.param];
  if (!childId) return null;
  const sel = { where: { id: childId }, select: { projectId: true } } as const;
  switch (r.model) {
    case 'texFile':
      return (await app.prisma.texFile.findUnique(sel))?.projectId ?? null;
    case 'chatThread':
      return (await app.prisma.chatThread.findUnique(sel))?.projectId ?? null;
    case 'literatureItem':
      return (await app.prisma.literatureItem.findUnique(sel))?.projectId ?? null;
    case 'folder':
      return (await app.prisma.folder.findUnique(sel))?.projectId ?? null;
  }
}

/**
 * THE ownership guard. One global preHandler that, for every project-scoped
 * route, resolves the project and asserts the principal owns it — the single
 * enforcement point. A boot-time onRoute audit guarantees no route bypasses it:
 * any route classifyRoute can't place fails the build.
 *
 * Today the principal is the static-bearer holder and projects are unowned
 * (userId null), so every check passes and behaviour is unchanged. Swapping the
 * bearer for a real user session is then a one-line change to how `principal` is
 * derived — every route is already behind this guard.
 */
export const ownershipPlugin = fp(
  async (app: FastifyInstance) => {
    app.decorateRequest('principal', null);
    app.decorateRequest('project', null);

    // Boot-time audit: every registered route MUST be classified — by the central
    // classifyRoute table, or by an explicit `config.ownership` declared on the
    // route itself (an equally-conscious choice, e.g. for a dynamically-added or
    // diagnostic route). An unclassified route is a latent authz hole, so fail
    // fast instead of shipping it — no route can silently bypass the guard.
    app.addHook('onRoute', (routeOptions) => {
      const declared = (routeOptions.config as { ownership?: Classification } | undefined)?.ownership;
      const cls = declared ?? classifyRoute(routeOptions.method, routeOptions.url);
      if (!cls) {
        throw new Error(
          `Ownership: route ${String(routeOptions.method)} ${routeOptions.url} is unclassified. ` +
            'Add it to classifyRoute (public | principal | project), or declare config.ownership on the route.',
        );
      }
      const cfg = (routeOptions.config ?? {}) as Record<string, unknown>;
      cfg.ownership = cls;
      routeOptions.config = cfg;
    });

    app.addHook('preHandler', async (request, reply) => {
      const cls = (request.routeOptions?.config as { ownership?: Classification } | undefined)?.ownership;

      // Resolve the PRINCIPAL. A valid Better Auth session cookie ⇒ the user;
      // otherwise the static-bearer holder (service-to-service). Public routes
      // (health, OAuth callback, the auth endpoints themselves) don't need a user.
      let principal: Principal = BEARER_PRINCIPAL;
      if (cls && cls.kind !== 'public') {
        try {
          const session = await app.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
          if (session?.user?.id) principal = { userId: session.user.id, kind: 'user' };
        } catch {
          /* no/invalid session → stays the bearer principal */
        }
      }
      request.principal = principal;

      if (!cls || cls.kind === 'public') return; // nothing to own

      // Multi-user enforcement: once enabled, EVERY non-public route requires a
      // logged-in user — the bearer alone (a logged-out browser the proxy still
      // tokens) is not an identity. Off by default so loopback dev keeps working.
      if (app.config.authRequired && principal.kind !== 'user') {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      if (cls.kind !== 'project') return; // principal route: authenticated, no project

      const projectId = await resolveProjectId(app, request, cls.resolver);
      if (!projectId) return reply.code(404).send({ error: 'Not found' });

      const project = await app.prisma.project.findUnique({ where: { id: projectId } });
      if (!project || !principalOwnsProject(request.principal, project)) {
        // 404 (not 403) so a probe can't distinguish "exists but not yours" from
        // "doesn't exist" — no cross-tenant existence leak.
        return reply.code(404).send({ error: 'Not found' });
      }
      request.project = project;
    });
  },
  { name: 'ownership' },
);
