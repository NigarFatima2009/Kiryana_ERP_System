# Kiryana ERP - Complete Workflow Guide

This document explains how each module works and how they interact with each other in the ERP system.

---

## 🏪 PURCHASING WORKFLOW

### Step 1: Create a Supplier

**Page**: `Suppliers` (Purchasing → Suppliers)

**What happens**:
- You add a supplier company (e.g., "ABC Traders")
- Store supplier details: name, phone, email, address, credit limit
- Set opening balance (if supplier has existing debt)

**Example**:
```
Supplier Name: ABC Traders
Phone: 021-2345678
Email: sales@abc.com
Credit Limit: Rs 500,000 (max amount you can buy on credit)
Opening Balance: Rs 0 (no existing debt)
```

**What gets created in database**:
- A supplier record
- If opening_balance > 0, a supplier transaction for the opening amount

---

### Step 2: Create a Purchase Order (PO)

**Page**: `Purchase Orders` (Purchasing → Purchase Orders)

**Status**: `DRAFT` (just a plan, not yet confirmed)

**What happens**:
1. You create a new PO
2. Select the supplier (e.g., ABC Traders)
3. Add items/products you want to order with quantities
4. Set discount, tax, total amount
5. PO starts as `DRAFT` status

**Example**:
```
PO Number: PO-260831-1808
Supplier: ABC Traders
Status: DRAFT
Items:
  - Milk 1L: 100 units @ Rs 180 = Rs 18,000
  - Bread: 50 units @ Rs 60 = Rs 3,000
Subtotal: Rs 21,000
Tax: Rs 2,100
Total: Rs 23,100
```

**IMPORTANT**: 
- ❌ **Creating a PO does NOT add inventory yet**
- ❌ **No accounting entries created**
- Just a record of what you plan to order

**What gets created in database**:
- Purchase order record (status = 'DRAFT')
- Purchase order items (line items)

---

### Step 3: Submit Purchase Order

**Action**: Click "Submit" button on the PO

**Status changes**: `DRAFT` → `PENDING`

**What happens**:
1. PO is now confirmed/locked
2. You're ready to send it to supplier
3. Supplier will fulfill this order

**What gets created in database**:
- Status field updated to 'PENDING'

---

### Step 4: Receive Goods (Goods Receipt)

**Page**: `Goods Receipts` (Purchasing → Goods Receipts)

**When**: Goods arrive from supplier

**What happens**:
1. Create a Goods Receipt (GR) linked to the PO
2. For each item received:
   - Confirm the product
   - Create or select a batch (batch number, expiry date if applicable)
   - Confirm quantity received
   - Confirm unit cost
3. Submit the Goods Receipt

**Example**:
```
GR Number: GR-260831-5001
Purchase Order: PO-260831-1808
Supplier: ABC Traders
Items Received:
  - Milk 1L (Batch: MILK-001, Expiry: 15 Sept 2026)
    Quantity: 100 units
    Cost: Rs 180 per unit
    Total: Rs 18,000
  
  - Bread (Batch: BRD-001, No expiry)
    Quantity: 50 units
    Cost: Rs 60 per unit
    Total: Rs 3,000

Total: Rs 23,100
```

### 🔑 CRITICAL: When GR is Submitted

When you submit the Goods Receipt, **an atomic RPC function runs**:

```
receive_goods(goods_receipt_id)
```

This function does the following **all at once or not at all**:

1. **Update Inventory**
   ```
   Inventory[Milk 1L].quantity += 100
   Inventory[Bread].quantity += 50
   ```

2. **Create Batches** (if not exist)
   ```
   Batch[MILK-001]: quantity=100, expiry=15 Sept 2026
   Batch[BRD-001]: quantity=50, no expiry
   ```

3. **Create Inventory Movements** (audit trail)
   ```
   Movement: Milk 1L, +100 units, type=PURCHASE
   Movement: Bread, +50 units, type=PURCHASE
   ```

4. **Create Accounting Entries**
   ```
   Journal Entry created:
   
   Debit:  Inventory Account     Rs 23,100
   Credit: Accounts Payable      Rs 23,100
   
   (You now OWE the supplier Rs 23,100)
   ```

5. **Update PO Status**
   ```
   If all items fully received: PO status = RECEIVED
   If only partially received: PO status = PARTIALLY_RECEIVED
   ```

6. **Update Supplier Payable**
   ```
   Supplier[ABC Traders].payable += Rs 23,100
   ```

**What gets created in database**:
- Goods receipt record
- Goods receipt items with batch references
- Inventory batch records
- Inventory movement records (PURCHASE type)
- Journal entries (Inventory Debit, AP Credit)
- Supplier transaction (PURCHASE type)

---

### Step 5: Supplier Payments

**Page**: `Payments` (Finance → Payments)

**What it means**:
- You pay the supplier for the goods you received
- Reduces the amount you owe the supplier

**Example Scenario**:
```
Step 1: Receive goods
        You owe ABC Traders: Rs 23,100

Step 2: Pay half now
        Pay Rs 10,000 cash
        You now owe: Rs 13,100

Step 3: Pay remaining later
        Pay Rs 13,100
        You now owe: Rs 0
```

