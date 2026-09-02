import React, { memo, useRef, useState } from 'react';
import { Loader2, Inbox } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  keyExtractor?: (row: T) => string;
  virtualizeThreshold?: number;
}

// Memoized table row to prevent unnecessary re-renders
function DataTableRowComponent<T extends Record<string, unknown>>({
  row,
  columns,
  onRowClick,
  rowKey,
}: {
  row: T;
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  rowKey: string;
}) {
  return (
    <tr
      key={rowKey}
      onClick={() => onRowClick?.(row)}
      className={`${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''} transition-colors`}
    >
      {columns.map((col) => (
        <td key={col.key} className={`table-cell ${col.className || ''}`}>
          {col.render
            ? col.render(row)
            : ((row as any)[col.key] as React.ReactNode) ?? '-'}
        </td>
      ))}
    </tr>
  );
}

const DataTableRow = memo(DataTableRowComponent) as typeof DataTableRowComponent;

// Virtual scrolling for large datasets
function VirtualizedTableBody<T extends Record<string, unknown>>({
  data,
  columns,
  onRowClick,
  keyExtractor,
  itemHeight = 50,
  visibleCount = 10,
}: {
  data: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  keyExtractor?: (row: T) => string;
  itemHeight?: number;
  visibleCount?: number;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const startIdx = Math.floor(scrollTop / itemHeight);
  const endIdx = Math.min(startIdx + visibleCount, data.length);
  const visibleData = data.slice(startIdx, endIdx);
  const offsetY = startIdx * itemHeight;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.currentTarget as HTMLDivElement).scrollTop);
  };

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto"
      style={{ height: `${visibleCount * itemHeight}px` }}
      onScroll={handleScroll}
    >
      <div style={{ height: data.length * itemHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleData.map((row, idx) => {
            const actualIdx = startIdx + idx;
            const rowKey = keyExtractor ? keyExtractor(row) : actualIdx.toString();
            return (
              <DataTableRow<T>
                key={rowKey}
                row={row}
                columns={columns}
                onRowClick={onRowClick}
                rowKey={rowKey}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  isLoading,
  emptyMessage = 'No data found',
  onRowClick,
  keyExtractor,
  virtualizeThreshold = 100,
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <Inbox className="mb-3 h-12 w-12 text-gray-300" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  const shouldVirtualize = data.length > virtualizeThreshold;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="table-header">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 ${col.className || ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {shouldVirtualize ? (
            <VirtualizedTableBody<T>
              data={data}
              columns={columns}
              onRowClick={onRowClick}
              keyExtractor={keyExtractor}
            />
          ) : (
            data.map((row, idx) => {
              const rowKey = keyExtractor ? keyExtractor(row) : idx.toString();
              return (
                <DataTableRow<T>
                  key={rowKey}
                  row={row}
                  columns={columns}
                  onRowClick={onRowClick}
                  rowKey={rowKey}
                />
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
