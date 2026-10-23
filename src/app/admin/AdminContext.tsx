'use client';

import { createContext, useContext } from 'react';
import type { AdminIdentity, AdminPermission } from '@/lib/admin-console';

interface AdminContextValue {
  identity: AdminIdentity;
  can: (permission: AdminPermission) => boolean;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({
  identity,
  children,
}: {
  identity: AdminIdentity;
  children: React.ReactNode;
}) {
  const value: AdminContextValue = {
    identity,
    can: (permission) => identity.permissions.includes(permission),
  };
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) {
    throw new Error('useAdmin must be used inside the /admin layout.');
  }
  return value;
}
