import { useMemo, useState, type ReactNode } from 'react';

import { ChevronDownIcon, ChevronUpIcon } from '@/components/ui/Icons';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  /** Omit to make the column unsortable (e.g. actions). */
  sortValue?: (row: T) => string | number | null;
  render: (row: T) => ReactNode;
  /** Extra classes for td/th, e.g. 'text-right' for actions. */
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** i18n'd empty-state line. */
  emptyLabel: string;
  /** Initial sort; column key must have a sortValue. */
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}

export function DataTable<T>({ columns, rows, rowKey, emptyLabel, initialSort }: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    // Nulls always sink to the bottom regardless of direction.
    return [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string) => {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={sort?.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                className={`px-3 py-2 text-xs font-semibold text-gray-600 ${col.className ?? ''}`}
              >
                {col.sortValue ? (
                  <button
                    type="button"
                    onClick={() => toggle(col.key)}
                    className="-m-1.5 inline-flex min-h-11 items-center gap-1 p-1.5 font-semibold"
                  >
                    {col.header}
                    {sort?.key === col.key &&
                      (sort.dir === 'asc' ? (
                        <ChevronUpIcon className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDownIcon className="h-3.5 w-3.5" />
                      ))}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((row) => (
            <tr key={rowKey(row)} className="bg-white">
              {columns.map((col) => (
                <td key={col.key} className={`px-3 py-2 align-top ${col.className ?? ''}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
