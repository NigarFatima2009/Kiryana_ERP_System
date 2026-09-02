import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Search,
  Filter,
  Plus,
  ArrowRight,
  FileText,
  Download,
  RefreshCw,
  Building2,
  Calendar,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  Banknote,
  Eye,
  Edit3,
  Trash2,
  X,
} from 'lucide-react';
import {
  fetchCheques,
  createCheque,
  updateChequeStatus,
  deleteCheque,
  getChequesSummary,
  getChequeMaturityInfo,
  type Cheque,
  type ChequeType,
  type ChequeStatus,
} from '../../services/cheques';
import { fetchCustomers } from '../../services/customers';
import { fetchSuppliers } from '../../services/suppliers';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

// ─────────────────────────── Status helpers ───────────────────────────────────

const STATUS_META: Record<ChequeStatus, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  PENDING: {
    label: 'Pending',
    icon: <Clock size={13} />,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  CLEARED: {
    label: 'Cleared',
    icon: <CheckCircle size={13} />,
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
  BOUNCED: {
    label: 'Bounced',
    icon: <XCircle size={13} />,
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
  },
  CANCELLED: {
    label: 'Cancelled',
    icon: <X size={13} />,
    color: 'text-gray-600',
    bg: 'bg-gray-50',
    border: 'border-gray-200',
  },
};

function StatusBadge({ status }: { status: ChequeStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${m.color} ${m.bg} ${m.border}`}>
      {m.icon}{m.label}
    </span>
  );
}

function TypeBadge({ type }: { type: ChequeType }) {
  return type === 'RECEIVED' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
      <TrendingDown size={12} />Received
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 border border-purple-200 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
      <TrendingUp size={12} />Issued
    </span>
  );
}

function MaturityCell({ cheque }: { cheque: Cheque }) {
  const info = getChequeMaturityInfo(cheque.due_date, cheque.status);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${info.badgeClass}`}>
      {info.label}
    </span>
  );
}

// ─────────────────────────── Status transition modal ─────────────────────────

const TRANSITIONS: Record<ChequeStatus, ChequeStatus[]> = {
  PENDING: ['CLEARED', 'BOUNCED', 'CANCELLED'],
  CLEARED: [],
  BOUNCED: ['PENDING'],
  CANCELLED: [],
};

const TRANSITION_LABELS: Record<ChequeStatus, string> = {
  CLEARED: '✓ Mark as Cleared',
  BOUNCED: '✕ Mark as Bounced',
  CANCELLED: '⊘ Cancel Cheque',
  PENDING: '↩ Reopen as Pending',
};

const TRANSITION_BTN: Record<ChequeStatus, string> = {
  CLEARED: 'bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors',
  BOUNCED: 'bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors',
  CANCELLED: 'bg-gray-500 hover:bg-gray-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors',
  PENDING: 'bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors',
};

