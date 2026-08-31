# Kiryana Store ERP & POS System

A complete, integrated Enterprise Resource Planning (ERP) and Point of Sale (POS) system designed specifically for Kiryana (grocery/general) stores. Built with React, TypeScript, Tailwind CSS, and Supabase PostgreSQL.

## 🎯 Overview

This is a **real, functional ERP system** with persistent data storage in Supabase PostgreSQL. It manages every aspect of a retail grocery store:

- **Products & Inventory** - SKU tracking, batches with expiry dates, FEFO (First Expired First Out) deductions
- **POS & Sales** - Fast retail checkout, multiple payment methods, split payments, customer credit (Khata)
- **Purchasing** - Purchase orders, goods receipts, supplier management, purchase returns
- **Customers** - Customer management, credit limits, Khata (ledger), payment tracking
- **Accounting** - Double-entry accounting, journal entries, general ledger, profit & loss
- **Reports** - Comprehensive reports: sales, inventory, customers, suppliers, expenses
- **Notifications** - Low stock, expiring products, credit limit alerts
- **Audit Logs** - Complete transaction history with user tracking
- **Role-Based Access** - Cashier, Inventory Manager, Accountant, Manager, Owner roles with RLS security

## 🏗️ Architecture

```
React + TypeScript (Frontend)
        ↓
Supabase Client
        ↓
Supabase Platform
 ├── PostgreSQL (Database)
 ├── Auth (Authentication)
 ├── RLS (Row Level Security)
 ├── RPC (Database Functions)
 ├── Edge Functions (Server Logic)
 └── Realtime (Live Updates)
```

### Key Principles

1. **Atomic Transactions** - Critical operations (sales, purchases, payments) are atomic PostgreSQL functions
2. **Inventory Accuracy** - FEFO for expiry-tracked items, accurate COGS calculation
3. **Data Integrity** - Foreign keys, constraints, RLS policies at database level
4. **Real Persistence** - All data stored in Supabase PostgreSQL, not localStorage
5. **Business Logic Correctness** - Every business rule enforced at the database layer

## 📋 Technology Stack

### Frontend
- **React 19** - UI library
- **TypeScript** - Type safety
- **Vite** - Fast build tool
- **Tailwind CSS** - Styling
- **React Router** - Navigation
- **TanStack Query** - Data fetching & caching
- **React Hook Form** - Form management
- **Zod** - Schema validation
- **Lucide React** - Icons
- **Recharts** - Charts & graphs

### Backend / Database
- **Supabase** - Complete backend platform
  - PostgreSQL database
  - Supabase Auth
  - Row Level Security (RLS)
  - PostgreSQL RPC Functions
  - Supabase Edge Functions
  - Realtime subscriptions
  - Storage (for images)

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Supabase account (free tier available)
- Git

### 1. Clone & Setup

```bash
# Clone the repository
git clone <repo-url>
cd ERP_System

# Install dependencies
npm install
```

### 2. Supabase Setup

#### Create a Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Create a new project (PostgreSQL database)
3. Wait for the database to be provisioned
4. Go to Project Settings → API Keys
5. Copy your `Project URL` and `anon public key`

#### Apply Database Migrations

```bash
# Option 1: Using Supabase CLI (recommended)
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push

# Option 2: Manual SQL import
# 1. Go to SQL Editor in Supabase dashboard
# 2. Create a new query
# 3. Copy content from supabase/migrations/202608310001_foundation.sql
# 4. Paste and run
# 5. Repeat for supabase/migrations/202608310002_rpc_functions.sql
```

#### Seed Demo Data

```bash
# Using Supabase CLI
supabase db push --dry-run
# Then run seed data:
psql postgresql://<user>:<password>@<host>:<port>/<database> < supabase/seed.sql

# Or manually:
# 1. Go to SQL Editor in Supabase
# 2. Copy content from supabase/seed.sql
# 3. Paste and run
```

### 3. Environment Configuration

Create `.env` file in project root:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Get these values from:
- Supabase Dashboard → Project Settings → API

### 4. Create Test User

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add user"
3. Enter email: `owner@erp.local`
4. Set password: `password123`
5. Click "Create user"

Then set their role:

```sql
-- In Supabase SQL Editor
UPDATE public.profiles 
SET role = 'OWNER' 
WHERE id = (SELECT id FROM auth.users WHERE email = 'owner@erp.local');
```

