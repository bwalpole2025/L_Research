import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentModelStore } from '../lib/documentModelStore';

describe('DocumentModel — slow-debounced refresh (not per keystroke)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('many input events trigger the card-build at most once, after the debounce', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useDocumentModelStore.setState({ enabled: true, refresh });
    const { scheduleRefresh } = useDocumentModelStore.getState();

    for (let i = 0; i < 25; i++) scheduleRefresh(); // simulate rapid typing
    expect(refresh).not.toHaveBeenCalled(); // NOT called synchronously per event

    vi.advanceTimersByTime(3100);
    expect(refresh).toHaveBeenCalledTimes(1); // exactly once, after the slow debounce
  });

  it('when document-aware prediction is off, the card is never built', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useDocumentModelStore.setState({ enabled: false, refresh });
    useDocumentModelStore.getState().scheduleRefresh();
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
