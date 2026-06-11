'use client';

import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Check, ClipboardCopy, CornerDownLeft } from 'lucide-react';
import { useAiStore } from '@/lib/aiStore';
import 'katex/dist/katex.min.css';

function CodeBlock({ code }: { code: string }) {
  const insertAtCursor = useAiStore((s) => s.insertAtCursor);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="group relative my-2 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-end gap-1 border-b border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => insertAtCursor(code)}
          title="Insert at cursor"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <CornerDownLeft className="h-3 w-3" /> Insert
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          title="Copy"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <ClipboardCopy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CodeRenderer({ className, children }: React.ComponentPropsWithoutRef<'code'>) {
  const text = String(children ?? '').replace(/\n$/, '');
  const isBlock = /language-/.test(className ?? '') || text.includes('\n');
  if (!isBlock) {
    return (
      <code className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
        {children}
      </code>
    );
  }
  return <CodeBlock code={text} />;
}

/** Render assistant Markdown with GFM + KaTeX math and code-block actions. */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="ls-markdown text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: CodeRenderer,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
