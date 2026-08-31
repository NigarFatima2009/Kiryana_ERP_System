import { Bell, Search, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useNotifications } from '../../hooks/useNotifications';

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const { profile } = useAuth();
  const { unreadCount } = useNotifications();

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 lg:hidden"
        >
          <Menu size={20} />
        </button>
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            className="input-field pl-9 w-64"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Link
          to="/notifications"
          className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
              {unreadCount}
            </span>
          )}
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600">
            {profile?.full_name?.charAt(0) || 'U'}
          </div>
          <span className="hidden text-sm font-medium text-gray-700 sm:block">{profile?.full_name || 'User'}</span>
        </div>
      </div>
    </header>
  );
}
