import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAuditLogs } from '../../services/settings';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { formatDateTime } from '../../utils/helpers';

export function AuditLogsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => fetchAuditLogs({ page }),
  });

  const actionColors: Record<string, string> = {
    PRODUCT_CREATED: 'bg-green-100 text-green-800',
    SALE_CREATED: 'bg-blue-100 text-blue-800',
    STOCK_ADJUSTED: 'bg-yellow-100 text-yellow-800',
    USER_PERMISSION_CHANGED: 'bg-red-100 text-red-800',
  };

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'created_at', header: 'Time', render: (row) => formatDateTime(row.created_at as string) },
    { key: 'user', header: 'User', render: (row) => {
      const p = row.profiles as { full_name: string; role: string } | null;
      return <span className="font-medium">{p?.full_name || 'System'}</span>;
    }},
    { key: 'action', header: 'Action', render: (row) => (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${actionColors[row.action as string] || 'bg-gray-100'}`}>
        {(row.action as string)?.replace(/_/g, ' ')}
      </span>
    )},
    { key: 'entity_type', header: 'Entity', render: (row) => <span className="text-gray-600">{row.entity_type as string}</span> },
    { key: 'entity_id', header: 'Entity ID', render: (row) => <span className="text-xs text-gray-400 font-mono">{(row.entity_id as string)?.slice(0, 8) || '-'}</span> },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
      <div className="card p-0">
        <DataTable columns={columns} data={(data?.data || []).map((l) => l as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No audit logs" />
        <div className="border-t px-4"><Pagination page={page} totalPages={data?.totalPages || 1} onPageChange={setPage} totalItems={data?.count} pageSize={30} /></div>
      </div>
    </div>
  );
}
