import { type NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy: forwards /api/* to the Fastify api and injects the shared
 * bearer token. The token lives only on the Next server (API_BEARER_TOKEN, not
 * NEXT_PUBLIC_*), so the browser never holds it.
 */

export const dynamic = 'force-dynamic';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
const BEARER = process.env.API_BEARER_TOKEN ?? '';

async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  if (!BEARER) {
    return NextResponse.json(
      { error: 'API_BEARER_TOKEN is not configured on the web server' },
      { status: 503 },
    );
  }

  const search = request.nextUrl.search;
  const target = `${API_URL}/${path.join('/')}${search}`;

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set('authorization', `Bearer ${BEARER}`);

  const method = request.method;
  const init: RequestInit = { method, headers, cache: 'no-store' };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return NextResponse.json({ error: 'Upstream api is unreachable' }, { status: 502 });
  }

  // Stream the body through; copy content-type.
  const resHeaders = new Headers();
  const upstreamType = upstream.headers.get('content-type');
  if (upstreamType) resHeaders.set('content-type', upstreamType);

  return new NextResponse(upstream.body, { status: upstream.status, headers: resHeaders });
}

type Ctx = { params: { path: string[] } };

export async function GET(request: NextRequest, ctx: Ctx) {
  return proxy(request, ctx.params.path);
}
export async function POST(request: NextRequest, ctx: Ctx) {
  return proxy(request, ctx.params.path);
}
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return proxy(request, ctx.params.path);
}
export async function PUT(request: NextRequest, ctx: Ctx) {
  return proxy(request, ctx.params.path);
}
export async function DELETE(request: NextRequest, ctx: Ctx) {
  return proxy(request, ctx.params.path);
}
