export type AppRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'INVENTORY_MANAGER' | 'ACCOUNTANT';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: AppRole;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Brand {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category_id: string | null;
  brand_id: string | null;
  unit: string;
  purchase_price: number;
  selling_price: number;
  wholesale_price: number;
  tax_rate: number;
  reorder_level: number;
  minimum_stock: number;
  maximum_stock: number | null;
  expiry_tracking: boolean;
  active: boolean;
  image_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductWithRelations extends Product {
  categories?: Category | null;
  brands?: Brand | null;
}

export interface Inventory {
  product_id: string;
  quantity: number;
  reserved_quantity: number;
  average_cost: number;
  updated_at: string;
}

export interface InventoryBatch {
  id: string;
  product_id: string;
  supplier_id: string | null;
  batch_number: string | null;
  purchase_cost: number;
  received_quantity: number;
  remaining_quantity: number;
  manufacturing_date: string | null;
  expiry_date: string | null;
  received_date: string;
  created_at: string;
}

export interface InventoryMovement {
  id: string;
  product_id: string;
  batch_id: string | null;
  movement_type: string;
  quantity_change: number;
  unit_cost: number;
  reference_type: string;
  reference_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_information: string | null;
  credit_limit: number;
  opening_balance: number;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_limit: number;
  opening_balance: number;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrder {
  id: string;
  order_number: string;
  supplier_id: string;
  status: 'DRAFT' | 'PENDING' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  order_date: string;
  discount: number;
  tax: number;
  total: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string;
  quantity: number;
  received_quantity: number;
  unit_cost: number;
  discount: number;
}

export interface GoodsReceipt {
  id: string;
  receipt_number: string;
  purchase_order_id: string | null;
  supplier_id: string;
  received_date: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface GoodsReceiptItem {
  id: string;
  goods_receipt_id: string;
  product_id: string;
  batch_id: string;
  quantity: number;
  unit_cost: number;
}

export interface Sale {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  shift_id: string | null;
  status: 'HELD' | 'COMPLETED' | 'CANCELLED' | 'RETURNED';
  sale_date: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  cogs: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax: number;
  line_total: number;
  cogs: number;
}

export interface SalePayment {
  id: string;
  sale_id: string;
  payment_method: string;
  amount: number;
  reference: string | null;
  created_at: string;
}

export interface CustomerTransaction {
  id: string;
  customer_id: string;
  transaction_type: 'OPENING' | 'CREDIT_SALE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT';
  amount: number;
  reference_type: string;
  reference_id: string | null;
  narration: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CustomerPayment {
  id: string;
  customer_id: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  payment_date: string;
  created_by: string | null;
}

export interface SupplierTransaction {
  id: string;
  supplier_id: string;
  transaction_type: 'OPENING' | 'PURCHASE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT';
  amount: number;
  reference_type: string;
  reference_id: string | null;
  narration: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SupplierPayment {
  id: string;
  supplier_id: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  payment_date: string;
  created_by: string | null;
}

export interface SalesReturn {
  id: string;
  sale_id: string;
  customer_id: string | null;
  return_number: string;
  reason: string;
  refund_method: string;
  total: number;
  created_by: string | null;
  created_at: string;
}

export interface SalesReturnItem {
  id: string;
  sales_return_id: string;
  sale_item_id: string;
  quantity: number;
  amount: number;
}

export interface PurchaseReturn {
  id: string;
  goods_receipt_id: string;
  supplier_id: string;
  return_number: string;
  reason: string;
  total: number;
  created_by: string | null;
  created_at: string;
}

export interface PurchaseReturnItem {
  id: string;
  purchase_return_id: string;
  goods_receipt_item_id: string;
  quantity: number;
  amount: number;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  account_code: string;
  active: boolean;
  created_at: string;
}

export interface Expense {
  id: string;
  expense_category_id: string;
  amount: number;
  expense_date: string;
  payment_method: string;
  description: string | null;
  reference: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  account_type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  active: boolean;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  entry_date: string;
  reference_type: string;
  reference_id: string | null;
  description: string;
  created_by: string | null;
  created_at: string;
}

export interface JournalEntryLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
}

export interface Notification {
  id: string;
  recipient_id: string | null;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

export interface StoreSettings {
  id: boolean;
  store_name: string;
  address: string | null;
  phone: string | null;
  currency: string;
  logo_path: string | null;
  updated_at: string;
}

// Cart types for POS
export interface CartItem {
  product: Product;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_amount: number;
  line_total: number;
  batch_id?: string;
}

export interface PaymentEntry {
  method: string;
  amount: number;
  reference?: string;
}

// Dashboard stats
export interface DashboardStats {
  todaySales: number;
  todayPurchases: number;
  todayExpenses: number;
  todayProfit: number;
  cashInHand: number;
  creditSales: number;
  customerReceivables: number;
  supplierPayables: number;
  inventoryValue: number;
  totalProducts: number;
  lowStockProducts: number;
  expiringProducts: number;
}

// Report types
export interface SalesReportRow {
  date: string;
  total_sales: number;
  cash_sales: number;
  credit_sales: number;
  returns: number;
  net_sales: number;
}

export interface ProductSalesReportRow {
  product_id: string;
  product_name: string;
  quantity_sold: number;
  total_revenue: number;
  total_cogs: number;
  profit: number;
}

// Pagination
export interface PaginatedResult<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
