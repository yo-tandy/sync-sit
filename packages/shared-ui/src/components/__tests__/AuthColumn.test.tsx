import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AuthColumn } from '../AuthColumn.js';

afterEach(cleanup);

describe('AuthColumn', () => {
  it('centres its children in a max-w-md column (issue #528)', () => {
    render(
      <AuthColumn>
        <p>inside</p>
      </AuthColumn>,
    );
    const column = screen.getByText('inside').parentElement!;
    expect(column.className).toContain('max-w-md');
    expect(column.className).toContain('mx-auto');
    expect(column.className).toContain('w-full');
  });
});
