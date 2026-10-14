'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function MobileNav() {
  const pathname = usePathname();

  const navItems = [
    { name: 'Discover', path: '/discover', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' }, // Search/Home
    { name: 'People', path: '/people', icon: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z' }, // Fire/Swipe
    { name: 'Likes', path: '/liked-you', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' }, // Heart
    { name: 'Chat', path: '/chat', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' }, // Chat bubble
    { name: 'Profile', path: '/profile/dashboard', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' }, // User
  ];

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      backgroundColor: '#17121C', borderTop: '1px solid #29202D',
      display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      padding: '12px 0 24px 0', zIndex: 100, paddingBottom: '30px' // extra padding for mobile safe areas
    }}>
      {navItems.map((item) => {
        const isActive = pathname.startsWith(item.path);
        return (
          <Link key={item.name} href={item.path} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            textDecoration: 'none', color: isActive ? '#D4B18A' : '#B58A83',
            transition: 'color 0.2s'
          }}>
            <svg 
              width="24" height="24" viewBox="0 0 24 24" 
              fill="none" stroke="currentColor" strokeWidth={isActive ? "2.5" : "2"} 
              strokeLinecap="round" strokeLinejoin="round"
            >
              <path d={item.icon} />
            </svg>
            <span style={{ fontSize: '10px', marginTop: '4px', fontWeight: isActive ? '700' : '500' }}>
              {item.name}
            </span>
          </Link>
        );
      })}
    </div>
  );
}