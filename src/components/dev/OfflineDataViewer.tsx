/**
 * Development Component: Displays IndexedDB offline data on the frontend
 * Shows products, inventory, customers, and pending sales stored locally
 * Now with sidebar icon + slide-out panel design + SMOOTH DRAGGABLE
 */

import { useEffect, useState, useRef } from 'react';
import { Database, ChevronDown, ChevronRight, Trash2, X } from 'lucide-react';
import { getOfflineDB } from '../../lib/offline/db';
import type { OfflineProduct, OfflineInventory, OfflineCustomer, OfflineSale } from '../../lib/offline/types';

type DataSection = 'products' | 'inventory' | 'customers' | 'sales' | 'none';

export function OfflineDataViewer() {
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState<DataSection>('none');
  const [isDragging, setIsDragging] = useState(false);

  // Refs for drag — no React re-renders during drag
  const positionRef = useRef({ x: window.innerWidth - 76, y: 80 });
  const startPosRef = useRef({ x: 0, y: 0 });
  const startMouseRef = useRef({ x: 0, y: 0 });
  const didDragRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Snap to right edge on first render
  const [initialized, setInitialized] = useState(false);

  const [products, setProducts] = useState<OfflineProduct[]>([]);
  const [inventory, setInventory] = useState<OfflineInventory[]>([]);
  const [customers, setCustomers] = useState<OfflineCustomer[]>([]);
  const [sales, setSales] = useState<OfflineSale[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const db = getOfflineDB();
      const [prods, invs, custs, salesData] = await Promise.all([
        db.products.toArray(),
        db.inventory.toArray(),
        db.customers.toArray(),
        db.offlineSales.toArray(),
      ]);
      setProducts(prods);
      setInventory(invs);
      setCustomers(custs);
      setSales(salesData);
    } catch (error) {
      console.error('[OfflineDataViewer] Failed to load data:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen && expanded === 'none') {
      loadData();
      setExpanded('products');
    }
  }, [isOpen]);

  // ---- Smooth drag using refs + direct DOM manipulation ----
  const handleMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;

    didDragRef.current = false;
    setIsDragging(true);

    startMouseRef.current = { x: e.clientX, y: e.clientY };
    startPosRef.current = { x: positionRef.current.x, y: positionRef.current.y };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      didDragRef.current = true;

      // Calculate delta from initial mouse position
      const deltaX = e.clientX - startMouseRef.current.x;
      const deltaY = e.clientY - startMouseRef.current.y;

      // Apply delta to starting position
      let newX = startPosRef.current.x + deltaX;
      let newY = startPosRef.current.y + deltaY;

      // Clamp to window bounds (accounting for 56px button size)
      const maxX = window.innerWidth - 56;
      const maxY = window.innerHeight - 56;

      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      positionRef.current = { x: newX, y: newY };

      // Direct DOM update — zero React re-renders
      if (buttonRef.current) {
        buttonRef.current.style.transform = `translate(${newX}px, ${newY}px)`;
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const clearAll = async () => {
    if (confirm('Clear all offline data? This cannot be undone.')) {
      try {
        const db = getOfflineDB();
        await db.clearCacheTables();
        setProducts([]);
        setInventory([]);
        setCustomers([]);
        setSales([]);
        alert('Cache cleared!');
      } catch (error) {
        console.error('Failed to clear cache:', error);
      }
    }
  };

  return (
    <>
      {/* Draggable Icon Button */}
      <button
        ref={buttonRef}
        onMouseDown={handleMouseDown}
        onClick={() => {
          // Only toggle panel if user didn't actually drag
          if (!didDragRef.current) setIsOpen(!isOpen);
        }}
        className={`fixed z-40 w-14 h-14 rounded-full shadow-lg transition-[transform,box-shadow] duration-150 flex items-center justify-center cursor-grab active:cursor-grabbing ${
          isDragging ? 'shadow-2xl scale-110' : ''
        } ${
          isOpen
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
        style={{
          left: '0',
          top: '0',
          transform: `translate(${positionRef.current.x}px, ${positionRef.current.y}px)`,
          userSelect: 'none',
          willChange: isDragging ? 'transform' : 'auto',
        }}
        title="Offline Data Store (drag to move)"
      >
        <Database className="h-6 w-6" />
      </button>

      {/* Slide-out Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-30 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Slide Panel */}
          <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right">
            {/* Header */}
            <div className="flex items-center justify-between p-4 bg-blue-600 text-white border-b">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                <span className="font-semibold">Offline Data Store</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-blue-700 rounded transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loading && <div className="text-center text-gray-500 py-8">Loading...</div>}

              {/* Products Section */}
              <Section
                title="Products"
                count={products.length}
                isOpen={expanded === 'products'}
                onClick={() => setExpanded(expanded === 'products' ? 'none' : 'products')}
              >
                {products.length === 0 ? (
                  <div className="text-sm text-gray-500">No products cached</div>
                ) : (
                  <div className="space-y-2">
                    {products.slice(0, 5).map(prod => (
                      <div key={prod.id} className="text-sm p-2 bg-gray-50 rounded">
                        <div className="font-medium">{prod.name}</div>
                        <div className="text-xs text-gray-600">
                          SKU: {prod.sku} | Price: Rs {prod.selling_price}
                        </div>
                      </div>
                    ))}
                    {products.length > 5 && (
                      <div className="text-xs text-gray-500 italic">
                        +{products.length - 5} more...
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {/* Inventory Section */}
              <Section
                title="Inventory"
                count={inventory.length}
                isOpen={expanded === 'inventory'}
                onClick={() => setExpanded(expanded === 'inventory' ? 'none' : 'inventory')}
              >
                {inventory.length === 0 ? (
                  <div className="text-sm text-gray-500">No inventory cached</div>
                ) : (
                  <div className="space-y-2">
                    {inventory.slice(0, 5).map(inv => (
                      <div key={inv.product_id} className="text-sm p-2 bg-gray-50 rounded">
                        <div className="font-medium">Product: {inv.product_id.slice(0, 8)}...</div>
                        <div className="text-xs text-gray-600">
                          Qty: {inv.quantity} | Avg Cost: Rs {inv.average_cost}
                        </div>
                      </div>
                    ))}
                    {inventory.length > 5 && (
                      <div className="text-xs text-gray-500 italic">
                        +{inventory.length - 5} more...
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {/* Customers Section */}
              <Section
                title="Customers"
                count={customers.length}
                isOpen={expanded === 'customers'}
                onClick={() => setExpanded(expanded === 'customers' ? 'none' : 'customers')}
              >
                {customers.length === 0 ? (
                  <div className="text-sm text-gray-500">No customers cached</div>
                ) : (
                  <div className="space-y-2">
                    {customers.slice(0, 5).map(cust => (
                      <div key={cust.id} className="text-sm p-2 bg-gray-50 rounded">
                        <div className="font-medium">{cust.name}</div>
                        <div className="text-xs text-gray-600">
                          Phone: {cust.phone || 'N/A'} | Credit: Rs {cust.credit_limit}
                        </div>
                      </div>
                    ))}
                    {customers.length > 5 && (
                      <div className="text-xs text-gray-500 italic">
                        +{customers.length - 5} more...
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {/* Sales Section - Show all sales with status indicators */}
              <Section
                title="All Sales"
                count={sales.length}
                isOpen={expanded === 'sales'}
                onClick={() => setExpanded(expanded === 'sales' ? 'none' : 'sales')}
              >
                {sales.length === 0 ? (
                  <div className="text-sm text-gray-500">No sales</div>
                ) : (
                  <div className="space-y-2">
                    {/* Show pending first, then synced */}
                    {sales.filter(s => s.status !== 'synced').length > 0 && (
                      <>
                        <div className="text-xs font-bold text-yellow-700 px-2 py-1 bg-yellow-50 rounded">⏳ Pending Sync</div>
                        {sales.filter(s => s.status !== 'synced').slice(0, 3).map(sale => (
                          <div key={sale.id} className="text-sm p-2 bg-yellow-50 rounded border-l-4 border-yellow-400">
                            <div className="font-medium flex justify-between">
                              <span>{sale.invoice_number}</span>
                              <span className={`text-xs px-2 py-1 rounded font-bold ${
                                sale.status === 'pending_sync'
                                  ? 'bg-yellow-200 text-yellow-800'
                                  : sale.status === 'syncing'
                                  ? 'bg-blue-200 text-blue-800'
                                  : sale.status === 'sync_failed'
                                  ? 'bg-red-200 text-red-800'
                                  : 'bg-gray-200 text-gray-800'
                              }`}>
                                {sale.status}
                              </span>
                            </div>
                            <div className="text-xs text-gray-600 mt-1">
                              Total: Rs {sale.total} | Customer: {sale.customer_name || 'Walk-in'}
                            </div>
                          </div>
                        ))}
                        {sales.filter(s => s.status !== 'synced').length > 3 && (
                          <div className="text-xs text-yellow-600 italic px-2">
                            +{sales.filter(s => s.status !== 'synced').length - 3} pending...
                          </div>
                        )}
                      </>
                    )}

                    {/* Show synced separately */}
                    {sales.filter(s => s.status === 'synced').length > 0 && (
                      <>
                        <div className="text-xs font-bold text-green-700 px-2 py-1 bg-green-50 rounded">✓ Synced</div>
                        {sales.filter(s => s.status === 'synced').slice(0, 2).map(sale => (
                          <div key={sale.id} className="text-sm p-2 bg-green-50 rounded border-l-4 border-green-400">
                            <div className="font-medium flex justify-between">
                              <span>{sale.invoice_number}</span>
                              <span className="text-xs px-2 py-1 rounded bg-green-200 text-green-800 font-bold">
                                synced
                              </span>
                            </div>
                            <div className="text-xs text-gray-600 mt-1">
                              Total: Rs {sale.total} | Customer: {sale.customer_name || 'Walk-in'}
                            </div>
                          </div>
                        ))}
                        {sales.filter(s => s.status === 'synced').length > 2 && (
                          <div className="text-xs text-green-600 italic px-2">
                            +{sales.filter(s => s.status === 'synced').length - 2} synced...
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </Section>
            </div>

            {/* Footer - Clear Button */}
            <div className="border-t p-4 bg-gray-50">
              <button
                onClick={clearAll}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-red-100 text-red-700 hover:bg-red-200 rounded transition"
              >
                <Trash2 className="h-4 w-4" />
                Clear Cache
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}


/**
 * Collapsible section component
 */
function Section({
  title,
  count,
  isOpen,
  onClick,
  children,
}: {
  title: string;
  count: number;
  isOpen: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-200 rounded">
      <button
        onClick={onClick}
        className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span className="font-medium text-sm">{title}</span>
        </div>
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
          {count}
        </span>
      </button>
      {isOpen && <div className="p-3 border-t border-gray-200 bg-white">{children}</div>}
    </div>
  );
}
