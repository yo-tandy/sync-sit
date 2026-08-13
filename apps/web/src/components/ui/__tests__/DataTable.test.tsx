import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { DataTable, type DataTableColumn } from '../DataTable';

interface Row {
  id: string;
  name: string;
  age: number | null;
}

const columns: DataTableColumn<Row>[] = [
  {
    key: 'name',
    header: 'Name',
    sortValue: (r) => r.name.toLowerCase(),
    render: (r) => r.name,
  },
  {
    key: 'age',
    header: 'Age',
    sortValue: (r) => r.age,
    render: (r) => (r.age === null ? '—' : String(r.age)),
  },
  {
    key: 'actions',
    header: 'Actions',
    render: (r) => <button type="button">edit {r.id}</button>,
  },
];

const rows: Row[] = [
  { id: '1', name: 'Charlie', age: 30 },
  { id: '2', name: 'alice', age: null },
  { id: '3', name: 'Bob', age: 25 },
];

function renderTable(overrides: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      emptyLabel="Nothing here"
      {...overrides}
    />,
  );
}

/** First-column text of each body row, in document order. */
function bodyRowNames() {
  const [, ...body] = screen.getAllByRole('row');
  return body.map((tr) => tr.querySelector('td')?.textContent);
}

describe('DataTable', () => {
  // apps/web's vitest setup does not auto-cleanup (globals: false).
  afterEach(() => cleanup());

  it('renders one columnheader per column and one row per item', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    // Header row + 3 body rows.
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('sorts ascending on header click, reverses on second click, and reflects aria-sort', () => {
    renderTable();
    const nameHeader = screen.getByRole('columnheader', { name: 'Name' });
    const nameButton = screen.getByRole('button', { name: 'Name' });

    expect(nameHeader).not.toHaveAttribute('aria-sort');

    fireEvent.click(nameButton);
    expect(bodyRowNames()).toEqual(['alice', 'Bob', 'Charlie']);
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.click(nameButton);
    expect(bodyRowNames()).toEqual(['Charlie', 'Bob', 'alice']);
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  });

  it('applies initialSort without a click', () => {
    renderTable({ initialSort: { key: 'name', dir: 'desc' } });
    expect(bodyRowNames()).toEqual(['Charlie', 'Bob', 'alice']);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('sinks null sort values to the bottom in both directions', () => {
    renderTable();
    const ageButton = screen.getByRole('button', { name: 'Age' });

    fireEvent.click(ageButton);
    // alice has age null — last even ascending.
    expect(bodyRowNames()).toEqual(['Bob', 'Charlie', 'alice']);

    fireEvent.click(ageButton);
    expect(bodyRowNames()).toEqual(['Charlie', 'Bob', 'alice']);
  });

  it('renders no sort button for a column without sortValue', () => {
    renderTable();
    const actionsHeader = screen.getByRole('columnheader', { name: 'Actions' });
    expect(actionsHeader.querySelector('button')).toBeNull();
  });

  it('renders emptyLabel and no table when there are no rows', () => {
    renderTable({ rows: [] });
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
