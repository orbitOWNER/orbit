import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from '../src/renderer/components/ui';
import { groupMessages, initials } from '../src/renderer/lib/utils';
import { mentionsOf } from '../src/renderer/lib/markdown';

describe('ui primitives', () => {
  it('renders avatar initials', () => {
    render(<Avatar name="Nova Star" size={32} />);
    expect(screen.getByText('NS')).toBeTruthy();
  });
  it('computes initials and groups', () => {
    expect(initials('Nova')).toBe('NO');
    const msgs = [
      { authorId: 'a', createdAt: '2026-01-01T10:00:00Z' },
      { authorId: 'a', createdAt: '2026-01-01T10:01:00Z' },
      { authorId: 'b', createdAt: '2026-01-01T10:02:00Z' },
    ];
    expect(groupMessages(msgs)).toEqual([true, false, true]);
  });
  it('extracts mentions', () => {
    expect(mentionsOf('hi @Nova and @pixel!')).toEqual(['nova', 'pixel']);
  });
});
