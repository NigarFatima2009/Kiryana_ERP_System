import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAccounts, fetchJournalEntries, fetchJournalEntryLines, getAccountBalances } from '../../services/finance';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { Modal } from '../../components/ui/Modal';

export function AccountingPage() {
  const [tab, setTab] = useState<'accounts' | 'journal' | 'ledger'>('accounts');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);

  const { data: accounts } = useQuery({ queryKey: ['account-balances'], queryFn: getAccountBalances, refetchInterval: 15000 });
  const { data: journalData, isLoading: journalLoading } = useQuery({
    queryKey: ['journal-entries'],
    queryFn: () => fetchJournalEntries({ pageSize: 50 }),
    enabled: tab === 'journal',
    refetchInterval: 15000,
  });

  const accountTypes = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
  const typeColors: Record<string, string> = { ASSET: 'bg-blue-100 text-blue-800', LIABILITY: 'bg-red-100 text-red-800', EQUITY: 'bg-purple-100 text-purple-800', REVENUE: 'bg-green-100 text-green-800', EXPENSE: 'bg-orange-100 text-orange-800' };

  const totalDebit = (accounts || []).reduce((s, a) => s + Number(a.total_debit), 0);
  const totalCredit = (accounts || []).reduce((s, a) => s + Number(a.total_credit), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Accounting</h1>

      <div className="flex gap-2">
        <button onClick={() => setTab('accounts')} className={tab === 'accounts' ? 'btn-primary' : 'btn-secondary'}>Chart of Accounts</button>
        <button onClick={() => setTab('journal')} className={tab === 'journal' ? 'btn-primary' : 'btn-secondary'}>Journal Entries</button>
        <button onClick={() => setTab('ledger')} className={tab === 'ledger' ? 'btn-primary' : 'btn-secondary'}>General Ledger</button>
      </div>

      {tab === 'accounts' && (
        <>
          <div className="card">
            <div className="mb-4 flex justify-between text-sm">
              <span>Total Debit: <span className="font-bold">{formatCurrency(totalDebit)}</span></span>
              <span>Total Credit: <span className="font-bold">{formatCurrency(totalCredit)}</span></span>
              {Math.abs(totalDebit - totalCredit) > 0.01 && (
                <span className="text-red-600">Difference: {formatCurrency(Math.abs(totalDebit - totalCredit))}</span>
              )}
            </div>
          </div>

          {accountTypes.map((type) => {
            const accountsOfType = (accounts || []).filter((a) => a.account_type === type);
            if (accountsOfType.length === 0) return null;
            return (
              <div key={type} className="card">
                <h3 className="mb-3 flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[type]}`}>{type}</span>
                </h3>
                <table className="min-w-full text-sm">
                  <thead><tr className="border-b text-left text-xs text-gray-500">
                    <th className="py-2">Code</th><th className="py-2">Name</th><th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th><th className="py-2 text-right">Balance</th>
                  </tr></thead>
                  <tbody>
                    {accountsOfType.map((a) => (
                      <tr key={a.id} className="border-b">
                        <td className="py-2 font-mono text-xs">{a.code}</td>
                        <td className="py-2">{a.name}</td>
                        <td className="py-2 text-right">{formatCurrency(Number(a.total_debit))}</td>
                        <td className="py-2 text-right">{formatCurrency(Number(a.total_credit))}</td>
                        <td className="py-2 text-right font-bold">{formatCurrency(Number(a.balance))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}

      {tab === 'journal' && (
        <div className="card p-0">
          {journalLoading ? (
            <p className="py-8 text-center">Loading...</p>
          ) : (journalData?.data || []).length === 0 ? (
            <p className="py-8 text-center text-gray-500">No journal entries</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead><tr className="table-header">
                <th className="px-4 py-3">Date</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {(journalData?.data || []).map((je) => (
                  <tr key={je.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedEntry(je.id)}>
                    <td className="table-cell">{formatDateTime(je.entry_date)}</td>
                    <td className="table-cell font-medium">{je.description}</td>
                    <td className="table-cell"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{je.reference_type}</span></td>
                    <td className="table-cell text-blue-600">View Lines</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'ledger' && <GeneralLedger />}

      {selectedEntry && <JournalEntryDetail entryId={selectedEntry} onClose={() => setSelectedEntry(null)} />}
    </div>
  );
}

function JournalEntryDetail({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { data: lines } = useQuery({
    queryKey: ['journal-lines', entryId],
    queryFn: () => fetchJournalEntryLines(entryId),
  });

  return (
    <Modal isOpen={true} onClose={onClose} title="Journal Entry Lines" size="lg">
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-gray-500">
          <th className="py-2">Account</th><th className="py-2">Debit</th><th className="py-2">Credit</th>
        </tr></thead>
        <tbody>
          {(lines || []).map((l) => (
            <tr key={l.id} className="border-b">
              <td className="py-2">
                <span className="font-mono text-xs text-gray-500">{l.accounts?.code}</span> {l.accounts?.name}
              </td>
              <td className="py-2">{Number(l.debit) > 0 ? formatCurrency(Number(l.debit)) : '-'}</td>
              <td className="py-2">{Number(l.credit) > 0 ? formatCurrency(Number(l.credit)) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function GeneralLedger() {
  const { data: accounts } = useQuery({ queryKey: ['accounts-list'], queryFn: fetchAccounts });
  const [selectedAccount, setSelectedAccount] = useState('');
  const { data: ledger } = useQuery({
    queryKey: ['general-ledger', selectedAccount],
    queryFn: async () => {
      const { supabase } = await import('../../lib/supabase');
      let query = supabase.from('journal_entry_lines').select('*, journal_entries!journal_entry_lines_journal_entry_id_fkey(reference_type, description, created_at)').order('created_at', { ascending: false }).limit(100);
      if (selectedAccount) query = query.eq('account_id', selectedAccount);
      const { data } = await query;
      return data || [];
    },
  });

  return (
    <div className="space-y-4">
      <div className="card">
        <label className="label">Filter by Account</label>
        <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} className="select-field max-w-md">
          <option value="">All Accounts</option>
          {(accounts || []).map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
        </select>
      </div>

      <div className="card p-0">
        <table className="min-w-full text-sm">
          <thead><tr className="table-header">
            <th className="px-4 py-3">Date</th><th className="px-4 py-3">Account</th><th className="px-4 py-3">Description</th><th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(ledger || []).map((l: Record<string, unknown>) => {
              const je = l.journal_entries as Record<string, unknown> | null;
              const accts = l.accounts as Record<string, unknown> | null;
              return (
                <tr key={l.id as string}>
                  <td className="table-cell">{je ? formatDateTime(je.created_at as string) : '-'}</td>
                  <td className="table-cell">{accts?.name as string || '-'}</td>
                  <td className="table-cell">{je?.description as string || '-'}</td>
                  <td className="table-cell text-right">{Number(l.debit) > 0 ? formatCurrency(Number(l.debit)) : '-'}</td>
                  <td className="table-cell text-right">{Number(l.credit) > 0 ? formatCurrency(Number(l.credit)) : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
