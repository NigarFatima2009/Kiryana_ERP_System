import { supabase } from '../lib/supabase';

export async function createAuditLog(params: {
  action: string;
  entity_type: string;
  entity_id?: string;
  previous_value?: Record<string, unknown>;
  new_value?: Record<string, unknown>;
}) {
  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    await supabase.from('audit_logs').insert({
      user_id: user?.id || null,
      action: params.action,
      entity_type: params.entity_type,
      entity_id: params.entity_id || null,
      previous_value: params.previous_value || null,
      new_value: params.new_value || null,
    });
  } catch (error) {
    // Don't let audit logging errors break the main operation
    console.error('Audit log error:', error);
  }
}

// Helper functions for common audit actions
export const audit = {
  // Products
  productCreated: (id: string, data: Record<string, unknown>) =>
    createAuditLog({ action: 'PRODUCT_CREATED', entity_type: 'PRODUCT', entity_id: id, new_value: data }),
  
  productUpdated: (id: string, previous: Record<string, unknown>, updated: Record<string, unknown>) =>
    createAuditLog({ action: 'PRODUCT_UPDATED', entity_type: 'PRODUCT', entity_id: id, previous_value: previous, new_value: updated }),
  
  productDeactivated: (id: string) =>
    createAuditLog({ action: 'PRODUCT_DEACTIVATED', entity_type: 'PRODUCT', entity_id: id }),

  // Sales
  saleCreated: (id: string, data: Record<string, unknown>) =>
    createAuditLog({ action: 'SALE_CREATED', entity_type: 'SALE', entity_id: id, new_value: data }),
  
  saleReturned: (id: string, data: Record<string, unknown>) =>
    createAuditLog({ action: 'SALE_RETURNED', entity_type: 'SALE_RETURN', entity_id: id, new_value: data }),

  // Purchases
  purchaseOrderCreated: (id: string, data: Record<string, unknown>) =>
    createAuditLog({ action: 'PURCHASE_ORDER_CREATED', entity_type: 'PURCHASE_ORDER', entity_id: id, new_value: data }),
  
  purchaseReceived: (id: string, data: Record<string, unknown>) =>
    createAuditLog({ action: 'PURCHASE_RECEIVED', entity_type: 'GOODS_RECEIPT', entity_id: id, new_value: data }),
  
  purchaseReturnCreated: (id: string, data: Record<string, unknown>) =>
    createAuditLog({ action: 'PURCHASE_RETURN_CREATED', entity_type: 'PURCHASE_RETURN', entity_id: id, new_value: data }),

  // Payments
  customerPayment: (customerId: string, amount: number, method: string) =>
    createAuditLog({ action: 'CUSTOMER_PAYMENT', entity_type: 'CUSTOMER_PAYMENT', new_value: { customer_id: customerId, amount, method } }),
  
  supplierPayment: (supplierId: string, amount: number, method: string) =>
    createAuditLog({ action: 'SUPPLIER_PAYMENT', entity_type: 'SUPPLIER_PAYMENT', new_value: { supplier_id: supplierId, amount, method } }),

  // Inventory
  stockAdjusted: (productId: string, quantity: number, reason: string) =>
    createAuditLog({ action: 'STOCK_ADJUSTED', entity_type: 'INVENTORY', entity_id: productId, new_value: { quantity_change: quantity, reason } }),

  // Expenses
  expenseCreated: (id: string, data: Record<string, unknown>) =>
    createAuditLog({ action: 'EXPENSE_CREATED', entity_type: 'EXPENSE', entity_id: id, new_value: data }),

  // Customers
  customerCreated: (id: string, data: Record<string, unknown>) =>
    createAuditLog({ action: 'CUSTOMER_CREATED', entity_type: 'CUSTOMER', entity_id: id, new_value: data }),
  
  customerUpdated: (id: string, previous: Record<string, unknown>, updated: Record<string, unknown>) =>
    createAuditLog({ action: 'CUSTOMER_UPDATED', entity_type: 'CUSTOMER', entity_id: id, previous_value: previous, new_value: updated }),

  // Suppliers
  supplierCreated: (id: string, data: Record<string, unknown>) =>
    createAuditLog({ action: 'SUPPLIER_CREATED', entity_type: 'SUPPLIER', entity_id: id, new_value: data }),
  
  supplierUpdated: (id: string, previous: Record<string, unknown>, updated: Record<string, unknown>) =>
    createAuditLog({ action: 'SUPPLIER_UPDATED', entity_type: 'SUPPLIER', entity_id: id, previous_value: previous, new_value: updated }),

  // Users
  userRoleChanged: (userId: string, oldRole: string, newRole: string) =>
    createAuditLog({ action: 'USER_ROLE_CHANGED', entity_type: 'PROFILE', entity_id: userId, previous_value: { role: oldRole }, new_value: { role: newRole } }),
  
  userDeactivated: (userId: string) =>
    createAuditLog({ action: 'USER_DEACTIVATED', entity_type: 'PROFILE', entity_id: userId }),
};
