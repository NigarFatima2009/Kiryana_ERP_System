import { supabase } from '../lib/supabase';
import { getOfflineDB } from '../lib/offline/db';
import type { OfflineCheque, ChequeType, ChequeStatus, ChequePartyType } from '../lib/offline/types';

export type { ChequeType, ChequeStatus, ChequePartyType };

export interface Cheque extends OfflineCheque {}

export interface ChequeMaturityInfo {
  status: ChequeStatus;
  label: string;
  badgeClass: string;
  daysRemaining: number;
  isDueToday: boolean;
  isOverdue: boolean;
}

/**
 * Calculates human-friendly maturity countdown and badge info for a cheque.
 * Example: "Cashes in 15 days", "Due today", "Overdue by 3 days", "Cleared"
 */
export function getChequeMaturityInfo(dueDateStr: string, status: ChequeStatus): ChequeMaturityInfo {
  if (status === 'CLEARED') {
    return {
      status,
      label: '✓ Cleared',
      badgeClass: 'bg-green-100 text-green-800 border-green-200',
      daysRemaining: 0,
      isDueToday: false,
      isOverdue: false,
    };
  }

  if (status === 'BOUNCED') {
    return {
      status,
      label: '✕ Bounced',
      badgeClass: 'bg-red-100 text-red-800 border-red-200',
      daysRemaining: 0,
      isDueToday: false,
      isOverdue: false,
    };
  }

  if (status === 'CANCELLED') {
    return {
      status,
      label: 'Cancelled',
      badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
      daysRemaining: 0,
      isDueToday: false,
      isOverdue: false,
    };
  }

  // Calculate calendar days difference
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);

  const diffMs = due.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return {
      status: 'PENDING',
      label: '⚡ Cashes Today',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 font-bold animate-pulse',
      daysRemaining: 0,
      isDueToday: true,
      isOverdue: false,
    };
  }

  if (diffDays > 0) {
    return {
      status: 'PENDING',
      label: `⏳ Cashes in ${diffDays} day${diffDays === 1 ? '' : 's'}`,
      badgeClass: diffDays <= 3 
        ? 'bg-orange-100 text-orange-800 border-orange-200 font-semibold' 
        : 'bg-blue-100 text-blue-800 border-blue-200',
      daysRemaining: diffDays,
      isDueToday: false,
      isOverdue: false,
    };
  }

  // Overdue
  const overdueDays = Math.abs(diffDays);
  return {
    status: 'PENDING',
    label: `⚠️ Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`,
    badgeClass: 'bg-red-100 text-red-800 border-red-300 font-bold',
    daysRemaining: diffDays,
    isDueToday: false,
    isOverdue: true,
  };
}

function generateId(): string {
  return 'chk_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

/**
 * Fetch all cheques with optional filtering
 */
export async function fetchCheques(params?: {
  type?: ChequeType;
  status?: ChequeStatus;
  search?: string;
}): Promise<Cheque[]> {
  // When online, ALWAYS fetch from Supabase (other users' cheques live here)
  // then merge with local IndexedDB (unsynced offline cheques from this device).
  let serverCheques: Cheque[] = [];
  let localCheques: Cheque[] = [];

  try {
    localCheques = await getOfflineDB().cheques.toArray();
  } catch (dbErr) {
    console.warn('[Cheques] Local DB read failed:', dbErr);
  }

  if (navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from('cheques')
        .select('*')
        .order('due_date', { ascending: true });
      if (!error && data) {
        serverCheques = data as Cheque[];
        // Cache server data locally for offline fallback
        try {
          await getOfflineDB().cheques.bulkPut(serverCheques);
        } catch {}
      }
    } catch (remoteErr) {
      console.warn('[Cheques] Supabase fetch failed:', remoteErr);
    }
  }

  // Merge: server cheques + local-only (unsynced) cheques, deduplicated by id
  const serverIds = new Set(serverCheques.map((c) => c.id));
  const unsyncedLocal = localCheques.filter((c) => !serverIds.has(c.id));
  const allCheques = [...serverCheques, ...unsyncedLocal];

  // Apply filtering
  return allCheques.filter((c) => {
    if (params?.type && c.type !== params.type) return false;
    if (params?.status && c.status !== params.status) return false;
    if (params?.search) {
      const q = params.search.toLowerCase();
      const matches =
        c.cheque_number.toLowerCase().includes(q) ||
        c.party_name.toLowerCase().includes(q) ||
        c.bank_name.toLowerCase().includes(q) ||
        (c.drawer_title && c.drawer_title.toLowerCase().includes(q));
      if (!matches) return false;
    }
    return true;
  }).sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
}

