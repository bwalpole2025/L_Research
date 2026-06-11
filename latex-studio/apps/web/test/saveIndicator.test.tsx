import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SaveIndicator } from '../components/SaveIndicator';

describe('SaveIndicator', () => {
  it('reflects the status via attribute and label', () => {
    render(<SaveIndicator status="saving" />);
    const el = screen.getByTestId('save-indicator');
    expect(el).toHaveAttribute('data-status', 'saving');
    expect(el).toHaveTextContent('Saving');
  });

  it('renders the saved state', () => {
    render(<SaveIndicator status="saved" />);
    expect(screen.getByTestId('save-indicator')).toHaveAttribute('data-status', 'saved');
  });
});
