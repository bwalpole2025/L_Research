import type { AppConfig } from '../config.js';

/**
 * DATA-MINIMISING request logging. Keeps logs to METADATA ONLY — method, path,
 * status, latency — and NEVER request/response bodies, document content, or AI
 * prompt/response text. Credentials are redacted; the query string is dropped
 * from the logged URL because it can carry search terms / user input.
 *
 * Retention is a deployment concern (stdout → the platform's log rotation);
 * `config.logRetentionDays` is the advertised default the operator should honour.
 */
export function buildLoggerOptions(config: AppConfig, stream?: NodeJS.WritableStream): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    level: config.logLevel,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.body', 'body', 'data', 'content'],
      remove: true,
    },
    serializers: {
      req(req: { method?: string; url?: string }) {
        return { method: req.method, url: (req.url ?? '').split('?')[0] };
      },
      res(res: { statusCode?: number }) {
        return { statusCode: res.statusCode };
      },
    },
  };
  if (stream) opts.stream = stream;
  return opts;
}