/**
 * Create a new cheque record (Received from customer or Issued to supplier).
 * ALWAYS writes directly to Supabase — cheques are live financial records that the
 * owner must see instantly. They are never buffered in IndexedDB.
 * Automatically notifies Store Owner & Manager.
 */
export async function createCheque(data: Omit<Cheque, 'id' | 'created_at'>): Promise<Cheque> {
  if (!navigator.onLine) {
    throw new Error('Cheque cannot be recorded offline. Please reconnect and try again.');
  }

  const id = generateId();
  const now = new Date().toISOString();

  const partyId = (data.party_id && typeof data.party_id === 'string' && data.party_id.trim().length > 10)
    ? data.party_id.trim()
    : null;

  const newCheque: Cheque = {
    ...data,
    party_id: partyId,
    id,
    created_at: now,
    updated_at: now,
    synced: true, // always starts synced — it goes straight to server
  };

  // Write to Supabase first — this is the source of truth
  const { error: insertError } = await supabase.from('cheques').insert(newCheque);
  if (insertError) throw new Error(`Failed to record cheque: ${insertError.message}`);

  // Also cache locally so ChequesPage works offline later
  try {
    const db = getOfflineDB();
    await db.cheques.put(newCheque);
  } catch { /* IndexedDB unavailable is non-fatal */ }

  // Notify Owner & Managers live
  try {
    const title = data.type === 'RECEIVED'
      ? `📜 Cheque Received: ${data.cheque_number} (Rs. ${Number(data.amount).toLocaleString()})`
      : `📜 Cheque Issued: ${data.cheque_number} (Rs. ${Number(data.amount).toLocaleString()})`;

    const body = data.type === 'RECEIVED'
      ? `Received from ${data.party_name} via ${data.bank_name}. Due: ${data.due_date}. Please clear in Cheque Management when banked.`
      : `Issued to ${data.party_name} via ${data.bank_name}. Due: ${data.due_date}.`;

    const { data: owners } = await supabase.from('profiles').select('id').in('role', ['OWNER', 'MANAGER']);
    const recipients = owners && owners.length > 0 ? owners : [{ id: null }];
    for (const owner of recipients) {
      await supabase.from('notifications').insert({
        recipient_id: owner.id,
        type: 'CHEQUE_RECEIVED',
        title,
        body,
        entity_type: 'cheque',
        entity_id: id,
      });
    }
  } catch (notifErr) {
    console.warn('[Cheques] Notification sending skipped:', notifErr);
  }

  return newCheque;
}

/**
 * Update cheque status (e.g. Mark as Cleared, Bounced, Cancelled)
 * When marked CLEARED, notifies management and updates any linked sale invoice
 */
