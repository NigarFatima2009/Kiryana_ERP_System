import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { UserCheck, UserX, Plus, Mail, Copy, Check, Trash2, Key, Shield } from 'lucide-react';
import { fetchEmployees, createCashier, toggleEmployeeActive, setCashierPassword, deleteCashierAccount } from '../../services/employees';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../lib/auth';
import type { Profile } from '../../types/database';

export function EmployeesPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [setPasswordTarget, setSetPasswordTarget] = useState<Profile | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    tempPassword: string;
    fullName: string;
  } | null>(null);

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggleEmployeeActive(id, active),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['employees'] });
      toast('success', 'Status updated');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCashierAccount,
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['employees'] });
      toast('success', 'Cashier account deleted');
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const cashiers = employees.filter((e) => e.role === 'CASHIER');
  const owners = employees.filter((e) => e.role === 'OWNER');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cashiers</h1>
          <p className="text-sm text-gray-500">Manage cashier accounts and access</p>
        </div>
        {profile?.role === 'OWNER' && (
          <button onClick={() => setShowCreateForm(true)} className="btn-primary">
            <Plus className="mr-2 h-4 w-4" /> Add Cashier
          </button>
        )}
      </div>

      {/* Owner info card */}
      {owners.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Shield size={14} /> Owner Account
          </h3>
          {owners.map((owner) => (
            <div key={owner.id} className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 text-sm font-medium text-purple-700">
                {owner.full_name?.charAt(0) || 'O'}
              </div>
              <div>
                <p className="font-medium">{owner.full_name || 'Owner'}</p>
                <p className="text-xs text-gray-500">{owner.email || owner.id.slice(0, 8) + '...'}</p>
              </div>
              <span className="ml-auto rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                Owner
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Cashier list */}
      {isLoading ? (
        <div className="card py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
        </div>
      ) : cashiers.length === 0 ? (
        <div className="card py-12 text-center">
          <UserX className="mx-auto h-12 w-12 text-gray-300 mb-3" />
          <p className="text-gray-500">No cashiers yet</p>
          <p className="text-sm text-gray-400 mt-1">Click "Add Cashier" to create the first account</p>
        </div>
      ) : (
        <div className="card p-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left">Cashier</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Auth</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cashiers.map((emp) => (
                <tr key={emp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-sm font-medium text-green-700">
                        {emp.full_name?.charAt(0) || 'C'}
                      </div>
                      <div>
                        <p className="font-medium">{emp.full_name}</p>
                        <p className="text-xs text-gray-500">{emp.email || 'No email'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      emp.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {emp.active ? <UserCheck size={12} /> : <UserX size={12} />}
                      {emp.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {emp.must_change_password ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        <Key size={12} /> Must change password
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        <Check size={12} /> Password set
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setSetPasswordTarget(emp)}
                        className="rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800"
                        title="Set Password"
                      >
                        <Key size={14} />
                      </button>
                      <button
                        onClick={() => activeMutation.mutate({ id: emp.id, active: !emp.active })}
                        className={`rounded p-1 ${emp.active ? 'text-red-600 hover:bg-red-50 hover:text-red-800' : 'text-green-600 hover:bg-green-50 hover:text-green-800'}`}
                        title={emp.active ? 'Deactivate' : 'Activate'}
                      >
                        {emp.active ? <UserX size={14} /> : <UserCheck size={14} />}
                      </button>
                      {!emp.active && (
                        <button
                          onClick={() => setDeleteTarget(emp)}
                          className="rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-800"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Cashier Modal */}
      <CreateCashierModal
        isOpen={showCreateForm}
        onClose={() => {
          setShowCreateForm(false);
          setCreatedCredentials(null);
        }}
        onCreated={(credentials) => {
          setCreatedCredentials(credentials);
          queryClient.refetchQueries({ queryKey: ['employees'] });
        }}
      />

      {/* Credentials Confirmation Modal */}
      {createdCredentials && (
        <CredentialsModal
          email={createdCredentials.email}
          tempPassword={createdCredentials.tempPassword}
          fullName={createdCredentials.fullName}
          onClose={() => {
            setCreatedCredentials(null);
            setShowCreateForm(false);
          }}
        />
      )}

      {/* Set Password Modal */}
      {setPasswordTarget && (
        <SetPasswordModal
          employee={setPasswordTarget}
          onClose={() => setSetPasswordTarget(null)}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Delete Cashier Account"
        message={`Permanently delete ${deleteTarget?.full_name}'s account? This removes their login credentials and cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

/* ── Create Cashier Modal ────────────────────────────────────── */

function CreateCashierModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (credentials: { email: string; tempPassword: string; fullName: string }) => void;
}) {
  const { toast } = useToast();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      createCashier({
        email,
        full_name: fullName,
        password: password || undefined, // Let server generate if empty
      }),
    onSuccess: (result) => {
      onCreated({
        email: result.email || email,
        tempPassword: result.temp_password || '',
        fullName,
      });
      setFullName('');
      setEmail('');
      setPassword('');
      toast('success', 'Cashier account created with real login credentials');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const generatePassword = () => {
    const pwd =
      Math.random().toString(36).substring(2, 10) +
      Math.random().toString(36).substring(2, 6) +
      'A1!';
    setPassword(pwd);
    setShowPassword(true);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Cashier"
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!email || !fullName || mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? 'Creating Account...' : 'Create Cashier'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          <p className="font-semibold mb-1">🔑 Real Auth Account</p>
          <p>This creates a real Supabase Auth account the cashier can use to log in immediately.</p>
        </div>

        <div>
          <label className="label">Full Name *</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Ahmed Khan"
            className="input-field"
          />
        </div>

        <div>
          <label className="label">Email Address *</label>
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-gray-400 shrink-0" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cashier@store.com"
              className="input-field"
            />
          </div>
        </div>

        <div>
          <label className="label">Password</label>
          <div className="flex gap-2">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field flex-1"
              placeholder="Leave blank to auto-generate"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="btn-secondary text-xs whitespace-nowrap px-3"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            type="button"
            onClick={generatePassword}
            className="mt-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Generate Random Password
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Credentials Confirmation Modal ──────────────────────────── */

function CredentialsModal({
  email,
  tempPassword,
  fullName,
  onClose,
}: {
  email: string;
  tempPassword: string;
  fullName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(
      `Cashier Login Credentials\n\nName: ${fullName}\nEmail: ${email}\nPassword: ${tempPassword}\n\n⚠️ The cashier will be asked to change this password on first login.`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="✅ Cashier Account Created" size="md"
      footer={
        <>
          <button onClick={handleCopy} className="btn-primary">
            {copied ? <><Check size={14} className="mr-1" /> Copied!</> : <><Copy size={14} className="mr-1" /> Copy Credentials</>}
          </button>
          <button onClick={onClose} className="btn-secondary">Done</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-800 mb-3">Login Credentials</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded bg-white p-2 border">
              <span className="text-xs text-gray-500">Name</span>
              <span className="font-medium text-sm">{fullName}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-white p-2 border">
              <span className="text-xs text-gray-500">Email</span>
              <span className="font-mono text-sm font-medium">{email}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-white p-2 border">
              <span className="text-xs text-gray-500">Password</span>
              <span className="font-mono text-sm font-medium text-red-600">{tempPassword}</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold mb-1">⚠️ Share securely</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li>The cashier will be required to change this password on first login</li>
            <li>This password is shown only once — copy it now</li>
            <li>Do not store passwords in plain text</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

/* ── Set Password Modal (Owner resets a cashier's password) ───── */

function SetPasswordModal({
  employee,
  onClose,
}: {
  employee: Profile;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () => setCashierPassword(employee.id, password),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['employees'] });
      toast('success', `Password reset for ${employee.full_name}`);
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const generatePassword = () => {
    const pwd =
      Math.random().toString(36).substring(2, 10) +
      Math.random().toString(36).substring(2, 6) +
      'A1!';
    setPassword(pwd);
    setShowPassword(true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(
      `Password reset for ${employee.full_name}\n\nNew Password: ${password}\n\n⚠️ The cashier will be asked to change this on next login.`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Reset Password — ${employee.full_name}`}
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!password || password.length < 6 || mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? 'Saving...' : 'Set Password'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          This will reset the cashier's password. They will be required to change it on next login.
        </p>

        <div>
          <label className="label">New Password *</label>
          <div className="flex gap-2">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field flex-1"
              placeholder="Minimum 6 characters"
              minLength={6}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="btn-secondary px-3"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={generatePassword}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          Generate Random Password
        </button>

        {password && password.length >= 6 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-800 font-semibold mb-1">
              Share with {employee.full_name}:
            </p>
            <div className="flex items-center justify-between rounded bg-white p-2 border">
              <span className="font-mono text-sm">{password}</span>
              <button
                onClick={handleCopy}
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