function UpdateStatusModal({ cheque, onClose, onSuccess }: { cheque: Cheque; onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(cheque.notes || '');
  const [targetStatus, setTargetStatus] = useState<ChequeStatus | null>(null);

  const available = TRANSITIONS[cheque.status];

  const mutation = useMutation({
    mutationFn: async (status: ChequeStatus) => updateChequeStatus(cheque.id, status, notes.trim() || undefined),
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      toast('success', `Cheque ${cheque.cheque_number} marked as ${status}.`);
      onSuccess();
    },
    onError: (err: Error) => toast('error', err.message),
  });

  return (
    <Modal isOpen title={`Update Status — ${cheque.cheque_number}`} onClose={onClose} size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          {targetStatus && (
            <button disabled={mutation.isPending} onClick={() => mutation.mutate(targetStatus!)} className={TRANSITION_BTN[targetStatus]}>
              {mutation.isPending ? 'Saving…' : TRANSITION_LABELS[targetStatus]}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-gray-200 p-4 bg-gray-50 text-sm space-y-2">
          <div className="flex justify-between"><span className="text-gray-500">Party</span><span className="font-medium">{cheque.party_name}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-semibold text-blue-700">{formatCurrency(Number(cheque.amount))}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Bank</span><span className="font-medium">{cheque.bank_name}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Due</span><span className="font-medium">{formatDate(cheque.due_date)}</span></div>
          <div className="flex justify-between items-center"><span className="text-gray-500">Current</span><StatusBadge status={cheque.status} /></div>
        </div>

        {available.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-4">No further transitions available.</p>
        ) : (
          <>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">Change Status To</label>
              {available.map((s) => (
                <button key={s} onClick={() => setTargetStatus(s)}
                  className={`w-full flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-sm font-medium text-left transition-all ${
                    targetStatus === s
                      ? s === 'CLEARED' ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : s === 'BOUNCED' ? 'border-red-500 bg-red-50 text-red-800'
                        : s === 'CANCELLED' ? 'border-gray-400 bg-gray-50 text-gray-700'
                        : 'border-blue-500 bg-blue-50 text-blue-800'
                      : 'border-gray-200 hover:border-gray-300 bg-white text-gray-700'
                  }`}
                >
                  {STATUS_META[s].icon}
                  {TRANSITION_LABELS[s]}
                  {targetStatus === s && <ArrowRight size={14} className="ml-auto" />}
                </button>
              ))}
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Notes / Reason <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="e.g. Deposited at HBL branch on 2-Sep-2026…" className="input-field text-sm resize-none" />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─────────────────────────── Add Cheque modal ─────────────────────────────────

const BANKS = ['HBL', 'Meezan', 'UBL', 'MCB', 'Allied Bank', 'Bank Alfalah', 'Faysal Bank', 'NBP', 'Silk Bank', 'Other'];

function AddChequeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: customersData } = useQuery({ queryKey: ['customers'], queryFn: () => fetchCustomers() });
  const customers = customersData?.data || [];

  const { data: suppliersData } = useQuery({ queryKey: ['suppliers'], queryFn: () => fetchSuppliers() });
  const suppliers = suppliersData?.data || [];

  const [form, setForm] = useState({
    type: 'RECEIVED' as ChequeType,
    party_type: 'WALK_IN' as 'WALK_IN' | 'CUSTOMER' | 'SUPPLIER' | 'OTHER',
    party_id: '',
    party_name: 'Walk-in Customer',
    cheque_number: '',
    bank_name: 'HBL',
    account_number: '',
    drawer_title: '',
    amount: '',
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    notes: '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const generateChequeNumber = () => {
    const num = `CHK-${Math.floor(100000 + Math.random() * 900000)}`;
    set('cheque_number', num);
  };

  const handlePartyTypeChange = (type: string) => {
    if (type === 'WALK_IN') {
      setForm((f) => ({ ...f, party_type: 'WALK_IN', party_id: '', party_name: 'Walk-in Customer' }));
    } else if (type === 'CUSTOMER') {
      setForm((f) => ({ ...f, party_type: 'CUSTOMER', party_id: '', party_name: '' }));
    } else if (type === 'SUPPLIER') {
      setForm((f) => ({ ...f, party_type: 'SUPPLIER', party_id: '', party_name: '' }));
    } else {
      setForm((f) => ({ ...f, party_type: 'OTHER', party_id: '', party_name: '' }));
    }
  };

  const handlePartyId = (id: string) => {
    set('party_id', id);
    if (form.party_type === 'CUSTOMER') {
      const c = (customers as any[]).find((x: any) => x.id === id);
      if (c) set('party_name', c.name);
    } else if (form.party_type === 'SUPPLIER') {
      const s = (suppliers as any[]).find((x: any) => x.id === id);
      if (s) set('party_name', s.name);
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const finalPartyName = form.party_name.trim() || form.drawer_title.trim() || 'Walk-in Customer';
      if (!form.cheque_number.trim()) throw new Error('Cheque number is required');
      if (!form.amount || Number(form.amount) <= 0) throw new Error('Amount must be greater than 0');
      await createCheque({
        type: form.type,
        party_type: form.party_type === 'SUPPLIER' ? 'SUPPLIER' : form.party_type === 'CUSTOMER' ? 'CUSTOMER' : 'OTHER',
        party_id: form.party_id || null,
        party_name: finalPartyName,
        cheque_number: form.cheque_number.trim(),
        bank_name: form.bank_name,
        account_number: form.account_number.trim() || null,
        drawer_title: form.drawer_title.trim() || null,
        amount: Number(form.amount),
        issue_date: form.issue_date,
        due_date: form.due_date,
        status: 'PENDING',
        notes: form.notes.trim() || null,
        reference_sale_id: null,
        reference_purchase_order_id: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      toast('success', `Cheque ${form.cheque_number} recorded.`);
      onSuccess();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const dueDaysFromNow = (d: number) => set('due_date', new Date(Date.now() + d * 86400000).toISOString().slice(0, 10));

  return (
    <Modal isOpen title="Record New Cheque" onClose={onClose} size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Saving…' : 'Save Cheque'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label-text">Cheque Type *</label>
            <select value={form.type} onChange={(e) => set('type', e.target.value)} className="select-field">
              <option value="RECEIVED">Received (from Customer)</option>
              <option value="ISSUED">Issued (to Supplier)</option>
            </select>
          </div>
          <div>
            <label className="label-text">Party Type *</label>
            <select value={form.party_type} onChange={(e) => handlePartyTypeChange(e.target.value)} className="select-field">
              <option value="WALK_IN">Walk-in Customer</option>
              <option value="CUSTOMER">Registered Customer</option>
              <option value="SUPPLIER">Supplier</option>
              <option value="OTHER">Other Party / Person</option>
            </select>
          </div>
        </div>

        {form.party_type === 'WALK_IN' && (
          <div>
            <label className="label-text">Walk-in Customer Name</label>
            <input
              value={form.party_name}
              onChange={(e) => set('party_name', e.target.value)}
              className="input-field"
              placeholder="e.g. Walk-in Customer or Person's Name"
            />
          </div>
        )}
        {form.party_type === 'CUSTOMER' && (
          <div>
            <label className="label-text">Customer *</label>
            <select value={form.party_id} onChange={(e) => handlePartyId(e.target.value)} className="select-field">
              <option value="">-- Select Customer --</option>
              {(customers as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>)}
            </select>
          </div>
        )}
        {form.party_type === 'SUPPLIER' && (
          <div>
            <label className="label-text">Supplier *</label>
            <select value={form.party_id} onChange={(e) => handlePartyId(e.target.value)} className="select-field">
              <option value="">-- Select Supplier --</option>
              {(suppliers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        {form.party_type === 'OTHER' && (
          <div>
            <label className="label-text">Party Name *</label>
            <input value={form.party_name} onChange={(e) => set('party_name', e.target.value)} className="input-field" placeholder="Enter party/person name" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label-text mb-0">Cheque Number *</label>
              <button
                type="button"
                onClick={generateChequeNumber}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-medium underline"
              >
                ⚡ Auto-fill
              </button>
            </div>
            <input value={form.cheque_number} onChange={(e) => set('cheque_number', e.target.value)} className="input-field" placeholder="e.g. CHK-104928" />
          </div>
          <div>
            <label className="label-text">Amount (Rs.) *</label>
            <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} className="input-field" placeholder="0.00" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label-text">Bank *</label>
            <select value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} className="select-field">
              {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="label-text">Drawer Title (Optional)</label>
            <input value={form.drawer_title} onChange={(e) => set('drawer_title', e.target.value)} className="input-field" placeholder="Name printed on cheque" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label-text">Issue Date *</label>
            <input type="date" value={form.issue_date} onChange={(e) => set('issue_date', e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="label-text">Clearance / Due Date *</label>
            <div className="flex gap-1 mb-1">
              {[0, 7, 15, 30, 60].map((d) => (
                <button key={d} type="button" onClick={() => dueDaysFromNow(d)}
                  className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-white text-gray-700 hover:bg-blue-50 hover:border-blue-400">
                  {d === 0 ? 'Today' : `+${d}d`}
                </button>
              ))}
            </div>
            <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} className="input-field" />
          </div>
        </div>

        <div>
          <label className="label-text">Notes (Optional)</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="input-field resize-none text-sm" placeholder="Linked sale number, purpose, etc." />
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────── View/Detail modal ────────────────────────────────

function ChequeDetailModal({ cheque, onClose }: { cheque: Cheque; onClose: () => void }) {
  const exportCSV = () => {
    const rows = [
      ['Field', 'Value'],
      ['Cheque Number', cheque.cheque_number],
      ['Type', cheque.type],
      ['Status', cheque.status],
      ['Party', cheque.party_name],
      ['Party Type', cheque.party_type],
      ['Bank', cheque.bank_name],
      ['Account', cheque.account_number || ''],
      ['Drawer', cheque.drawer_title || ''],
      ['Amount', String(cheque.amount)],
      ['Issue Date', cheque.issue_date],
      ['Due Date', cheque.due_date],
      ['Cleared At', cheque.cleared_at || ''],
      ['Notes', cheque.notes || ''],
      ['Created At', cheque.created_at],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cheque-${cheque.cheque_number}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const printDetail = () => {
    const html = `<html><head><title>Cheque — ${cheque.cheque_number}</title>
      <style>body{font-family:sans-serif;padding:24px;max-width:600px;margin:auto}
        h1{font-size:1.3rem;margin-bottom:16px}table{width:100%;border-collapse:collapse}
        td{padding:6px 10px;border-bottom:1px solid #eee}td:first-child{font-weight:600;color:#555;width:40%}
      </style></head><body>
      <h1>Cheque — ${cheque.cheque_number}</h1>
      <table>
        <tr><td>Type</td><td>${cheque.type}</td></tr>
        <tr><td>Status</td><td>${cheque.status}</td></tr>
        <tr><td>Party</td><td>${cheque.party_name}</td></tr>
        <tr><td>Bank</td><td>${cheque.bank_name}</td></tr>
        <tr><td>Amount</td><td>Rs. ${Number(cheque.amount).toLocaleString()}</td></tr>
        <tr><td>Issue Date</td><td>${cheque.issue_date}</td></tr>
        <tr><td>Due Date</td><td>${cheque.due_date}</td></tr>
        ${cheque.drawer_title ? `<tr><td>Drawer</td><td>${cheque.drawer_title}</td></tr>` : ''}
        ${cheque.notes ? `<tr><td>Notes</td><td>${cheque.notes}</td></tr>` : ''}
        ${cheque.cleared_at ? `<tr><td>Cleared At</td><td>${cheque.cleared_at}</td></tr>` : ''}
      </table>
      <p style="margin-top:24px;font-size:.75rem;color:#999">Printed: ${new Date().toLocaleString()}</p>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.print();
  };

  return (
    <Modal isOpen title={`Cheque — ${cheque.cheque_number}`} onClose={onClose} size="md"
      footer={
        <>
          <button onClick={exportCSV} className="btn-secondary flex items-center gap-1.5 text-sm"><Download size={14} />CSV</button>
          <button onClick={printDetail} className="btn-secondary flex items-center gap-1.5 text-sm"><FileText size={14} />Print / PDF</button>
          <button onClick={onClose} className="btn-primary">Close</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <TypeBadge type={cheque.type} />
            <StatusBadge status={cheque.status} />
          </div>
          <MaturityCell cheque={cheque} />
        </div>

        <dl className="divide-y divide-gray-100 text-sm">
          {([
            ['Party', cheque.party_name],
            ['Party Type', cheque.party_type],
            ['Bank', cheque.bank_name],
            ...(cheque.drawer_title ? [['Drawer Title', cheque.drawer_title]] : []),
            ...(cheque.account_number ? [['Account #', cheque.account_number]] : []),
            ['Amount', formatCurrency(Number(cheque.amount))],
            ['Issue Date', formatDate(cheque.issue_date)],
            ['Due Date', formatDate(cheque.due_date)],
            ...(cheque.cleared_at ? [['Cleared At', formatDate(cheque.cleared_at)]] : []),
            ...(cheque.notes ? [['Notes', cheque.notes]] : []),
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between py-2">
              <dt className="text-gray-500 font-medium">{k}</dt>
              <dd className="text-gray-900 font-semibold text-right max-w-[60%]">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}

// ─────────────────────────── Summary card ────────────────────────────────────

function SummaryCard({ label, value, sub, icon, color }: { label: string; value: string; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className={`rounded-xl border p-4 flex items-start gap-3 bg-white shadow-sm ${color}`}>
      <div className="rounded-lg p-2 bg-white/70 shadow-sm">{icon}</div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─────────────────────────── Bulk export helpers ─────────────────────────────

function exportChequesCSV(cheques: Cheque[]) {
  const headers = ['Cheque #', 'Type', 'Status', 'Party', 'Bank', 'Amount', 'Issue Date', 'Due Date', 'Notes'];
  const rows = cheques.map((c) => [c.cheque_number, c.type, c.status, c.party_name, c.bank_name, String(c.amount), c.issue_date, c.due_date, c.notes || '']);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `cheques-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function exportChequesPDF(cheques: Cheque[]) {
  const rows = cheques.map((c) =>
    `<tr><td>${c.cheque_number}</td><td>${c.type}</td><td>${c.status}</td><td>${c.party_name}</td><td>${c.bank_name}</td><td>Rs. ${Number(c.amount).toLocaleString()}</td><td>${c.due_date}</td></tr>`
  ).join('');
  const html = `<html><head><title>Cheques Report</title>
    <style>body{font-family:sans-serif;padding:20px}h1{font-size:1.2rem;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;font-size:.8rem}
    th,td{padding:6px 8px;border:1px solid #ddd;text-align:left}th{background:#f3f4f6;font-weight:600}</style>
    </head><body>
    <h1>Cheques Report — ${new Date().toLocaleDateString()}</h1>
    <table><thead><tr><th>Cheque #</th><th>Type</th><th>Status</th><th>Party</th><th>Bank</th><th>Amount</th><th>Due Date</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p style="margin-top:16px;font-size:.7rem;color:#999">Total: ${cheques.length} cheques | Printed: ${new Date().toLocaleString()}</p>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.print();
}

// ─────────────────────────── Main Page ───────────────────────────────────────

interface Summary {
  pendingReceivedAmount: number;
  pendingIssuedAmount: number;
  dueWithin15DaysCount: number;
  dueWithin15DaysAmount: number;
  overdueCount: number;
  overdueAmount: number;
  totalChequesCount: number;
}

export function ChequesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterType, setFilterType] = useState<ChequeType | 'ALL'>('ALL');
  const [filterStatus, setFilterStatus] = useState<ChequeStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedForUpdate, setSelectedForUpdate] = useState<Cheque | null>(null);
  const [selectedForView, setSelectedForView] = useState<Cheque | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const { data: cheques = [], isLoading, refetch } = useQuery({
    queryKey: ['cheques', filterType, filterStatus, search],
    queryFn: () => fetchCheques({
      type: filterType === 'ALL' ? undefined : filterType,
      status: filterStatus === 'ALL' ? undefined : filterStatus,
      search: search || undefined,
    }),
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['cheques-summary'],
    queryFn: getChequesSummary,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCheque(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      toast('success', 'Cheque deleted.');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const handleDelete = (cheque: Cheque) => {
    if (!window.confirm(`Delete cheque ${cheque.cheque_number}? This cannot be undone.`)) return;
    deleteMutation.mutate(cheque.id);
  };

  const overdueCount = useMemo(
    () => cheques.filter((c) => c.status === 'PENDING' && new Date(c.due_date) < new Date()).length,
    [cheques]
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Banknote className="text-blue-600" size={26} />
            Cheque Management
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Track received and issued cheques through their full lifecycle</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void refetch()} className="btn-secondary flex items-center gap-1.5 text-sm py-1.5">
            <RefreshCw size={14} />Refresh
          </button>

          <div className="relative">
            <button onClick={() => setShowExportMenu((v) => !v)} className="btn-secondary flex items-center gap-1.5 text-sm py-1.5">
              <Download size={14} />Export<ChevronDown size={12} />
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 mt-1 w-44 rounded-lg border border-gray-200 bg-white shadow-lg z-20 py-1">
                  <button onClick={() => { exportChequesCSV(cheques); setShowExportMenu(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                    <Download size={13} />Export CSV
                  </button>
                  <button onClick={() => { exportChequesPDF(cheques); setShowExportMenu(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                    <FileText size={13} />Print / PDF
                  </button>
                </div>
              </>
            )}
          </div>

          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1.5 text-sm py-1.5">
            <Plus size={15} />New Cheque
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Pending Received" value={formatCurrency(summary.pendingReceivedAmount)} sub="From customers/parties" icon={<TrendingDown size={18} className="text-blue-600" />} color="border-blue-100" />
          <SummaryCard label="Pending Issued" value={formatCurrency(summary.pendingIssuedAmount)} sub="Given to suppliers" icon={<TrendingUp size={18} className="text-purple-600" />} color="border-purple-100" />
          <SummaryCard label="Due in 15 Days" value={String(summary.dueWithin15DaysCount)} sub={formatCurrency(summary.dueWithin15DaysAmount)} icon={<Calendar size={18} className="text-amber-600" />} color="border-amber-100" />
          <SummaryCard label="Overdue" value={String(summary.overdueCount)} sub={formatCurrency(summary.overdueAmount)} icon={<AlertTriangle size={18} className="text-red-600" />} color="border-red-100" />
        </div>
      )}

      {/* Overdue alert */}
      {overdueCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={18} className="shrink-0 text-red-500" />
          <strong>{overdueCount} cheque{overdueCount !== 1 ? 's are' : ' is'} overdue — please take action immediately.</strong>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cheque #, party, bank…" className="input-field pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={15} className="text-gray-400" />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as ChequeType | 'ALL')} className="select-field text-sm py-1.5">
            <option value="ALL">All Types</option>
            <option value="RECEIVED">Received</option>
            <option value="ISSUED">Issued</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as ChequeStatus | 'ALL')} className="select-field text-sm py-1.5">
            <option value="ALL">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="CLEARED">Cleared</option>
            <option value="BOUNCED">Bounced</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw size={22} className="animate-spin mr-2" />Loading cheques…
          </div>
        ) : cheques.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <Banknote size={40} className="opacity-30" />
            <p className="font-medium">No cheques found</p>
            <p className="text-sm">Use the &ldquo;New Cheque&rdquo; button to record one.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-4 py-3 font-semibold text-gray-600">Cheque #</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Type</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Party</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Bank</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Amount</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Due Date</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Maturity</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cheques.map((c) => {
                const isOverdue = c.status === 'PENDING' && new Date(c.due_date) < new Date();
                return (
                  <tr key={c.id} className={`hover:bg-gray-50 transition-colors ${isOverdue ? 'bg-red-50/40' : ''}`}>
                    <td className="px-4 py-3 font-mono font-semibold text-blue-700">{c.cheque_number}</td>
                    <td className="px-4 py-3"><TypeBadge type={c.type} /></td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{c.party_name}</div>
                      {c.drawer_title && <div className="text-xs text-gray-400">{c.drawer_title}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Building2 size={13} className="text-gray-400" />{c.bank_name}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(Number(c.amount))}</td>
                    <td className="px-4 py-3 text-gray-600">
                      <div className="flex items-center gap-1">
                        <Calendar size={13} className="text-gray-400" />{formatDate(c.due_date)}
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3"><MaturityCell cheque={c} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button title="View Details" onClick={() => setSelectedForView(c)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors">
                          <Eye size={15} />
                        </button>
                        {TRANSITIONS[c.status].length > 0 && (
                          <button title="Update Status" onClick={() => setSelectedForUpdate(c)} className="rounded-lg p-1.5 text-blue-500 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                            <Edit3 size={15} />
                          </button>
                        )}
                        <button title="Delete" onClick={() => handleDelete(c)} disabled={deleteMutation.isPending} className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400 text-right">{cheques.length} cheque{cheques.length !== 1 ? 's' : ''} shown</p>

      {/* Modals */}
      {showAdd && <AddChequeModal onClose={() => setShowAdd(false)} onSuccess={() => setShowAdd(false)} />}
      {selectedForUpdate && <UpdateStatusModal cheque={selectedForUpdate} onClose={() => setSelectedForUpdate(null)} onSuccess={() => setSelectedForUpdate(null)} />}
      {selectedForView && <ChequeDetailModal cheque={selectedForView} onClose={() => setSelectedForView(null)} />}
    </div>
  );
}
