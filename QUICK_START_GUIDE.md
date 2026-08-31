# Kiryana ERP - Quick Start Guide

Simple step-by-step guide to get started with the ERP system.

---

## 🚀 LOGIN

**Email**: `owner@erp.local` (or the email you created)
**Password**: `password123`

After login, you'll see the Dashboard with all menu options.

---

## 📌 MODULE OVERVIEW

### Purchasing Module (What You Asked About)

```
┌─────────────────────────────────────────────────────────────┐
│                    PURCHASING                               │
├─────────────────────────────────────────────────────────────┤
│ 1. SUPPLIERS        → Add companies you buy from            │
│ 2. PURCHASE ORDERS  → Create orders for suppliers           │
│ 3. GOODS RECEIPTS   → Confirm goods arrival + increase inv  │
│ 4. PURCHASE RETURNS → Return damaged goods                  │
└─────────────────────────────────────────────────────────────┘
```

### Other Main Modules

```
SALES (POS)
├─ POS               → Sell products to customers
├─ Sales History     → View past sales
└─ Returns           → Handle customer returns

PRODUCTS
├─ Products          → Manage product catalog
├─ Categories        → Organize products
└─ Brands            → Product brands

INVENTORY
├─ Stock             → View current inventory
├─ Stock Movements   → See what changed and why
├─ Batches           → Track product batches & expiry dates
└─ Expiry            → Alert on expiring products

CUSTOMERS
├─ Customers         → Customer list
└─ Khata             → Customer credit/ledger

FINANCE
├─ Payments          → Pay suppliers & customers
├─ Expenses          → Record expenses
└─ Accounting        → View journal entries & reports

REPORTS
└─ Various reports for analysis
```

---

## 📝 STEP-BY-STEP: Buy Goods from Supplier

### Step 1: Add a Supplier

1. Click **Purchasing → Suppliers**
2. Click **+ New Supplier**
3. Fill in:
   - **Name**: ABC Traders
   - **Phone**: 021-2345678
   - **Email**: sales@abc.com
   - **Address**: Karachi
   - **Credit Limit**: 500,000 (max you can buy on credit)
4. Click **Save**

✅ Supplier added. No accounting impact yet.

---

### Step 2: Create a Purchase Order (PO)

1. Click **Purchasing → Purchase Orders**
2. Click **+ New PO**
3. Fill in:
   - **Supplier**: Select "ABC Traders"
   - **Order Date**: Today
4. Click **Add Item**
   - **Product**: Milk 1L
   - **Quantity**: 100
   - **Unit Cost**: 180
   - Click **Add**
5. Click **Save**

✅ PO created with status **DRAFT**

**⚠️ Important**: 
- Inventory is NOT updated yet
- You haven't sent this to supplier yet
- Just a draft/plan

---

### Step 3: Submit Purchase Order

1. From **Purchase Orders** list, find your PO
2. Click **Submit** button
3. Status changes from **DRAFT** → **PENDING**

✅ PO submitted

**What this means**:
- Order is now locked/confirmed
- Ready to send to supplier
- Can't edit items anymore
- Still NO inventory or accounting impact

---

### Step 4: Receive Goods (THIS IS THE CRITICAL STEP!)

1. Click **Purchasing → Goods Receipts**
2. Click **+ New Receipt**
3. Fill in:
   - **Purchase Order**: Select your PO
   - **Received Date**: Today
4. Click **Add Item**
   - **Product**: Milk 1L
   - **Batch Number**: MILK-001
   - **Expiry Date**: 30 Sept 2026
   - **Quantity**: 100
   - **Unit Cost**: 180
   - Click **Add**
5. Click **Submit**

✅ Goods Received!

**🔥 NOW THIS IS IMPORTANT - When you click Submit**:

An **automatic** function runs that does ALL of these together:

```
✅ Inventory increases: Milk 1L qty = 100
✅ Batch created: BATCH-MILK-001 with 100 units
✅ Accounting entries created:
   Debit:  Inventory Account         Rs 18,000 ↑
   Credit: Accounts Payable (AP)     Rs 18,000 ↑
✅ PO status: PENDING → RECEIVED
✅ Supplier balance updated: You now owe Rs 18,000
```

**Check your work**:
- Go to **Inventory → Stock**
- Find Milk 1L
- See quantity = 100 ✅
- Go to **Finance → Accounting**
- Look for Journal Entry for this purchase ✅

---

### Step 5: Pay the Supplier

Now you have Rs 18,000 of milk in inventory, but you owe the supplier Rs 18,000.

**Option A: Pay Full Amount Now**

1. Click **Finance → Payments** (or **Purchasing → Suppliers → Click supplier → Pay**)
2. Click **+ Pay Supplier**
3. Fill in:
   - **Supplier**: ABC Traders
   - **Amount**: 18,000
   - **Payment Method**: Bank Transfer (or Cash)
   - **Date**: Today
4. Click **Submit**

✅ Payment recorded!

**When you click Submit, this happens automatically**:

```
✅ Supplier balance decreases: 18,000 → 0
✅ Cash decreases: -18,000
✅ Accounting entries created:
   Debit:  Accounts Payable          Rs 18,000 ↓
   Credit: Cash Account             Rs 18,000 ↓
```

**Option B: Pay Later (Partial)**

1. Pay Rs 10,000 now
2. Pay remaining Rs 8,000 after 2 weeks