### When You Record a Supplier Payment

**Page**: Click "Pay" button next to supplier in Payments

**What happens**:
1. Create a payment record
2. Specify amount paid
3. Specify payment method (Cash, Bank, Cheque, etc.)

**Example**:
```
Supplier: ABC Traders
Amount: Rs 10,000
Payment Method: Bank Transfer
Reference: Check #1234
```

### 🔑 CRITICAL: When Payment is Submitted

Another atomic RPC function runs:

```
record_supplier_payment(supplier_id, amount, method, reference)
```

This function does the following **all at once or not at all**:

1. **Create Payment Record**
   ```
   SupplierPayment: amount=Rs 10,000, method=BANK_TRANSFER
   ```

2. **Update Supplier Balance**
   ```
   Supplier[ABC Traders].payable -= Rs 10,000
   Old payable: Rs 23,100
   New payable: Rs 13,100
   ```

3. **Create Supplier Transaction** (ledger entry)
   ```
   Transaction: type=PAYMENT, amount=Rs 10,000
   (Added to supplier's transaction history)
   ```

4. **Create Accounting Entries**
   ```
   Journal Entry:
   
   Debit:  Accounts Payable     Rs 10,000
   Credit: Cash Account         Rs 10,000
   
   (Cash went out, you owe less)
   ```

5. **Create Audit Log**
   ```
   Log: User Ahmed Khan paid ABC Traders Rs 10,000
   ```

**What gets created in database**:
- Supplier payment record
- Supplier transaction (PAYMENT type)
- Journal entries (AP Debit, Cash Credit)
- Audit log record

---

### Step 6: Purchase Returns (Optional)

**Page**: `Purchase Returns` (Purchasing → Purchase Returns)

**When**: You return damaged/defective goods to supplier

**Example**:
```
5 units of Milk were defective
Return them to ABC Traders
Get credit: Rs 900 (5 units × Rs 180)
```

### When You Create a Purchase Return

1. **Create Return Record**
   ```
   Return Number: PR-260831-2001
   Supplier: ABC Traders
   Goods Receipt: GR-260831-5001
   Reason: Defective products
   Items returned: Milk 1L × 5 units = Rs 900
   ```

2. **What happens in database**:
   - Inventory decreases by 5 units
   - Batch quantity decreases by 5 units
   - Supplier payable decreases by Rs 900
   - Accounting entry created (reverse of purchase):
     ```
     Debit:  Accounts Payable     Rs 900
     Credit: Inventory            Rs 900
     ```

---

## 📊 COMPLETE PURCHASING FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│                    PURCHASING WORKFLOW                          │
└─────────────────────────────────────────────────────────────────┘

1. CREATE SUPPLIER
   └─> Supplier record created
       (No accounting impact)

2. CREATE PURCHASE ORDER
   └─> Status: DRAFT
   └─> Just a plan (no inventory, no accounting)
   └─> Can add/remove items freely

3. SUBMIT PURCHASE ORDER
   └─> Status: DRAFT → PENDING
   └─> Now locked and ready to send to supplier

4. RECEIVE GOODS ← CRITICAL STEP
   └─> Status: PENDING → PARTIALLY_RECEIVED or RECEIVED
   └─> Inventory INCREASES
   └─> Batches CREATED
   └─> Accounting entry created:
       Debit: Inventory (asset increases)
       Credit: Accounts Payable (liability increases)
   └─> Supplier balance updated
   └─> Inventory movements created (audit trail)

5. PAY SUPPLIER ← CRITICAL STEP
   └─> Supplier payable DECREASES
   └─> Cash DECREASES
   └─> Accounting entry created:
       Debit: Accounts Payable (liability decreases)
       Credit: Cash (asset decreases)
   └─> Payment record created

6. (OPTIONAL) RETURN GOODS ← CRITICAL STEP
   └─> Inventory DECREASES
   └─> Supplier payable DECREASES
   └─> Accounting entry created:
       Debit: Accounts Payable
       Credit: Inventory
```

---

## 💰 EXAMPLE: COMPLETE TRANSACTION

Let's follow Rs 23,100 purchase from start to finish:

### Day 1: Create & Submit PO
```
Action: Create PO with 100 Milk @ Rs 180
Status: DRAFT
Accounting: Nothing yet
Inventory: Nothing yet
```

### Day 3: Goods Arrive
```
Action: Create Goods Receipt for 100 Milk
Status: PO becomes RECEIVED
Accounting Entry:
  Debit Inventory:         Rs 23,100 ↑
  Credit Accounts Payable: Rs 23,100 ↑
Database:
  Inventory[Milk].quantity = 100
  Batch[MILK-001] created with 100 units
  Supplier payable updated to Rs 23,100
```

**Balance Sheet Impact**:
```
BEFORE:              AFTER:
Assets: Rs 0         Assets: Inventory Rs 23,100
Liabilities: Rs 0    Liabilities: AP Rs 23,100
```

### Day 5: Pay Half
```
Action: Record payment Rs 10,000
Accounting Entry:
  Debit Accounts Payable: Rs 10,000 ↓
  Credit Cash:           Rs 10,000 ↓
