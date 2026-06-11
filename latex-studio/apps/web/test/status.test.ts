import { describe, it, expect } from 'vitest';
import { computeOverallStatus } from '../lib/store';

describe('computeOverallStatus', () => {
  it('reports saved when everything is saved or untracked', () => {
    expect(computeOverallStatus({ f1: 'saved' }, ['f1'])).toBe('saved');
    expect(computeOverallStatus({}, ['f1'])).toBe('saved');
    expect(computeOverallStatus({}, [])).toBe('saved');
  });

  it('prioritises saving over dirty over error', () => {
    expect(computeOverallStatus({ f1: 'dirty', f2: 'saved' }, ['f1', 'f2'])).toBe('dirty');
    expect(computeOverallStatus({ f1: 'saving', f2: 'dirty' }, ['f1', 'f2'])).toBe('saving');
    expect(computeOverallStatus({ f1: 'error', f2: 'saved' }, ['f1', 'f2'])).toBe('error');
  });

  it('ignores files that are not open', () => {
    expect(computeOverallStatus({ f1: 'dirty' }, ['f2'])).toBe('saved');
  });
});