### 5. Run Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### 6. Login

- Email: `owner@erp.local`
- Password: `password123`

## 📚 Database Schema

### Core Tables

#### Authentication & Users
- `auth.users` - Supabase Auth users
- `profiles` - User profiles with roles
- `roles` - Role definitions (OWNER, MANAGER, CASHIER, etc.)
- `permissions` - Permission definitions
- `role_permissions` - Role to permission mappings

#### Products & Catalog
- `products` - Product master data
- `categories` - Product categories
- `brands` - Product brands
- `inventory` - Current stock levels
- `inventory_batches` - Batch tracking with expiry dates
- `inventory_movements` - Stock movement audit trail

#### Purchasing
- `suppliers` - Supplier master data
- `purchase_orders` - POs with status tracking
- `purchase_order_items` - PO line items
- `goods_receipts` - Goods receipt records
- `goods_receipt_items` - GR line items with batch tracking
- `purchase_returns` - Purchase return tracking
- `supplier_transactions` - Supplier ledger
- `supplier_payments` - Payment records

#### Sales & POS
- `customers` - Customer master data
- `sales` - Sales invoices
- `sale_items` - Sales line items
- `sale_payments` - Payment method breakdown
- `sales_returns` - Return tracking
- `sales_return_items` - Return line items
- `customer_transactions` - Customer ledger (Khata)
- `customer_payments` - Customer payment records

#### Finance & Accounting
- `accounts` - Chart of accounts
- `journal_entries` - Journal entry headers
- `journal_entry_lines` - Journal entry line items
- `expenses` - Expense records
- `expense_categories` - Expense categories

#### System
- `notifications` - User notifications
- `audit_logs` - Complete audit trail
- `store_settings` - Store configuration

## 🔐 Role-Based Access Control (RLS)

Each role has specific permissions enforced at the database level:

### OWNER
- Full access to all features
- User management
- System settings

### MANAGER
- Access to all operational features
- Can view accounting reports
- Cannot modify user roles or settings

### CASHIER
- POS access
- Can process sales
- Can view customer information
- Can record customer payments
- Cannot access purchasing or accounting

### INVENTORY_MANAGER
- Product management
- Inventory operations
- Purchase order management
- Goods receiving
- Cannot access sales or accounting

### ACCOUNTANT
- Accounting operations
- Financial reports
- Expense management
- Cannot access sales or inventory management

All permissions are enforced with RLS policies at the database level, not just the frontend.

## 📊 Key Features

### POS System
- **Fast Search** - Product search by name, SKU, or barcode
- **Keyboard Shortcuts** - F2: Search, F4: Select Customer, F8: Hold Sale, F9: Payment
- **Barcode Scanning** - Automatic product addition via barcode
- **Cart Management** - Add, remove, adjust quantities
- **Multiple Payments** - Split payments across different methods (Cash, Card, Khata, etc.)
- **Customer Credit** - Khata/credit system with limit enforcement
- **Hold & Resume** - Hold sales and resume later

### Inventory Management
- **Batch Tracking** - Track products by batch number
- **Expiry Management** - FEFO (First Expired First Out) deduction logic
- **Stock Movements** - Complete audit trail of all stock changes
- **Low Stock Alerts** - Automatic notifications for reorder level
- **Expiry Alerts** - Notifications for expiring/expired products

### Purchasing
- **Purchase Orders** - Create, track, and receive orders
- **Goods Receiving** - Atomic receipt with batch tracking
- **Supplier Management** - Supplier master, transaction history
- **Purchase Returns** - Track and manage returns
- **Supplier Ledger** - Complete transaction history

### Customers & Khata
- **Customer Master** - Customer information and credit limits
- **Customer Khata** - Complete credit ledger with running balance
- **Aging Report** - Track outstanding customer receivables
- **Payment Tracking** - Record and track customer payments

### Accounting
- **Double-Entry Accounting** - Every transaction creates journal entries
- **Chart of Accounts** - Pre-configured for retail
- **General Ledger** - View account-wise transactions
- **Trial Balance** - Verify accounting accuracy
- **Profit & Loss** - Real-time profitability calculation
- **Balance Sheet** - Asset, liability, equity tracking