export async function updateChequeStatus(
  id: string,
  status: ChequeStatus,
  notes?: string
): Promise<Cheque> {
  let cheque: Cheque | null = null;
  const db = getOfflineDB();

  try {
    cheque = (await db.cheques.get(id)) || null;
  } catch (err) {
    console.warn('[Cheques] Local DB read error:', err);
  }

  // If not found locally in IndexedDB, fetch directly from Supabase
  if (!cheque && navigator.onLine) {
    const { data: remoteData, error: remoteErr } = await supabase
      .from('cheques')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!remoteErr && remoteData) {
      cheque = remoteData as Cheque;
    }
  }

  if (!cheque) throw new Error('Cheque not found');

  const now = new Date().toISOString();
  const updated: Cheque = {
    ...cheque,
    status,
    notes: notes !== undefined ? notes : cheque.notes,
    cleared_at: status === 'CLEARED' ? now : cheque.cleared_at,
    updated_at: now,
    synced: true,
  };

  // 1. Update in Supabase first (cloud source of truth for deployed instances)
  if (navigator.onLine) {
    const { error: updateErr } = await supabase
      .from('cheques')
      .update({
        status,
        notes: updated.notes,
        cleared_at: updated.cleared_at,
        updated_at: now,
      })
      .eq('id', id);

    if (updateErr) {
      console.error('[Cheques] Supabase update failed:', updateErr);
      throw new Error(`Failed to update cheque in database: ${updateErr.message}`);
    }

    // On Clearance: Notify management and sync linked sale status to COMPLETED / PAID
    if (status === 'CLEARED') {
      try {
        const title = `✓ Cheque Cleared: ${cheque.cheque_number}`;
        const body = `Cheque #${cheque.cheque_number} (Rs. ${Number(cheque.amount).toLocaleString()}) for ${cheque.party_name} has been CLEARED by the bank.`;

        const { data: owners } = await supabase.from('profiles').select('id').in('role', ['OWNER', 'MANAGER']);
        const recipients = owners && owners.length > 0 ? owners : [{ id: null }];
        for (const owner of recipients) {
          await supabase.from('notifications').insert({
            recipient_id: owner.id,
            type: 'CHEQUE_CLEARED',
            title,
            body,
            entity_type: 'cheque',
            entity_id: id,
          });
        }

        // If linked to a sale (check reference_sale_id or notes for INV number), update sale status
        if (cheque.reference_sale_id) {
          await supabase.from('sales').update({ status: 'COMPLETED' }).eq('id', cheque.reference_sale_id);
        } else if (cheque.notes) {
          const invMatch = cheque.notes.match(/(INV-[A-Za-z0-9-]+)/);
          if (invMatch && invMatch[1]) {
            const invoiceNum = invMatch[1];
            await supabase.from('sales').update({ status: 'COMPLETED' }).eq('invoice_number', invoiceNum);
          }
        }
      } catch (syncErr) {
        console.warn('[Cheques] Clearance sync error:', syncErr);
      }
    }

    // On Bounce: Notify management immediately
    if (status === 'BOUNCED') {
      try {
        const title = `✕ Cheque BOUNCED: ${cheque.cheque_number}`;
        const body = `Cheque #${cheque.cheque_number} (Rs. ${Number(cheque.amount).toLocaleString()}) from ${cheque.party_name} via ${cheque.bank_name} has BOUNCED.${notes ? ` Reason: ${notes}` : ''} Please take immediate action.`;

        const { data: owners } = await supabase.from('profiles').select('id').in('role', ['OWNER', 'MANAGER']);
        const recipients = owners && owners.length > 0 ? owners : [{ id: null }];
        for (const owner of recipients) {
          await supabase.from('notifications').insert({
            recipient_id: owner.id,
            type: 'CHEQUE_BOUNCED',
            title,
            body,
            entity_type: 'cheque',
            entity_id: id,
          });
        }

        if (cheque.reference_sale_id) {
          await supabase.from('sales').update({ notes: `Cheque bounced: ${cheque.cheque_number}` }).eq('id', cheque.reference_sale_id);
        } else if (cheque.notes) {
          const invMatch = cheque.notes.match(/(INV-[A-Za-z0-9-]+)/);
          if (invMatch && invMatch[1]) {
            const invoiceNum = invMatch[1];
            await supabase.from('sales').update({ notes: `Cheque bounced: ${cheque.cheque_number}` }).eq('invoice_number', invoiceNum);
          }
        }
      } catch (bounceErr) {
        console.warn('[Cheques] Bounce notification error:', bounceErr);
      }
    }
  }

  // 2. Also cache updated state locally in IndexedDB
  try {
    await db.cheques.put(updated);
  } catch (dbPutErr) {
    console.warn('[Cheques] Local DB put failed:', dbPutErr);
  }

  return updated;
}

/**
 * Delete a cheque record
 */
export async function deleteCheque(id: string): Promise<void> {
  if (navigator.onLine) {
    const { error } = await supabase.from('cheques').delete().eq('id', id);
    if (error) {
      console.error('[Cheques] Remote delete failed:', error);
      throw new Error(`Failed to delete cheque: ${error.message}`);
    }
  }

  try {
    const db = getOfflineDB();
    await db.cheques.delete(id);
  } catch (err) {
    console.warn('[Cheques] Local delete failed:', err);
  }
}