Each payment will update:
- Supplier balance
- Cash account
- Accounting entries

---

## 📊 CHECKING YOUR WORK

### Check 1: Inventory
- **Path**: Inventory → Stock → Find "Milk 1L"
- **Should show**: Quantity = 100

### Check 2: Supplier Balance
- **Path**: Purchasing → Suppliers → Click "ABC Traders"
- **Should show**: Outstanding balance (0 if fully paid, or remaining if partial)

### Check 3: Cash Account
- **Path**: Finance → Accounting → View "Cash" account
- **Should show**: Decreased by payment amount

### Check 4: Trial Balance
- **Path**: Finance → Accounting → Trial Balance
- **Should show**: Total Debits = Total Credits (always balanced!)

### Check 5: Audit Trail
- **Path**: Settings → Audit Logs
- **Should show**: All transactions recorded with who did what and when

---

## 🛒 NEXT: Sell the Goods

Once you have inventory, you can sell!

### Simple POS Sale

1. Click **Sales → POS**
2. Search for "Milk 1L"
3. Click product to add to cart
4. Enter quantity: 5
5. Click **Payment (F9)**
6. Choose payment method: Cash
7. Click **Complete Sale**

✅ Sale completed!

**What happens automatically**:
```
✅ Inventory decreases: 100 → 95 units
✅ Batch quantity decreases: 100 → 95 units
✅ Accounting entries created:
   Debit:  Cash                  Rs 1,100 ↑
   Credit: Sales Revenue         Rs 1,100 ↑
   (Plus COGS entry)
✅ Customer Khata updated (if credit sale)
✅ Profit calculated: Revenue - COGS
```

---

## 💡 KEY CONCEPTS

### What is "Status"?

Think of Purchase Order status like an order ticket:

```
DRAFT
  └─ Like: Pencil sketch, not final
  └─ You can change anything
  └─ Not committed

PENDING
  └─ Like: Order sent to kitchen
  └─ It's locked, can't change
  └─ Waiting for fulfillment

PARTIALLY_RECEIVED
  └─ Like: Cook made half the order
  └─ Some items arrived, some pending
  └─ Inventory increased for received items

RECEIVED
  └─ Like: Order complete
  └─ All items received
  └─ Status is final
```

### What is "Accounts Payable"?

**Accounts Payable (AP)** = "Money we owe to suppliers"

```
When you RECEIVE goods:
  AP increases (you now owe money)
  
When you PAY supplier:
  AP decreases (you owe less)
  
When you RETURN goods:
  AP decreases (you owe less)
```

**Check AP Balance**:
- Go to **Finance → Accounting**
- Look at "Accounts Payable" account
- Shows total you owe all suppliers

### What is "COGS"?

**COGS = Cost of Goods Sold**

When you buy milk for Rs 180 and sell for Rs 220:
```
Profit = Rs 220 - Rs 180 = Rs 40

COGS (in accounting) = Rs 180
Revenue (in accounting) = Rs 220
```

---

## ⚡ QUICK REFERENCE

### What Updates Automatically?

| Action | Inventory | AP | Cash | Profit |
|--------|-----------|----|----|--------|
| Create PO | ❌ | ❌ | ❌ | ❌ |
| Submit PO | ❌ | ❌ | ❌ | ❌ |
| Receive Goods | ✅ | ✅ | ❌ | ❌ |
| Pay Supplier | ❌ | ✅ | ✅ | ❌ |
| POS Sale | ✅ | ❌ | ✅ | ✅ |

### Status Flow

```
Purchase Order:    DRAFT → PENDING → RECEIVED/PARTIALLY_RECEIVED
Accounting Impact: None → None → Full (on goods receipt)
```

---

## 🎯 COMMON QUESTIONS

### Q: Why doesn't inventory increase when I create a PO?

**A**: Because you haven't actually received the goods yet! PO is just a promise to buy. Inventory increases when goods physically arrive and you confirm receipt.

### Q: When do I pay the supplier?

**A**: Anytime! You can:
- Pay immediately after receiving
- Pay after 1 week
- Pay in installments
- Each payment reduces what you owe

### Q: What if goods arrive damaged?

**A**: Use **Purchase Returns** to return them. This:
- Decreases inventory
- Decreases what you owe supplier
- Updates accounting automatically

### Q: How do I know if accounting is correct?

**A**: Go to **Finance → Accounting → Trial Balance**

Should show: **Total Debits = Total Credits**

If not balanced, something went wrong (should never happen in this system).

### Q: Can I delete a PO after submitting?

**A**: No. Historical records should never be deleted. Instead, mark as CANCELLED if you change your mind.

---

## 🚦 READY TO START?

1. ✅ Login with `owner@erp.local`
2. ✅ Go to **Purchasing → Suppliers**
3. ✅ Add your first supplier
4. ✅ Create a Purchase Order
5. ✅ Submit it
6. ✅ Receive goods
7. ✅ Check inventory increased
8. ✅ Pay supplier
9. ✅ Check trial balance

You now understand how the entire purchasing module works! 🎉

---

## 📚 NEXT TOPICS

Once comfortable with Purchasing, explore:

1. **POS/Sales Module** - How to use the cash register
2. **Accounting Module** - Understand journal entries
3. **Reports Module** - Run business analytics
4. **Inventory Module** - Track stock and batches
5. **Customers Module** - Manage customer credit (Khata)

See `WORKFLOWS.md` for detailed explanations of all modules.
