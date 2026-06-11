'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquarePlus, Pin, PinOff, Send, Trash2, X } from 'lucide-react';
import { useAiStore } from '@/lib/aiStore';
import { useEditorStore } from '@/lib/store';
import { Markdown } from './Markdown';

const iconButton =
  'rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

export function ChatSidebar() {
  const status = useAiStore((s) => s.status);
  const threads = useAiStore((s) => s.threads);
  const activeThreadId = useAiStore((s) => s.activeThreadId);
  const messages = useAiStore((s) => s.messages);
  const streaming = useAiStore((s) => s.streaming);
  const pinnedPaths = useAiStore((s) => s.pinnedPaths);
  const lastError = useAiStore((s) => s.lastError);
  const sendMessage = useAiStore((s) => s.sendMessage);
  const newThread = useAiStore((s) => s.newThread);
  const selectThread = useAiStore((s) => s.selectThread);
  const deleteThread = useAiStore((s) => s.deleteThread);
  const togglePin = useAiStore((s) => s.togglePin);
  const loadThreads = useAiStore((s) => s.loadThreads);
  const loadModels = useAiStore((s) => s.loadModels);
  const refreshStatus = useAiStore((s) => s.refreshStatus);
  const setChatOpen = useAiStore((s) => s.setChatOpen);

  const projectId = useEditorStore((s) => s.projectId);
  const files = useEditorStore((s) => s.files);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const activePath = files.find((f) => f.id === activeFileId)?.path;

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refreshStatus();
    void loadModels();
    void loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = () => {
    if (!input.trim() || streaming || !status.available) return;
    void sendMessage(input);
    setInput('');
  };

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]" data-testid="chat-sidebar">
      <div className="flex h-10 items-center gap-1.5 border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-3 text-xs dark:border-zinc-800">
        <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-500 dark:text-zinc-400">
          <span className={`h-1.5 w-1.5 rounded-full ${status.available ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          Claude
        </span>
        <select
          aria-label="Conversation"
          value={activeThreadId ?? ''}
          onChange={(e) => void selectThread(e.target.value || null)}
          className="ml-1 h-7 min-w-0 flex-1 truncate rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 outline-none transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700"
        >
          <option value="">New conversation</option>
          {threads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={newThread}
          title="New chat"
          className={iconButton}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
        {activeThreadId && (
          <button
            type="button"
            onClick={() => void deleteThread(activeThreadId)}
            title="Delete conversation"
            className={`${iconButton} hover:text-red-600 dark:hover:text-red-400`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setChatOpen(false)}
          aria-label="Close chat"
          className={iconButton}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {activePath && (
          <button
            type="button"
            onClick={() => togglePin(activePath)}
            className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {pinnedPaths.includes(activePath) ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
            {pinnedPaths.includes(activePath) ? 'Unpin' : 'Pin'} current
          </button>
        )}
        {pinnedPaths
          .filter((p) => p !== activePath)
          .map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
            >
              {p}
              <button type="button" onClick={() => togglePin(p)} aria-label={`Unpin ${p}`}>
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="text-xs text-zinc-400">No messages yet.</p>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="ml-6 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 dark:border-blue-500/20 dark:bg-blue-500/10">
              <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-100">{m.content}</p>
            </div>
          ) : (
            <div key={m.id} className="mr-2 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
              {m.content ? (
                <Markdown content={m.content} />
              ) : m.streaming ? (
                <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              ) : null}
              {m.streaming && m.content && (
                <Loader2 className="mt-1 inline-block h-3 w-3 animate-spin text-zinc-400" />
              )}
            </div>
          ),
        )}
      </div>

      {lastError && status.available && (
        <p className="px-3 pb-1 text-[11px] text-red-500">{lastError}</p>
      )}

      <div className="border-t border-zinc-200 bg-[var(--ls-surface-muted)] p-2 dark:border-zinc-800">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={!status.available}
          rows={3}
          aria-label="Message Claude"
          placeholder={status.available ? 'Ask Claude…' : 'AI unavailable'}
          className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-blue-400 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">{streaming ? 'Claude is replying…' : ''}</span>
          <button
            type="button"
            onClick={send}
            disabled={!status.available || streaming || !input.trim()}
            data-testid="chat-send"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" /> Send
          </button>
        </div>
      </div>
    </div>
  );
}