/**
 * Get summary dashboard metrics for cheques
 */
export async function getChequesSummary() {
  // Reuse the same merge logic as fetchCheques so summary reflects all cheques
  const allCheques = await fetchCheques();

  let pendingReceivedAmount = 0;
  let pendingIssuedAmount = 0;
  let dueWithin15DaysCount = 0;
  let dueWithin15DaysAmount = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  let pendingCount = 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  allCheques.forEach((c) => {
    if (c.status === 'PENDING') {
      pendingCount++;
      if (c.type === 'RECEIVED') {
        pendingReceivedAmount += Number(c.amount);
      } else {
        pendingIssuedAmount += Number(c.amount);
      }

      const due = new Date(c.due_date);
      due.setHours(0, 0, 0, 0);
      const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        overdueCount++;
        overdueAmount += Number(c.amount);
      } else if (diffDays <= 15) {
        dueWithin15DaysCount++;
        dueWithin15DaysAmount += Number(c.amount);
      }
    }
  });

  return {
    pendingCount,
    pendingReceivedAmount,
    pendingIssuedAmount,
    dueWithin15DaysCount,
    dueWithin15DaysAmount,
    overdueCount,
    overdueAmount,
    totalChequesCount: allCheques.length,
  };
}

/**
 * Sync unsynced cheques from IndexedDB to Supabase and send owner notifications
 */
export async function syncOfflineCheques(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 };
  const db = getOfflineDB();
  const unsynced = await db.cheques.filter((c) => c.synced === false).toArray();
  if (unsynced.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const chk of unsynced) {
    try {
      const { error } = await supabase.from('cheques').upsert({
        id: chk.id,
        cheque_number: chk.cheque_number,
        type: chk.type,
        party_type: chk.party_type,
        party_id: chk.party_id || null,
        party_name: chk.party_name,
        bank_name: chk.bank_name,
        account_number: chk.account_number || null,
        drawer_title: chk.drawer_title || null,
        amount: chk.amount,
        issue_date: chk.issue_date,
        due_date: chk.due_date,
        status: chk.status,
        cleared_at: chk.cleared_at || null,
        notes: chk.notes || null,
        created_at: chk.created_at,
        updated_at: chk.updated_at,
      });

      if (!error) {
        chk.synced = true;
        await db.cheques.put(chk);
        synced++;

        // Send owner notification if it's pending
        if (chk.status === 'PENDING') {
          try {
            const title = chk.type === 'RECEIVED'
              ? `📜 Cheque Received: ${chk.cheque_number} (Rs. ${Number(chk.amount).toLocaleString()})`
              : `📜 Cheque Issued: ${chk.cheque_number} (Rs. ${Number(chk.amount).toLocaleString()})`;

            const body = chk.type === 'RECEIVED'
              ? `Received from ${chk.party_name} via ${chk.bank_name}. Due date: ${chk.due_date}. Please clear in Cheque Management when banked.`
              : `Issued to ${chk.party_name} via ${chk.bank_name}. Due date: ${chk.due_date}.`;

            const { data: owners } = await supabase.from('profiles').select('id').in('role', ['OWNER', 'MANAGER']);
            if (owners && owners.length > 0) {
              for (const owner of owners) {
                await supabase.from('notifications').insert({
                  recipient_id: owner.id,
                  type: 'CHEQUE_RECEIVED',
                  title,
                  body,
                  entity_type: 'cheque',
                  entity_id: chk.id,
                });
              }
            } else {
              await supabase.from('notifications').insert({
                recipient_id: null,
                type: 'CHEQUE_RECEIVED',
                title,
                body,
                entity_type: 'cheque',
                entity_id: chk.id,
              });
            }
          } catch (notifErr) {
            console.warn('[Cheques] Notification error during sync:', notifErr);
          }
        }
      } else {
        failed++;
      }
    } catch (e) {
      console.warn('[Cheques] Error syncing offline cheque:', e);
      failed++;
    }
  }

  return { synced, failed };
}

