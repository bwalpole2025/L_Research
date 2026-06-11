import type { FastifyInstance } from 'fastify';
import { isPlausibleMathExpression } from '@latex-studio/shared';

/** Proxy the bearer-protected /mathcheck/* routes to the internal mathcheck service. */
const ROUTES: Array<[string, string]> = [
  ['/mathcheck/parse', '/parse'],
  ['/mathcheck/equivalent', '/equivalent'],
  ['/mathcheck/check-derivation', '/check-derivation'],
];

/** Pull every expression out of a mathcheck request body (latex / lhs / rhs / steps[]). */
function expressionsOf(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ['latex', 'lhs', 'rhs']) if (typeof o[k] === 'string') out.push(o[k] as string);
  if (Array.isArray(o.steps)) for (const s of o.steps) if (typeof s === 'string') out.push(s);
  return out;
}

export async function mathcheckRoutes(app: FastifyInstance): Promise<void> {
  for (const [route, target] of ROUTES) {
    app.post(route, async (request, reply) => {
      // Maths guard before EVERY mathcheck call — non-math (BibTeX fields,
      // prose, …) never reaches the verifier, even via the manual panel.
      for (const expr of expressionsOf(request.body)) {
        const verdict = isPlausibleMathExpression(expr);
        if (!verdict.ok) {
          return reply
            .code(422)
            .send({ error: `not a maths expression (${verdict.reason}) — not sent to the verifier`, reason: verdict.reason });
        }
      }
      let upstream: Response;
      try {
        upstream = await fetch(`${app.config.mathcheckUrl}${target}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request.body ?? {}),
        });
      } catch {
        return reply.code(502).send({ error: 'mathcheck service is unavailable' });
      }
      const text = await upstream.text();
      reply.code(upstream.status);
      reply.header('content-type', upstream.headers.get('content-type') ?? 'application/json');
      return reply.send(text);
    });
  }
}
