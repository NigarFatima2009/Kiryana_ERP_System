import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, ShoppingCart, Minus, Plus, Trash2, User, CreditCard, DollarSign, PauseCircle, X } from 'lucide-react';
import { searchProductsForPOS, completeSale, holdSale, fetchHeldSales, resumeSale, cancelSale } from '../../services/sales';
import { fetchCustomers } from '../../services/customers';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/helpers';
import type { CartItem, Product, PaymentEntry, Customer } from '../../types/database';

export function POSPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [discount, setDiscount] = useState(0);
  const [showPayment, setShowPayment] = useState(false);
  const [showHeldSales, setShowHeldSales] = useState(false);
  const [showCustomerSelect, setShowCustomerSelect] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Search products - show all when empty, search when typed
  const { data: searchResults = [], isLoading } = useQuery({
    queryKey: ['pos-products', searchQuery],
    queryFn: () => searchProductsForPOS(searchQuery || ' '),
    enabled: true, // Always enabled
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => fetchCustomers({}).then((r) => r.data),
  });

  const { data: heldSales = [] } = useQuery({
    queryKey: ['held-sales'],
    queryFn: fetchHeldSales,
    enabled: showHeldSales,
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F4') { e.preventDefault(); setShowCustomerSelect(true); }
      if (e.key === 'F8') { e.preventDefault(); handleHold(); }
      if (e.key === 'F9') { e.preventDefault(); if (cart.length > 0) setShowPayment(true); }
      if (e.key === 'Escape') { setShowPayment(false); setShowCustomerSelect(false); setShowHeldSales(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cart]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery && searchResults.length === 1) {
      e.preventDefault();
      addToCart(searchResults[0]);
      setSearchQuery('');
    }
  };

  const addToCart = (product: Product & { stock: number }) => {
    if (product.stock <= 0) {
      toast('error', `${product.name} is out of stock`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          toast('warning', `Only ${product.stock} units available`);
          return prev;
        }
        return prev.map((i) =>
          i.product.id === product.id
            ? { ...i, quantity: i.quantity + 1, line_total: (i.quantity + 1) * i.unit_price }
            : i
        );
      }
      const taxAmount = Number(product.selling_price) * (Number(product.tax_rate) / 100);
      return [...prev, {
        product,
        quantity: 1,
        unit_price: Number(product.selling_price),
        discount: 0,
        tax_amount: taxAmount,
        line_total: Number(product.selling_price) + taxAmount,
      }];
    });
  };

  const updateCartQuantity = (productId: string, delta: number) => {
    setCart((prev) => prev.map((item) => {
      if (item.product.id !== productId) return item;
      const newQty = item.quantity + delta;
      if (newQty <= 0) return item;
      if (newQty > Number((item.product as Product & { stock: number }).stock)) {
        toast('warning', `Max stock: ${(item.product as Product & { stock: number }).stock}`);
        return item;
      }
      return { ...item, quantity: newQty, line_total: newQty * item.unit_price };
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  };

  const subtotal = cart.reduce((s, i) => s + i.line_total, 0);
  const totalTax = cart.reduce((s, i) => s + i.tax_amount * i.quantity, 0);
  const total = subtotal - discount + totalTax;

  const handleHold = () => {
    if (cart.length === 0) { toast('warning', 'Cart is empty'); return; }
    holdSaleMutation.mutate({ cart, discount, tax: totalTax });
  };

  const holdSaleMutation = useMutation({
    mutationFn: holdSale,
    onSuccess: () => {
      setCart([]); setDiscount(0); setSelectedCustomer('');
      queryClient.invalidateQueries({ queryKey: ['held-sales'] });
      toast('success', 'Sale held');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const resumeMutation = useMutation({
    mutationFn: async (saleId: string) => {
      const sale = await resumeSale(saleId);
      await cancelSale(saleId);
      return sale;
    },
    onSuccess: (sale) => {
      const items: CartItem[] = (sale.sale_items || []).map((si: Record<string, unknown>) => {
        const p = si.products as Product;
        const taxAmount = Number(si.unit_price) * (Number(p.tax_rate || 0) / 100);
        return {
          product: p,
          quantity: Number(si.quantity),
          unit_price: Number(si.unit_price),
          discount: Number(si.discount || 0),
          tax_amount: taxAmount,
          line_total: Number(si.line_total),
        };
      });
      setCart(items);
      if (sale.customer_id) setSelectedCustomer(sale.customer_id);
      setShowHeldSales(false);
      queryClient.invalidateQueries({ queryKey: ['held-sales'] });
    },
  });

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Left: Product Search & Results */}
      <div className="flex flex-1 flex-col">
        {/* Search bar */}
        <div className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search product name, SKU, or scan barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="input-field pl-10 text-lg py-3"
              autoFocus
            />
          </div>
          <button onClick={() => setShowHeldSales(true)} className="btn-secondary">
            <PauseCircle className="mr-2 h-4 w-4" /> Held Sales
          </button>
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : searchResults.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
              {searchResults.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  disabled={p.stock <= 0}
                  className="card flex flex-col items-center p-3 text-center transition-transform hover:scale-[1.02] hover:shadow-md disabled:opacity-40 cursor-pointer border border-gray-200"
                >
                  <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <ShoppingCart size={20} />
                  </div>
                  <p className="text-sm font-medium text-gray-900 line-clamp-2">{p.name}</p>
                  <p className="mt-1 text-xs text-gray-500">SKU: {p.sku}</p>
                  {p.categories && (
                    <p className="mt-0.5 text-xs text-gray-400">{(p.categories as { name: string })?.name}</p>
                  )}
                  <p className="mt-1 text-lg font-bold text-blue-600">{formatCurrency(Number(p.selling_price))}</p>
                  <p className={`text-xs font-medium ${p.stock <= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    Stock: {p.stock}
                  </p>
                </button>
              ))}
            </div>
          ) : searchQuery ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <Search className="mb-3 h-12 w-12 text-gray-300" />
              <p>No products found for "{searchQuery}"</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <ShoppingCart className="mb-3 h-16 w-16 text-gray-300" />
              <p className="text-lg">Type in the search bar to find products</p>
              <p className="text-sm">Or browse all products below</p>
            </div>
          )}
        </div>
      </div>

      {/* Right: Cart */}
      <div className="flex w-96 flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
        {/* Cart header */}
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-gray-600" />
            <span className="font-semibold">Cart ({cart.length})</span>
          </div>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-sm text-red-500 hover:text-red-700">Clear All</button>
          )}
        </div>

        {/* Customer selection */}
        <div className="border-b border-gray-200 p-3">
          <button
            onClick={() => setShowCustomerSelect(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 p-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <User size={16} />
            {selectedCustomer
              ? customers.find((c) => c.id === selectedCustomer)?.name || 'Customer'
              : 'Select Customer (F4)'}
          </button>
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto p-2">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">Cart is empty</div>
          ) : (
            <div className="space-y-2">
              {cart.map((item) => (
                <div key={item.product.id} className="rounded-md border border-gray-200 bg-white p-2.5 hover:shadow-sm transition-shadow">
                  {/* Row 1: Name + Delete + Price */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{item.product.name}</p>
                      <p className="text-xs text-gray-500">{item.product.sku}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-blue-600">{formatCurrency(item.unit_price)}</p>
                    </div>
                    <button onClick={() => removeFromCart(item.product.id)} className="p-1 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  
                  {/* Row 2: Qty Controls + Total */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 bg-gray-50 border border-gray-300 rounded">
                      <button 
                        onClick={() => updateCartQuantity(item.product.id, -1)} 
                        className="p-0.5 hover:bg-gray-200 transition-colors"
                      >
                        <Minus size={12} className="text-gray-600" />
                      </button>
                      <span className="w-6 text-center text-xs font-bold text-gray-900">{item.quantity}</span>
                      <button 
                        onClick={() => updateCartQuantity(item.product.id, 1)} 
                        className="p-0.5 hover:bg-gray-200 transition-colors"
                      >
                        <Plus size={12} className="text-gray-600" />
                      </button>
                    </div>
                    <span className="text-xs text-gray-600">×</span>
                    <span className="text-xs font-medium text-gray-700 flex-1">{formatCurrency(item.unit_price)}</span>
                    <span className="text-sm font-bold text-green-600 flex-shrink-0">{formatCurrency(item.line_total)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Discount & Totals */}
        <div className="border-t border-gray-200 bg-white p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-semibold text-gray-700 flex-shrink-0 whitespace-nowrap">Discount:</label>
            <input
              type="number"
              value={discount || ''}
              onChange={(e) => setDiscount(Number(e.target.value))}
              className="input-field flex-1 text-xs py-0.5"
              min="0"
              step="0.01"
              placeholder="0"
            />
          </div>

          {/* Summary */}
          <div className="space-y-0.5 bg-gray-50 rounded p-1.5 border border-gray-200">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-700">Subtotal:</span>
              <span className="font-semibold text-gray-900">{formatCurrency(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between items-center text-xs text-red-600">
                <span>Discount:</span>
                <span className="font-semibold">-{formatCurrency(discount)}</span>
              </div>
            )}
            {totalTax > 0 && (
              <div className="flex justify-between items-center text-xs text-blue-600">
                <span>Tax:</span>
                <span className="font-semibold">+{formatCurrency(totalTax)}</span>
              </div>
            )}
            <div className="border-t border-gray-300 pt-0.5 mt-0.5 flex justify-between items-center">
              <span className="text-xs font-bold text-gray-900">TOTAL:</span>
              <span className="text-base font-bold text-blue-600">{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="border-t border-gray-200 p-1.5 space-y-1 bg-white">
          <button
            onClick={() => cart.length > 0 && setShowPayment(true)}
            disabled={cart.length === 0}
            className="btn-primary w-full py-1.5 text-xs font-semibold rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            <CreditCard size={14} /> Payment (F9)
          </button>
          <button
            onClick={handleHold}
            disabled={cart.length === 0}
            className="btn-secondary w-full py-1 text-xs font-medium rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            <PauseCircle size={13} /> Hold (F8)
          </button>
        </div>
      </div>

      {/* Payment Modal */}
      {showPayment && (
        <PaymentModal
          total={total}
          customerId={selectedCustomer}
          cart={cart}
          discount={discount}
          tax={totalTax}
          onClose={() => setShowPayment(false)}
          onSuccess={() => {
            setCart([]); setDiscount(0); setSelectedCustomer('');
            setShowPayment(false);
          }}
        />
      )}

      {/* Customer Selection Modal */}
      {showCustomerSelect && (
        <CustomerSelectModal
          customers={customers}
          onSelect={(id) => { setSelectedCustomer(id); setShowCustomerSelect(false); }}
          onClose={() => setShowCustomerSelect(false)}
        />
      )}

      {/* Held Sales Modal */}
      {showHeldSales && (
        <Modal isOpen={true} onClose={() => setShowHeldSales(false)} title="Held Sales" size="md">
          {heldSales.length === 0 ? (
            <p className="py-8 text-center text-gray-500">No held sales</p>
          ) : (
            <div className="space-y-2">
              {heldSales.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{s.invoice_number}</p>
                    <p className="text-xs text-gray-500">{formatCurrency(Number(s.total))} • {s.customers?.name || 'Walk-in'}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => resumeMutation.mutate(s.id)} className="btn-primary text-xs py-1">Resume</button>
                    <button onClick={() => { cancelSale(s.id).then(() => queryClient.invalidateQueries({ queryKey: ['held-sales'] })); }} className="btn-danger text-xs py-1">Cancel</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// Customer Selection Modal
function CustomerSelectModal({ customers, onSelect, onClose }: { customers: Customer[]; onSelect: (id: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search)
  );

  return (
    <Modal isOpen={true} onClose={onClose} title="Select Customer" size="md">
      <input
        type="text"
        placeholder="Search customer..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input-field mb-3"
        autoFocus
      />
      <div className="max-h-60 overflow-y-auto space-y-1">
        <button onClick={() => onSelect('')} className="w-full rounded-lg p-2 text-left text-sm hover:bg-gray-50 text-gray-500">Walk-in Customer</button>
        {filtered.map((c) => (
          <button key={c.id} onClick={() => onSelect(c.id)} className="w-full rounded-lg p-2 text-left text-sm hover:bg-gray-50">
            <span className="font-medium">{c.name}</span> — {c.phone || 'No phone'}
          </button>
        ))}
      </div>
    </Modal>
  );
}

// Payment Modal
function PaymentModal({ total, customerId, cart, discount, tax, onClose, onSuccess }: {
  total: number; customerId: string; cart: CartItem[]; discount: number; tax: number;
  onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [payments, setPayments] = useState<PaymentEntry[]>([{ method: 'CASH', amount: total }]);

  useEffect(() => {
    setPayments([{ method: 'CASH', amount: total }]);
  }, [total]);

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - totalPaid;

  const addPayment = () => setPayments([...payments, { method: 'CASH', amount: Math.max(0, remaining) }]);
  const removePayment = (idx: number) => setPayments(payments.filter((_, i) => i !== idx));
  const updatePayment = (idx: number, field: string, value: string | number) => {
    const newPayments = [...payments];
    (newPayments[idx] as unknown as Record<string, unknown>)[field] = value;
    setPayments(newPayments);
  };

  const saleMutation = useMutation({
    mutationFn: () => completeSale({ customer_id: customerId || undefined, cart, discount, tax, payments }),
    onSuccess: async () => {
      // Invalidate ALL queries to force refetch on next access
      queryClient.invalidateQueries();
      toast('success', 'Sale completed!');
      onSuccess();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal isOpen={true} onClose={onClose} title="Payment" size="md"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => saleMutation.mutate()} className="btn-success w-40" disabled={Math.abs(totalPaid - total) > 0.01 || saleMutation.isPending}>
          {saleMutation.isPending ? 'Processing...' : 'Complete Sale'}
        </button></>}>
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-sm text-gray-500">Total Amount</p>
          <p className="text-3xl font-bold text-gray-900">{formatCurrency(total)}</p>
        </div>

        <div className="space-y-3">
          {payments.map((p, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select value={p.method} onChange={(e) => updatePayment(idx, 'method', e.target.value)} className="select-field w-40">
                <option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="EASYPAISA">Easypaisa</option><option value="JAZZCASH">JazzCash</option>
                <option value="CUSTOMER_CREDIT">Khata (Credit)</option>
              </select>
              <input type="number" value={p.amount || ''} onChange={(e) => updatePayment(idx, 'amount', Number(e.target.value))} className="input-field flex-1" min="0" step="0.01" />
              {payments.length > 1 && (
                <button onClick={() => removePayment(idx)} className="rounded p-1 text-red-400 hover:bg-red-50"><X size={16} /></button>
              )}
            </div>
          ))}
        </div>

        {remaining > 0.01 && (
          <p className="text-center text-sm text-orange-600">Remaining: {formatCurrency(remaining)}</p>
        )}
        {remaining < -0.01 && (
          <p className="text-center text-sm text-green-600">Change: {formatCurrency(Math.abs(remaining))}</p>
        )}

        <button onClick={addPayment} className="btn-secondary w-full text-sm">+ Add Payment Method</button>
      </div>
    </Modal>
  );
}
