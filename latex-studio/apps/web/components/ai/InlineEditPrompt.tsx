'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useAiStore } from '@/lib/aiStore';

/** The floating Cmd+K instruction input shown over a captured selection. */
export function InlineEditPrompt() {
  const region = useAiStore((s) => s.inlineRegion);
  const busy = useAiStore((s) => s.editBusy);
  const submit = useAiStore((s) => s.submitInlineEdit);
  const cancel = useAiStore((s) => s.cancelInlineEdit);
  const [instruction, setInstruction] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (region) {
      setInstruction('');
      inputRef.current?.focus();
    }
  }, [region]);

  if (!region) return null;

  const onSubmit = () => {
    if (!instruction.trim() || busy) return;
    void submit(instruction);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 p-4 pt-24" onMouseDown={cancel}>
      <div
        className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit with Claude"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <Sparkles className="h-3.5 w-3.5 text-sky-500" /> Edit {region.selection.length} chars with Claude
        </div>
        <textarea
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={2}
          placeholder="Describe the change… (e.g. “convert to an align environment”)"
          aria-label="Edit instruction"
          className="w-full resize-none bg-transparent px-3 py-2 text-sm outline-none"
        />
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
          <span className="text-[11px] text-slate-400">Enter to generate · Esc to cancel</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancel}
              className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={busy || !instruction.trim()}
              data-testid="inline-edit-generate"
              className="inline-flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
