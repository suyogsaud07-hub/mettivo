// src/app/(main)/layout.tsx
import MobileNav from '../components/layout/MobileNav';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: '#17121C', minHeight: '100vh', paddingBottom: '80px' }}>
      {children}
      <MobileNav />
    </div>
  );
}