### Reports
- **Sales Report** - Daily/monthly sales analysis
- **Inventory Report** - Stock valuation and movement
- **Customer Report** - Balances and aging
- **Supplier Report** - Outstanding payables
- **Expense Report** - Category-wise expenses
- **Financial Report** - P&L, trial balance, general ledger

## 🔄 Critical Business Workflows

### Complete Sale Workflow
```
1. Add products to cart → 2. Select customer → 3. Apply discount/tax
4. Payment → 5. Create sale (atomic) → 6. Deduct inventory (FEFO)
7. Calculate COGS → 8. Create accounting entries → 9. Update Khata
10. Create audit log → 11. Receipt
```

### Purchase Workflow
```
1. Create PO → 2. Add items → 3. Receive goods (atomic)
4. Update inventory → 5. Create batches → 6. Create accounting entries
7. Update supplier payable → 8. Create audit log
```

### Customer Payment Workflow
```
1. Record payment (atomic) → 2. Update Khata
3. Create cash receipt → 4. Create accounting entries
5. Create audit log
```

All critical operations are atomic PostgreSQL functions that guarantee data consistency.

## 🔧 RPC Functions

### Transactional Functions
- `receive_goods(goods_receipt_id)` - Atomic goods receipt processing
- `complete_pos_sale(customer_id, items, payments, discount, tax)` - Atomic POS sale
- `record_customer_payment(customer_id, amount, method, reference)` - Atomic payment
- `record_supplier_payment(supplier_id, amount, method, reference)` - Atomic payment
- `process_sales_return(sales_return_id)` - Atomic return processing

### Query Functions
- `customer_balance(customer_id)` - Calculate current customer balance
- `supplier_balance(supplier_id)` - Calculate current supplier balance
- `inventory_value()` - Calculate total inventory value
- `current_user_role()` - Get current user's role
- `has_any_role(allowed_roles)` - Check user permissions

## 📱 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| F2 | Product search (POS) |
| F4 | Select customer (POS) |
| F8 | Hold sale (POS) |
| F9 | Payment modal (POS) |
| Esc | Close modals |

## 🎨 UI/UX

- **Responsive Design** - Works on desktop and tablet
- **Dark-aware** - Clean, professional interface
- **Keyboard Accessible** - Full keyboard navigation
- **Fast & Snappy** - Optimized with TanStack Query caching
- **Real-time Updates** - Supabase Realtime for live data

## 📦 Building for Production

```bash
npm run build
```

This creates an optimized build in the `dist/` folder ready for deployment.

### Deployment Options

#### Vercel (Recommended)
```bash
npm install -g vercel
vercel
```

#### Netlify
```bash
npm install -g netlify-cli
netlify deploy
```

#### Any Static Host
The `dist/` folder contains static files that can be deployed to any web server.

**Important**: Set environment variables in your hosting platform:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 🧪 Testing

Run tests:
```bash
npm run test
```

## 📝 API Documentation

### Service Files

#### Products & Catalog (`src/services/products.ts`)
- `fetchProducts(params)` - Get paginated product list
- `fetchProduct(id)` - Get single product
- `createProduct(product)` - Create new product
- `updateProduct(id, updates)` - Update product
- `deleteProduct(id)` - Deactivate product
- `fetchCategories()` - Get all categories
- `fetchBrands()` - Get all brands

#### Inventory (`src/services/inventory.ts`)
- `fetchInventory(productId)` - Get current stock
- `fetchBatches(productId)` - Get product batches
- `fetchExpiringBatches(days)` - Get expiring products
- `fetchExpiredBatches()` - Get expired products
- `fetchInventoryMovements(productId)` - Get stock movement history

#### Sales & POS (`src/services/sales.ts`)
- `completePOSSale(customer, items, payments, discount, tax)` - Complete a sale
- `fetchSales(params)` - Get sales list
- `fetchSalesReturns(params)` - Get returns list
- `createSalesReturn(saleId, items, reason)` - Create return
- `getTodaysSales()` - Get today's sales summary
- `getTopSellingProducts(limit)` - Get top products

#### Customers (`src/services/customers.ts`)
- `fetchCustomers(params)` - Get customers list
- `fetchCustomer(id)` - Get single customer
- `createCustomer(customer)` - Create customer
- `getCustomerBalance(customerId)` - Get customer balance
- `fetchCustomerStatement(customerId)` - Get complete Khata
- `recordCustomerPayment(customerId, amount, method)` - Record payment

