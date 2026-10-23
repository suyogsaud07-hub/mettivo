'use client';

import './admin.css';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminProvider } from './AdminContext';
import {
  AdminError,
  fetchAdminIdentity,
  type AdminIdentity,
  type AdminPermission,
} from '@/lib/admin-console';
import { supabase } from '@/lib/supabase';

interface NavItem {
  label: string;
  href: string;
  permission: AdminPermission;
  icon: string;
  group: 'Overview' | 'Operations' | 'Growth' | 'Governance';
}

const NAV: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/admin',
    permission: 'dashboard.view',
    group: 'Overview',
    icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  },
  {
    label: 'User management',
    href: '/admin/users',
    permission: 'users.view',
    group: 'Operations',
    icon: 'M17 20h5v-2a3 3 0 00-5.36-1.86M17 20H7m10 0v-2c0-.66-.13-1.28-.36-1.86M7 20H2v-2a3 3 0 015.36-1.86M7 20v-2c0-.66.13-1.28.36-1.86m0 0a5 5 0 019.28 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  },
  {
    label: 'Safety & moderation',
    href: '/admin/moderation',
    permission: 'moderation.view',
    group: 'Operations',
    icon: 'M12 3l8 4v5c0 5-3.5 8.2-8 9-4.5-.8-8-4-8-9V7l8-4zM9 12l2 2 4-4',
  },
  {
    label: 'Subscriptions & plans',
    href: '/admin/subscriptions',
    permission: 'subscriptions.view',
    group: 'Growth',
    icon: 'M3 7h18v11H3zM3 10h18M7 15h4',
  },
  {
    label: 'Payments & refunds',
    href: '/admin/payments',
    permission: 'payments.view',
    group: 'Growth',
    icon: 'M2 8h20v10H2zM2 12h20M6 16h2',
  },
  {
    label: 'Dating & discovery',
    href: '/admin/discovery',
    permission: 'content.view',
    group: 'Growth',
    icon: 'M12 21s-7-4.6-9-8.5A5 5 0 016 5c2 0 3 1 4 2 1-1 2-2 4-2a5 5 0 013 7.5C19 16.4 12 21 12 21z',
  },
  {
    label: 'Photos, Moments & Reels',
    href: '/admin/media',
    permission: 'content.view',
    group: 'Operations',
    icon: 'M4 5h16v14H4zM4 15l5-5 4 4 2-2 5 5M9 9h.01',
  },
  {
    label: 'Chat & communication',
    href: '/admin/chat',
    permission: 'chat.view',
    group: 'Operations',
    icon: 'M21 12a8 8 0 01-8 8H7l-4 3V12a9 9 0 019-9 8 8 0 019 9zM8 10h.01M12 10h.01M16 10h.01',
  },
  {
    label: 'Notifications & promotions',
    href: '/admin/notifications',
    permission: 'notifications.manage',
    group: 'Growth',
    icon: 'M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  },
  {
    label: 'Analytics & reports',
    href: '/admin/analytics',
    permission: 'analytics.view',
    group: 'Growth',
    icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  },
  {
    label: 'Staff & permissions',
    href: '/admin/staff',
    permission: 'staff.manage',
    group: 'Governance',
    icon: 'M16 21v-2a4 4 0 00-8 0v2M12 11a4 4 0 100-8 4 4 0 000 8zM20 21v-2a4 4 0 00-3-3.87',
  },
  {
    label: 'Audit logs',
    href: '/admin/audit',
    permission: 'audit.view',
    group: 'Governance',
    icon: 'M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01',
  },
  {
    label: 'System health',
    href: '/admin/system',
    permission: 'system.view',
    group: 'Governance',
    icon: 'M3 12h4l2-7 4 14 2-7h6',
  },
  {
    label: 'Settings',
    href: '/admin/settings',
    permission: 'settings.manage',
    group: 'Governance',
    icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21h-4v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1-2.8-2.8.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3v-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 001.9.3 1.7 1.7 0 001-1.5V3h4v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.5 1H21v4h-.1a1.7 1.7 0 00-1.5 1z',
  },
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  '/admin': { title: 'Dashboard overview', subtitle: 'Live platform health, growth and safety signals.' },
  '/admin/users': { title: 'User management', subtitle: 'Search members, review history and apply audited account actions.' },
  '/admin/moderation': { title: 'Safety & moderation', subtitle: 'Triage reports with evidence, notes and Subbu-assisted assessment.' },
  '/admin/subscriptions': { title: 'Subscriptions & plans', subtitle: 'Manage plan configuration and member subscription records.' },
  '/admin/payments': { title: 'Payments & refunds', subtitle: 'Verified Stripe event ledger and reconciliation totals.' },
  '/admin/discovery': { title: 'Dating & discovery', subtitle: 'Matching health, platform limits and abuse controls.' },
  '/admin/media': { title: 'Photos, Moments & Reels', subtitle: 'Review reported content and moderation state.' },
  '/admin/chat': { title: 'Chat & communication', subtitle: 'Aggregate communication health without reading private conversations.' },
  '/admin/notifications': { title: 'Notifications & promotions', subtitle: 'Campaign drafts and delivery readiness.' },
  '/admin/analytics': { title: 'Analytics & reports', subtitle: 'Growth, retention, revenue and moderation reporting.' },
  '/admin/staff': { title: 'Staff & permissions', subtitle: 'Assign least-privilege roles. Every change is audited.' },
  '/admin/audit': { title: 'Audit logs', subtitle: 'Append-only record of privileged actions.' },
  '/admin/system': { title: 'System health', subtitle: 'Database, payment pipeline and integration readiness.' },
  '/admin/settings': { title: 'Settings', subtitle: 'Feature flags, rate limits, policy configuration and maintenance.' },
};

function Icon({ path }: { path: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function initials(name: string | null): string {
  if (!name) return 'AD';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || 'AD';
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const me = await fetchAdminIdentity();
        if (cancelled) return;
        if (!me) {
          router.replace('/auth');
          return;
        }
        setIdentity(me);
        setState(me.role === 'user' ? 'denied' : 'ready');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof AdminError ? err.message : 'Could not verify administrator access.');
        setState('error');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/auth');
  };

  if (state === 'loading') {
    return (
      <div className="admin-denied">
        <div className="admin-brand-mark">M</div>
        <p>Verifying administrator access…</p>
      </div>
    );
  }

  if (state === 'error' || !identity) {
    return (
      <div className="admin-denied">
        <div className="admin-brand-mark">M</div>
        <h1>Console unavailable</h1>
        <p>{error ?? 'Administrator access could not be verified.'}</p>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="admin-denied">
        <div className="admin-brand-mark">M</div>
        <h1>Administrator access required</h1>
        <p>
          This area is restricted to authorised Mettivo staff. Your account is signed in as a
          regular member. If you believe this is a mistake, contact a super admin.
        </p>
        <Link href="/discover">Back to Mettivo</Link>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  const permitted = NAV.filter((item) => identity.permissions.includes(item.permission));
  const groups: NavItem['group'][] = ['Overview', 'Operations', 'Growth', 'Governance'];
  const page = TITLES[pathname] ?? {
    title: 'Admin',
    subtitle: 'Mettivo administrative control center.',
  };

  return (
    <AdminProvider identity={identity}>
      <div className="admin-root">
        <div className={`admin-shell${collapsed ? ' is-collapsed' : ''}`}>
          <aside className={`admin-sidebar${mobileOpen ? ' is-mobile-open' : ''}`} aria-label="Admin navigation">
            <div className="admin-brand">
              <div className="admin-brand-mark">M</div>
              <div className="admin-brand-text">
                <p className="admin-brand-name">Mettivo</p>
                <p className="admin-brand-sub">Control center</p>
              </div>
            </div>

            <nav className="admin-nav">
              {groups.map((group) => {
                const items = permitted.filter((item) => item.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group}>
                    <div className="admin-nav-group">{group}</div>
                    {items.map((item) => {
                      const active =
                        item.href === '/admin'
                          ? pathname === '/admin'
                          : pathname.startsWith(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`admin-nav-link${active ? ' is-active' : ''}`}
                          aria-current={active ? 'page' : undefined}
                          title={collapsed ? item.label : undefined}
                          onClick={() => setMobileOpen(false)}
                        >
                          <Icon path={item.icon} />
                          <span className="admin-nav-label">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </nav>

            <div className="admin-sidebar-foot">
              <button
                type="button"
                className="admin-collapse"
                onClick={() => setCollapsed((value) => !value)}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
                </svg>
                <span className="admin-collapse-label">{collapsed ? 'Expand' : 'Collapse'}</span>
              </button>
            </div>
          </aside>

          <div
            className={`admin-overlay-close${mobileOpen ? ' is-visible' : ''}`}
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          <div className="admin-main">
            <header className="admin-topbar">
              <button
                type="button"
                className="admin-menu-btn"
                onClick={() => setMobileOpen(true)}
                aria-label="Open admin navigation"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              <div>
                <h1>{page.title}</h1>
                <p className="admin-topbar-sub">{page.subtitle}</p>
              </div>

              <div className="admin-topbar-spacer" />

              <Link href="/discover" className="admin-icon-btn" aria-label="Open the member app" title="Member app">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5" />
                </svg>
              </Link>

              <div className="admin-identity">
                <div className="admin-avatar">
                  {identity.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={identity.avatarUrl} alt="" />
                  ) : (
                    initials(identity.displayName)
                  )}
                </div>
                <div>
                  <div className="admin-identity-name">{identity.displayName ?? 'Administrator'}</div>
                </div>
                <span className="admin-role-badge">{identity.role.replace('_', ' ')}</span>
              </div>

              <button type="button" className="admin-icon-btn" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </header>

            <main className="admin-content">{children}</main>
          </div>
        </div>
      </div>
    </AdminProvider>
  );
}
