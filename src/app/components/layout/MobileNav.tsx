'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

export default function MobileNav() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const navItems = [
    { name: t('discover'), path: '/discover', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
    { name: t('people'), path: '/people', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
    { name: t('notifications'), path: '/notifications', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
    { name: t('moments'), path: '/moments', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { name: t('games'), path: '/game-zone', icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { name: t('profile'), path: '/profile/dashboard', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  ];

  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: '#17121C', borderTop: '1px solid #29202D', display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '12px 0 24px 0', zIndex: 100, paddingBottom: '30px' }}>
      {navItems.map((item) => {
        const isActive = pathname.startsWith(item.path);
        return (
          <Link key={item.path} href={item.path} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: isActive ? '#D4B18A' : '#B58A83', transition: 'color 0.2s', width: '16.6%' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? "2.5" : "2"} strokeLinecap="round" strokeLinejoin="round">
              <path d={item.icon} />
            </svg>
            <span style={{ fontSize: '9px', marginTop: '4px', fontWeight: isActive ? '700' : '500', textAlign: 'center', lineHeight: '1.1' }}>
              {item.name}
            </span>
          </Link>
        );
      })}
    </div>
  );
}