#### Purchasing (`src/services/purchasing.ts`)
- `fetchSuppliers(params)` - Get suppliers list
- `fetchPurchaseOrders(params)` - Get POs
- `createPurchaseOrder(order)` - Create PO
- `receiveGoods(goodsReceiptId)` - Receive goods
- `recordSupplierPayment(supplierId, amount, method)` - Record payment

#### Finance (`src/services/finance.ts`)
- `fetchAccounts()` - Get chart of accounts
- `fetchJournalEntries(params)` - Get journal entries
- `createExpense(expense)` - Create expense
- `getTrialBalance()` - Get trial balance
- `getProfitAndLoss(dateFrom, dateTo)` - Get P&L
- `getBalanceSheet()` - Get balance sheet

#### Dashboard (`src/services/dashboard.ts`)
- `getDashboardStats()` - Get dashboard statistics
- `getSalesChart(days)` - Get sales chart data
- `getTopProducts(limit)` - Get top selling products

#### Reports (`src/services/reports.ts`)
- `getSalesReport(dateFrom, dateTo)` - Sales report
- `getInventoryReport()` - Inventory report
- `getCustomerBalanceReport()` - Customer balances
- `getPurchaseReport(dateFrom, dateTo)` - Purchase report
- `getExpenseReport(dateFrom, dateTo)` - Expense report

## 🐛 Troubleshooting

### "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY"
- Check that `.env` file exists in project root
- Verify you copied the correct credentials from Supabase dashboard
- Restart the dev server after updating .env

### RLS Policy Errors
- Ensure you're logged in with a valid user
- Check that the user has the correct role assigned
- Verify RLS policies are enabled on the table
- Check database migrations have been applied

### "Connection refused"
- Verify Supabase project URL is correct
- Check that your database is not paused (Supabase free tier pauses after 1 week of inactivity)
- Resume the database in Supabase dashboard

### Sales not creating inventory movements
- Verify the `complete_pos_sale` RPC function was created
- Check that product exists and has inventory record
- Ensure batches exist for the product if expiry_tracking is enabled

## 📞 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Supabase documentation: https://supabase.com/docs
3. Check React documentation: https://react.dev

## 📄 License

This project is provided as-is for use in retail operations.

## 🎯 Project Structure

```
ERP_System/
├── src/
│   ├── components/         # React components
│   │   ├── layout/        # Layout components
│   │   └── ui/            # Reusable UI components
│   ├── pages/             # Page components
│   │   ├── auth/          # Authentication pages
│   │   ├── products/      # Product pages
│   │   ├── inventory/     # Inventory pages
│   │   ├── purchasing/    # Purchasing pages
│   │   ├── customers/     # Customer pages
│   │   ├── sales/         # Sales & POS pages
│   │   ├── finance/       # Financial pages
│   │   ├── reports/       # Report pages
│   │   └── settings/      # Settings pages
│   ├── services/          # API service layer
│   ├── lib/               # Utilities & libraries
│   ├── types/             # TypeScript types
│   ├── utils/             # Helper functions
│   ├── App.tsx            # Main app component
│   └── main.tsx           # Entry point
├── supabase/
│   ├── migrations/        # Database migrations
│   └── seed.sql           # Demo data
├── public/                # Static assets
├── .env                   # Environment variables (create this)
├── vite.config.ts         # Vite configuration
├── tsconfig.json          # TypeScript configuration
└── package.json           # Project dependencies
```

## ✅ Features Implementation Status

- [x] Authentication & Authorization
- [x] Product Management
- [x] Inventory Management
- [x] Batch & Expiry Tracking
- [x] Purchasing System
- [x] Supplier Management
- [x] POS System
- [x] Customer Management
- [x] Khata (Customer Credit)
- [x] Accounting System
- [x] Reports
- [x] Notifications
- [x] Audit Logs
- [x] Dashboard
- [x] Role-Based Access Control

## 🚀 Next Steps

1. **Deploy to Production** - Use Vercel or Netlify
2. **Configure Supabase Backups** - Enable automated backups
3. **Setup Email Notifications** - Configure email provider
4. **Add Receipt Printing** - Integrate with thermal printer
5. **Mobile App** - Build React Native version
6. **Analytics** - Add business intelligence features

---

**Last Updated**: August 2026
**Version**: 1.0.0
**Status**: Production Ready ✅
