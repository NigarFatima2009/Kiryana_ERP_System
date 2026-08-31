import { supabase } from '../lib/supabase';
import { audit } from './audit';
import type { Expense, ExpenseCategory, Account, JournalEntry, JournalEntryLine } from '../types/database';

// ==================== TODAY'S EXPENSES ====================

export async function getTodaysExpenses(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('expenses')
    .select('amount')
    .gte('expense_date', `${today}T00:00:00`)
    .lte('expense_date', `${today}T23:59:59`);
  if (error) throw error;
  return (data || []).reduce((sum: number, e: { amount: number }) => sum + Number(e.amount), 0);
}

// ==================== EXPENSES ====================

export async function fetchExpenses(params?: { page?: number; pageSize?: number; category_id?: string }) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('expenses')
    .select('*, expense_categories!expenses_expense_category_id_fkey(name, account_code)', { count: 'exact' })
    .order('expense_date', { ascending: false })
    .range(from, to);

  if (params?.category_id) query = query.eq('expense_category_id', params.category_id);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data as (Expense & { expense_categories: { name: string; account_code: string } })[], count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
}

export async function createExpense(expense: {
  expense_category_id: string;
  amount: number;
  expense_date: string;
  payment_method: string;
  description?: string;
  reference?: string;
}) {
  const { data, error } = await supabase.from('expenses').insert(expense).select().single();
  if (error) throw error;

  const { data: cat } = await supabase.from('expense_categories').select('account_code').eq('id', expense.expense_category_id).single();

  if (cat) {
    const { data: accounts } = await supabase.from('accounts').select('id, code');
    const accountMap = new Map(accounts?.map((a) => [a.code, a.id]) || []);

    const { data: je } = await supabase.from('journal_entries').insert({
      reference_type: 'EXPENSE', reference_id: data.id, description: `Expense: ${expense.description || 'N/A'}`,
    }).select().single();

    if (je) {
      const lines: { journal_entry_id: string; account_id: string; debit: number; credit: number }[] = [];
      lines.push({ journal_entry_id: je.id, account_id: accountMap.get(cat.account_code) || '', debit: expense.amount, credit: 0 });
      const creditAccount = expense.payment_method === 'CASH' ? 'CASH' : 'BANK';
      lines.push({ journal_entry_id: je.id, account_id: accountMap.get(creditAccount) || '', debit: 0, credit: expense.amount });
      await supabase.from('journal_entry_lines').insert(lines);
    }
  }

  // Create audit log
  await audit.expenseCreated(data.id, {
    category_id: expense.expense_category_id,
    amount: expense.amount,
    payment_method: expense.payment_method,
    description: expense.description,
  });

  return data as Expense;
}

export async function fetchExpenseCategories() {
  const { data, error } = await supabase.from('expense_categories').select('*').eq('active', true).order('name');
  if (error) throw error;
  return data as ExpenseCategory[];
}

// ==================== ACCOUNTING ====================

export async function fetchAccounts() {
  const { data, error } = await supabase.from('accounts').select('*').eq('active', true).order('code');
  if (error) throw error;
  return data as Account[];
}

export async function fetchJournalEntries(params?: { page?: number; pageSize?: number; reference_type?: string }) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 30;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('journal_entries')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params?.reference_type) query = query.eq('reference_type', params.reference_type);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data as JournalEntry[], count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
}

export async function fetchJournalEntryLines(entryId: string) {
  const { data, error } = await supabase
    .from('journal_entry_lines')
    .select('*, accounts!journal_entry_lines_account_id_fkey(code, name, account_type)')
    .eq('journal_entry_id', entryId);
  if (error) throw error;
  return data as (JournalEntryLine & { accounts: { code: string; name: string; account_type: string } })[];
}

export async function getAccountBalances() {
  const { data: accounts } = await supabase.from('accounts').select('*').eq('active', true);
  if (!accounts) return [];

  const results = [];

  for (const account of accounts) {
    const { data: lines } = await supabase
      .from('journal_entry_lines')
      .select('debit, credit')
      .eq('account_id', account.id);

    let totalDebit = 0;
    let totalCredit = 0;
    lines?.forEach((l) => { totalDebit += Number(l.debit); totalCredit += Number(l.credit); });

    let balance = 0;
    if (['ASSET', 'EXPENSE'].includes(account.account_type)) {
      balance = totalDebit - totalCredit;
    } else {
      balance = totalCredit - totalDebit;
    }

    results.push({ ...account, total_debit: totalDebit, total_credit: totalCredit, balance });
  }

  return results;
}

export async function fetchGeneralLedger(accountId?: string) {
  let query = supabase
    .from('journal_entry_lines')
    .select('*, journal_entries!journal_entry_lines_journal_entry_id_fkey(reference_type, description, created_at)')
    .order('created_at', { ascending: false });

  if (accountId) query = query.eq('account_id', accountId);

  const { data: lines, error } = await query;
  if (error) throw error;
  return (lines || []) as (JournalEntryLine & { journal_entries: { reference_type: string; description: string; created_at: string } })[];
}
