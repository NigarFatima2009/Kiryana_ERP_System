import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, ShoppingCart, Minus, Plus, Trash2, User, CreditCard, DollarSign, PauseCircle } from 'lucide-react';
import { holdSale, fetchHeldSales, resumeSale, cancelSale, searchProductsForPOS } from '../../services/sales';
import { fetchCustomers } from '../../services/customers';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/helpers';
import { useDebounce } from '../../hooks/useDebounce';
import { PaymentModal } from './PaymentModal';
import { CustomerSelectModal } from './CustomerSelectModal';
import { HeldSalesModal } from './HeldSalesModal';
import type { CartItem, Product, Customer } from '../../types/database';

export function POSPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounce(searchQuery, 400);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [discount, setDiscount] = useState(0);
  const [showPayment, setShowPayment] = useState(false);
  const [showHeldSales, setShowHeldSales] = useState(false);
  const [showCustomerSelect, setShowCustomerSelect] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Search products - debounced
  const { data: searchResults = [], isLoading } = useQuery({
    queryKey: ['pos-products', debouncedQuery],
    queryFn: () => searchProductsForPOS(debouncedQuery || ' '),
    enabled: true,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
  });

  // Load customers only once
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => fetchCustomers({}).then((r) => r.data),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  // Load held sales only when modal opens
  const { data: heldSales = [] } = useQuery({
    queryKey: ['held-sales'],
    queryFn: fetchHeldSales,
    enabled: showHeldSales,
    staleTime: 1000 * 30,
  });

  // Memoize calculations
  const { subtotal, totalTax, total } = useMemo(() => {
    const sub = cart.reduce((s, i) => s + i.line_total, 0);
    const tax = cart.reduce((s, i) => s + i.tax_amount * i.quantity, 0);
    const tot = sub - discount + tax;
    return { subtotal: sub, totalTax: tax, total: tot };
  }, [cart, discount]);

  // Memoize callbacks
  const addToCart = useCallback((product: Product & { stock: number }) => {
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
      return [
        ...prev,
        {
          product,
          quantity: 1,
          unit_price: Number(product.selling_price),
          discount: 0,
          tax_amount: taxAmount,
          line_total: Number(product.selling_price) + taxAmount,
        },
      ];
    });
  }, [toast]);

  const updateCartQuantity = useCallback((productId: string, delta: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.product.id !== productId) return item;
        const newQty = item.quantity + delta;
        if (newQty <= 0) return item;
        if (newQty > Number((item.product as Product & { stock: number }).stock)) {
          toast('warning', `Max stock: ${(item.product as Product & { stock: number }).stock}`);
          return item;
        }
        return { ...item, quantity: newQty, line_total: newQty * item.unit_price };
      })
    );
  }, [toast]);

  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  }, []);

  const handleHold = useCallback(() => {
    if (cart.length === 0) {
      toast('warning', 'Cart is empty');
      return;
    }
    holdSaleMutation.mutate({ cart, discount, tax: totalTax });
  }, [cart, discount, totalTax, toast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'F4') {
        e.preventDefault();
        setShowCustomerSelect(true);
      }
      if (e.key === 'F8') {
        e.preventDefault();
        handleHold();
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (cart.length > 0) setShowPayment(true);
      }
      if (e.key === 'Escape') {
        setShowPayment(false);
        setShowCustomerSelect(false);
        setShowHeldSales(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cart, handleHold]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && searchQuery && searchResults.length === 1) {
        e.preventDefault();
        addToCart(searchResults[0]);
        setSearchQuery('');
      }
    },
    [searchQuery, searchResults, addToCart]
  );

  const holdSaleMutation = useMutation({
    mutationFn: holdSale,
    onSuccess: () => {
      setCart([]);
      setDiscount(0);
      setSelectedCustomer('');
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
          <button
            onClick={() => setShowHeldSales(true)}
            className="btn-secondary"
          >
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
                  <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                    <ShoppingCart size={20} />
                  </div>
                  <p className="text-sm font-medium text-gray-900 line-clamp-2">{p.name}</p>
                  <p className="mt-1 text-xs text-gray-500">SKU: {p.sku}</p>
                  {p.categories && (
                    <p className="mt-0.5 text-xs text-gray-400">
                      {(p.categories as { name: string })?.name}
                    </p>
                  )}
                  <p className="mt-1 text-lg font-bold text-blue-600">
                    {formatCurrency(Number(p.selling_price))}
                  </p>
                  <p
                    className={`text-xs font-medium ${
                      p.stock <= 0 ? 'text-red-600' : 'text-green-600'
                    }`}
                  >
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
            <button
              onClick={() => setCart([])}
              className="text-sm text-red-500 hover:text-red-700"
            >
              Clear All
            </button>
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
                <CartItemRow
                  key={item.product.id}
                  item={item}
                  onUpdateQuantity={updateCartQuantity}
                  onRemove={removeFromCart}
                />
              ))}
            </div>
          )}
        </div>

        {/* Discount & Totals */}
        <div className="border-t border-gray-200 bg-white p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-semibold text-gray-700 flex-shrink-0 whitespace-nowrap">
              Discount:
            </label>
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
              <span className="font-semibold text-gray-900">
                {formatCurrency(subtotal)}
              </span>
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
              <span className="text-base font-bold text-blue-600">
                {formatCurrency(total)}
              </span>
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
          customers={customers}
          onClose={() => setShowPayment(false)}
          onSuccess={() => {
            setCart([]);
            setDiscount(0);
            setSelectedCustomer('');
            setShowPayment(false);
          }}
        />
      )}

      {/* Customer Selection Modal */}
      {showCustomerSelect && (
        <CustomerSelectModal
          customers={customers}
          onSelect={(id) => {
            setSelectedCustomer(id);
            setShowCustomerSelect(false);
          }}
          onClose={() => setShowCustomerSelect(false)}
        />
      )}

      {/* Held Sales Modal */}
      {showHeldSales && (
        <HeldSalesModal
          heldSales={heldSales}
          onResume={(saleId) => resumeMutation.mutate(saleId)}
          onClose={() => setShowHeldSales(false)}
        />
      )}
    </div>
  );
}

