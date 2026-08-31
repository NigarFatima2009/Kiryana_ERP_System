import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { fetchStoreSettings, updateStoreSettings } from '../../services/settings';
import { useToast } from '../../components/ui/Toast';

export function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['store-settings'],
    queryFn: fetchStoreSettings,
  });

  const [form, setForm] = useState({
    store_name: '',
    address: '',
    phone: '',
    currency: 'PKR',
  });

  useEffect(() => {
    if (settings) {
      setForm({
        store_name: settings.store_name || '',
        address: settings.address || '',
        phone: settings.phone || '',
        currency: settings.currency || 'PKR',
      });
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: () => updateStoreSettings(form),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['store-settings'] });
      toast('success', 'Settings saved');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <div className="card max-w-2xl space-y-4">
        <h3 className="text-lg font-semibold">Store Information</h3>
        <div>
          <label className="label">Store Name</label>
          <input value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} className="input-field" />
        </div>
        <div>
          <label className="label">Address</label>
          <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input-field" rows={2} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input-field" />
        </div>
        <div>
          <label className="label">Currency</label>
          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="select-field">
            <option value="PKR">PKR (Pakistani Rupee)</option>
            <option value="USD">USD (US Dollar)</option>
          </select>
        </div>
        <button onClick={() => mutation.mutate()} className="btn-primary" disabled={mutation.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {mutation.isPending ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="card max-w-2xl">
        <h3 className="text-lg font-semibold mb-4">System Information</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Application</span><span>Kiryana Store ERP</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Version</span><span>1.0.0</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Database</span><span>Supabase PostgreSQL</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Frontend</span><span>React + TypeScript + Vite</span></div>
        </div>
      </div>
    </div>
  );
}
