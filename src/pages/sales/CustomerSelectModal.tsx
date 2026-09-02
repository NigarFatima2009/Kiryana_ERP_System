import { useState, useMemo } from 'react';
import { Modal } from '../../components/ui/Modal';
import type { Customer } from '../../types/database';

interface CustomerSelectModalProps {
  customers: Customer[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function CustomerSelectModal({
  customers,
  onSelect,
  onClose,
}: CustomerSelectModalProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () =>
      customers.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.phone?.includes(search)
      ),
    [customers, search]
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
        <button
          onClick={() => onSelect('')}
          className="w-full rounded-lg p-2 text-left text-sm hover:bg-gray-50 text-gray-500"
        >
          Walk-in Customer
        </button>
        {filtered.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="w-full rounded-lg p-2 text-left text-sm hover:bg-gray-50"
          >
            <span className="font-medium">{c.name}</span> — {c.phone || 'No phone'}
          </button>
        ))}
      </div>
    </Modal>
  );
}
