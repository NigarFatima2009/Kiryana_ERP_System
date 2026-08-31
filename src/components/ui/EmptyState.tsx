import React from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="mb-4 text-gray-300">{icon || <Inbox className="h-16 w-16" />}</div>
      {title && <h3 className="mb-1 text-lg font-medium text-gray-900">{title}</h3>}
      <p className="mb-4 text-sm text-gray-500">{message}</p>
      {action}
    </div>
  );
}