Database:
  Supplier payable = Rs 13,100
  Cash decreases by Rs 10,000
```

**Balance Sheet Impact**:
```
BEFORE:              AFTER:
Assets:              Assets:
  Inventory Rs 23,100  Inventory Rs 23,100
  Cash Rs X            Cash Rs (X - 10,000)
Liabilities:         Liabilities:
  AP Rs 23,100         AP Rs 13,100
```

### Day 10: Pay Remaining
```
Action: Record payment Rs 13,100
Accounting Entry:
  Debit Accounts Payable: Rs 13,100 ↓
  Credit Cash:           Rs 13,100 ↓
Database:
  Supplier payable = Rs 0 (fully paid)
  Cash decreases by Rs 13,100
```

**Final Balance Sheet**:
```
Assets:
  Inventory Rs 23,100 (still there)
  Cash Rs (X - 23,100) (paid out)
Liabilities:
  AP Rs 0 (fully paid)
```

---

## 🔄 HOW IT CONNECTS TO OTHER MODULES

### Inventory Module
- When goods are received, **Inventory increases**
- Batches are created for tracking
- Stock movements are recorded

### POS Module
- When you sell products, **Inventory decreases** (using FEFO for batches)
- COGS is calculated from batch purchase costs
- Same products you purchased now become sales

### Accounting Module
- Every purchase creates journal entries
- Accounts Payable tracks what you owe
- Inventory account tracks stock value
- Trial balance shows balanced accounting

### Reports Module
- Purchase report shows total purchased by date
- Supplier report shows payables and transaction history
- Inventory report shows stock from purchases
- Financial reports show accounting impact

### Notifications
- Low stock alerts (if inventory falls below reorder level)
- Supplier payment due reminders

---

## ✅ SUMMARY

### Purchase Order Status Flow
```
DRAFT
  ↓ (click Submit)
PENDING
  ↓ (receive goods - GR submitted)
PARTIALLY_RECEIVED (if not all items received)
  ↓ (receive remaining)
RECEIVED (all items received)
```

### What Each Status Means

| Status | Meaning | Can Edit Items? | Inventory Updated? | AP Created? |
|--------|---------|----------------|--------------------|------------|
| DRAFT | Still planning the order | Yes ✅ | No ❌ | No ❌ |
| PENDING | Order confirmed & locked | No ❌ | No ❌ | No ❌ |
| PARTIALLY_RECEIVED | Some items received | No ❌ | Yes ✅ | Yes ✅ |
| RECEIVED | All items received | No ❌ | Yes ✅ | Yes ✅ |
| CANCELLED | Order cancelled | No ❌ | No ❌ | No ❌ |

### Key Points to Remember

1. **PO Creation ≠ Inventory Increase**
   - Creating a PO doesn't add stock
   - Only receiving goods adds stock

2. **Supplier Payment ≠ Purchase**
   - Payment is separate from purchase
   - You can receive goods, then pay later
   - Accounts Payable tracks what you owe

3. **Everything is Atomic**
   - When you submit GR or payment, everything happens together
   - If something fails, nothing is recorded

4. **Complete Audit Trail**
   - Every inventory movement is recorded
   - Every accounting entry is recorded
   - Every payment is recorded
   - Nothing is hidden or lost

---

## 🎯 QUICK REFERENCE

### To Create a Purchase:
```
1. Suppliers → Add Supplier
2. Purchase Orders → New PO → Select Supplier → Add Items
3. Purchase Orders → Submit (status: PENDING)
4. Goods Receipts → New GR → Select PO → Add batches → Submit
   (Inventory NOW increases + Accounting entries created)
5. (Optional) Payments → Pay Supplier
   (Payable decreases + Cash decreases)
```

### To Check What You Owe:
```
Finance → Accounting → Look at Accounts Payable balance
OR
Purchasing → Suppliers → Click supplier → View balance
```

### To Check Inventory from Purchase:
```
Inventory → Stock → Find product → View quantity
OR
Inventory → Batches → Find batch → View batch quantity
```

### To Check if Accounting is Correct:
```
Finance → Accounting → Trial Balance
Should show: Total Debits = Total Credits
```

---

## 🔍 DEBUGGING / CHECKING

If you want to verify everything is working:

### Check 1: After Receiving Goods
- Go to **Inventory → Stock**
- Verify quantity increased ✅
- Go to **Inventory → Batches**
- Verify batch exists ✅
- Go to **Finance → Accounting**
- Verify Journal Entry created ✅
- Trial Balance should still balance ✅

### Check 2: After Payment
- Go to **Purchasing → Suppliers**
- Click supplier, verify balance decreased ✅
- Go to **Finance → Accounting**
- Verify Journal Entry created ✅
- Cash account balance decreased ✅

### Check 3: Complete Flow
- Supplier → PO → GR → Payment created
- Inventory increased ✅
- Accounts Payable increased then decreased ✅
- Cash decreased ✅
- Trial Balance still balanced ✅
- All movements logged in audit ✅

