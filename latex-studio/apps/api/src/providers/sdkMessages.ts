// Safe field access over the Agent SDK's large message union — read only what
// we need without depending on exact internal types.

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

export function getString(rec: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = rec?.[key];
  return typeof v === 'string' ? v : undefined;
}

/** Text of a partial-message `stream_event` delta (when includePartialMessages is on). */
export function streamDeltaText(m: Record<string, unknown>): string | undefined {
  const delta = asRecord(asRecord(m['event'])?.['delta']);
  return getString(delta, 'type') === 'text_delta' ? getString(delta, 'text') : undefined;
}

/** Concatenate the text blocks of an `assistant` message. */
export function assistantText(m: Record<string, unknown>): string {
  const content = asRecord(m['message'])?.['content'];
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    const b = asRecord(block);
    if (getString(b, 'type') === 'text') out += getString(b, 'text') ?? '';
  }
  return out;
}