// Memoized cart item row component
const CartItemRow = memo(function CartItemRow({
  item,
  onUpdateQuantity,
  onRemove,
}: {
  item: CartItem;
  onUpdateQuantity: (productId: string, delta: number) => void;
  onRemove: (productId: string) => void;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-2.5 hover:shadow-sm transition-shadow">
      {/* Row 1: Name + Delete + Price */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {item.product.name}
          </p>
          <p className="text-xs text-gray-500">{item.product.sku}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold text-blue-600">
            {formatCurrency(item.unit_price)}
          </p>
        </div>
        <button
          onClick={() => onRemove(item.product.id)}
          className="p-1 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Row 2: Qty Controls + Total */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-300 rounded">
          <button
            onClick={() => onUpdateQuantity(item.product.id, -1)}
            className="p-0.5 hover:bg-gray-200 transition-colors"
          >
            <Minus size={12} className="text-gray-600" />
          </button>
          <span className="w-6 text-center text-xs font-bold text-gray-900">
            {item.quantity}
          </span>
          <button
            onClick={() => onUpdateQuantity(item.product.id, 1)}
            className="p-0.5 hover:bg-gray-200 transition-colors"
          >
            <Plus size={12} className="text-gray-600" />
          </button>
        </div>
        <span className="text-xs text-gray-600">×</span>
        <span className="text-xs font-medium text-gray-700 flex-1">
          {formatCurrency(item.unit_price)}
        </span>
        <span className="text-sm font-bold text-green-600 flex-shrink-0">
          {formatCurrency(item.line_total)}
        </span>
      </div>
    </div>
  );
});
