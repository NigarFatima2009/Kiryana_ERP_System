import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Shield, UserCheck, UserX, Plus, Mail, Copy, Check, Trash2, Key } from 'lucide-react';
import { fetchEmployees, updateEmployeeRole, toggleEmployeeActive, inviteEmployee, deleteEmployee, setEmployeePassword } from '../../services/employees';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import type { AppRole } from '../../types/database';

const roles: { value: AppRole; label: string; color: string }[] = [
  { value: 'OWNER', label: 'Owner', color: 'bg-purple-100 text-purple-800' },
  { value: 'CASHIER', label: 'Cashier', color: 'bg-green-100 text-green-800' },
];

export function EmployeesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [setPasswordEmp, setSetPasswordEmp] = useState<{ id: string; name: string; email?: string | null } | null>(null);

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: AppRole }) => updateEmployeeRole(id, role),
    onSuccess: async () => { await queryClient.refetchQueries({ queryKey: ['employees'] }); toast('success', 'Role updated'); },
    onError: (e: Error) => toast('error', e.message),
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggleEmployeeActive(id, active),
    onSuccess: async () => { await queryClient.refetchQueries({ queryKey: ['employees'] }); toast('success', 'Status updated'); },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteEmployee,
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['employees'] });
      toast('success', 'Employee deleted');
      setDeleteId(null);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
        <button onClick={() => setShowInviteForm(true)} className="btn-primary"><Plus className="mr-2 h-4 w-4" /> Invite Employee</button>
      </div>

      {isLoading ? (
        <div className="card py-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" /></div>
      ) : (
        <div className="card p-0">
          <table className="min-w-full text-sm">
            <thead><tr className="table-header">
              <th className="px-4 py-3">Employee</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {employees.map((emp) => {
                const roleInfo = roles.find((r) => r.value === emp.role);
                return (
                  <tr key={emp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700">
                          {emp.full_name?.charAt(0) || 'U'}
                        </div>
                        <div>
                          <p className="font-medium">{emp.full_name}</p>
                          <p className="text-xs text-gray-500">{(emp as any).email || emp.id.slice(0, 8) + '...'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={emp.role}
                        onChange={(e) => roleMutation.mutate({ id: emp.id, role: e.target.value as AppRole })}
                        className="select-field text-sm py-1"
                        disabled={roleMutation.isPending}
                      >
                        {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${emp.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {emp.active ? <UserCheck size={12} /> : <UserX size={12} />}
                        {emp.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          onClick={() => setSetPasswordEmp({ id: emp.id, name: emp.full_name, email: emp.email })}
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          title="Set Password"
                        >
                          <Key size={12} /> Set Password
                        </button>
                        <button
                          onClick={() => activeMutation.mutate({ id: emp.id, active: !emp.active })}
                          className={`text-xs ${emp.active ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}`}
                        >
                          {emp.active ? 'Deactivate' : 'Activate'}
                        </button>
                        {!emp.active && (
                          <button
                            onClick={() => setDeleteId(emp.id)}
                            className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1"
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Role Permissions</h3>
        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <div key={r.value} className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 font-medium ${r.color}`}>{r.label}</span>
            </div>
          ))}
        </div>
      </div>

      <InviteEmployeeForm isOpen={showInviteForm} onClose={() => setShowInviteForm(false)} />
      {setPasswordEmp && <SetPasswordForm employee={setPasswordEmp} onClose={() => setSetPasswordEmp(null)} />}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Delete Employee"
        message="Are you sure you want to permanently delete this employee? This cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}function InviteEmployeeForm({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () => inviteEmployee({ email, full_name: fullName, role: 'CASHIER' }),
    onSuccess: async (result) => {
      // Wait a moment for the database to update before refetching
      await new Promise(resolve => setTimeout(resolve, 500));
      await queryClient.refetchQueries({ queryKey: ['employees'] });
      setGeneratedPassword(result.tempPassword);
      toast('success', `Cashier created! Share the credentials below.`);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(`Email: ${email}\nPassword: ${generatedPassword}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setEmail('');
    setFullName('');
    setGeneratedPassword('');
    onClose();
  };

  // Show credentials after successful invite
  if (generatedPassword) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title="Cashier Invited!" size="md"
        footer={<>
          <button onClick={handleCopy} className="btn-primary">
            {copied ? <><Check size={14} className="mr-1" /> Copied!</> : <><Copy size={14} className="mr-1" /> Copy Credentials</>}
          </button>
          <button onClick={handleClose} className="btn-secondary">Done</button>
        </>}>
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-800 mb-3">Share these steps with the cashier:</p>
            <ol className="space-y-2 text-xs text-blue-700">
              <li className="flex gap-2">
                <span className="font-bold min-w-fit">Step 1:</span>
                <span>Check email inbox for confirmation link from Kiryana ERP</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold min-w-fit">Step 2:</span>
                <span>Click the confirmation link in the email</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold min-w-fit">Step 3:</span>
                <span>Go back to login page and use these credentials:</span>
              </li>
            </ol>
          </div>
          
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-xs text-green-800 font-semibold mb-2">Login Credentials:</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded bg-white p-2 border">
                <span className="text-xs text-gray-500">Email</span>
                <span className="font-mono text-sm font-medium">{email}</span>
              </div>
              <div className="flex items-center justify-between rounded bg-white p-2 border">
                <span className="text-xs text-gray-500">Password</span>
                <span className="font-mono text-sm font-medium text-red-600">{generatedPassword}</span>
              </div>
            </div>
          </div>
          
          <p className="text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded p-3">
            💡 After logging in, the cashier can change their password for security.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Invite Cashier" size="md"
      footer={<>
        <button onClick={handleClose} className="btn-secondary">Cancel</button>
        <button onClick={() => mutation.mutate()} disabled={!email || !fullName || mutation.isPending} className="btn-primary">
          {mutation.isPending ? 'Creating...' : 'Create Cashier'}
        </button>
      </>}>
      <div className="space-y-4">
        <div>
          <label className="label">Full Name *</label>
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Doe" className="input-field" />
        </div>

        <div>
          <label className="label">Email Address *</label>
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-gray-400" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cashier@example.com" className="input-field" />
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800">
          <p className="font-semibold mb-1">How it works:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>A temporary password will be generated</li>
            <li>Cashier receives confirmation email and clicks the link</li>
            <li>Cashier logs in with their email and temporary password</li>
            <li>Cashier can then change their password</li>
          </ol>
        </div>
      </div>
    </Modal>
  );
}



function SetPasswordForm({ employee, onClose }: { employee: { id: string; name: string; email?: string | null }; onClose: () => void }) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () => setEmployeePassword(employee.id, password, (employee.email || '').toString()),
    onSuccess: async () => {
      toast('success', `Password set for ${employee.name}`);
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const generatePassword = () => {
    const pwd = Math.random().toString(36).substring(2, 10) +
                Math.random().toString(36).substring(2, 6) + 'A1!';
    setPassword(pwd);
    setShowPassword(true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`Set Password — ${employee.name}`} size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => mutation.mutate()} disabled={!password || password.length < 6 || mutation.isPending} className="btn-primary">
          {mutation.isPending ? 'Saving...' : 'Set Password'}
        </button>
      </>}>
      <div className="space-y-4">
        <div>
          <label className="label">New Password *</label>
          <div className="flex gap-2">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="Minimum 6 characters"
              minLength={6}
            />
            <button onClick={() => setShowPassword(!showPassword)} className="btn-secondary text-xs whitespace-nowrap">
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {password && password.length < 6 && (
            <p className="text-xs text-red-500 mt-1">Password must be at least 6 characters</p>
          )}
        </div>

        <button onClick={generatePassword} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          Generate Random Password
        </button>

        {password && password.length >= 6 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-800 font-semibold mb-1">Share with {employee.name}:</p>
            <div className="flex items-center justify-between rounded bg-white p-2 border">
              <span className="font-mono text-sm">{password}</span>
              <button onClick={handleCopy} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
