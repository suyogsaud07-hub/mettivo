'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  // Placeholder handlers for social logins
  const handleSocialLogin = (provider: string) => {
    alert(`Initiating ${provider} login...`);
    // In a real app, you would call your Supabase Auth here:
    // supabase.auth.signInWithOAuth({ provider: 'google' })
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#161219] text-white font-sans selection:bg-[#C5A880] selection:text-[#161219]">
      
      {/* Luxurious ambient background glow */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[60%] rounded-full bg-[#581C25]/20 blur-[140px]" />
        <div className="absolute top-[40%] -right-[10%] w-[60%] h-[60%] rounded-full bg-[#C5A880]/10 blur-[140px]" />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 w-full max-w-md mx-auto">
        
        {/* Logo & Branding */}
        <div className="flex flex-col items-center gap-4 mb-10 text-center">
          <div className="w-16 h-16 flex items-center justify-center">
            <svg viewBox="0 0 100 100" className="w-full h-full fill-none stroke-[9] stroke-round stroke-linejoin-round" style={{ stroke: '#C5A880' }}>
              <path d="M 25,30 C 15,30 15,70 25,70 C 40,70 60,30 75,30 C 85,30 85,70 75,70 C 60,70 40,30 25,30 Z" />
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-[4px] uppercase text-white mb-1">
              Mettivo
            </h1>
            <p className="text-sm font-medium text-[#C5A880] tracking-widest uppercase">
              Your Next Connection
            </p>
          </div>
          <p className="text-sm text-neutral-400 max-w-xs mx-auto mt-4 leading-relaxed">
            An intimate space to find meaningful connections wrapped in luxury.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="w-full space-y-3">
          
          {/* Primary Sign Up */}
          <Link
            href="/signup"
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#C5A880] hover:bg-[#b0956e] text-[#161219] font-bold text-sm tracking-wide shadow-lg shadow-[#C5A880]/20 transition-all active:scale-[0.98]"
          >
            Create account
          </Link>

          {/* Divider */}
          <div className="relative flex items-center py-4">
            <div className="flex-grow border-t border-white/10"></div>
            <span className="flex-shrink-0 mx-4 text-[10px] uppercase tracking-widest text-neutral-500">
              or continue with
            </span>
            <div className="flex-grow border-t border-white/10"></div>
          </div>

          {/* Social Login - Google */}
          <button
            onClick={() => handleSocialLogin('Google')}
            className="w-full h-12 flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-semibold"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google
          </button>

          {/* Social Login - Facebook */}
          <button
            onClick={() => handleSocialLogin('Facebook')}
            className="w-full h-12 flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-semibold"
          >
            <svg className="w-5 h-5 text-[#1877F2]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            Facebook
          </button>

          {/* Social Login - Twitter / X */}
          <button
            onClick={() => handleSocialLogin('Twitter')}
            className="w-full h-12 flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-semibold"
          >
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            Twitter
          </button>

          {/* Social Login - Phone Number */}
          <button
            onClick={() => handleSocialLogin('Phone')}
            className="w-full h-12 flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm font-semibold"
          >
            <svg className="w-5 h-5 text-[#C5A880]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Phone number
          </button>
        </div>

        {/* Existing User Login Link */}
        <div className="mt-8 text-center">
          <p className="text-sm text-neutral-400">
            Already have an account?{' '}
            <Link href="/auth" className="text-[#C5A880] font-semibold hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>

      {/* Footer / 18+ Disclaimer */}
      <div className="w-full max-w-md mx-auto px-6 pb-8 text-center space-y-3">
        <div className="inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10">
          <span className="text-[10px] font-bold text-[#C5A880] border border-[#C5A880] rounded-full w-4 h-4 flex items-center justify-center">18</span>
          <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold">Must be 18+ to use Mettivo</span>
        </div>
        <p className="text-[10px] text-neutral-500 leading-relaxed">
          By signing up, you agree to our{' '}
          <Link href="#" className="underline hover:text-neutral-300">Terms of Service</Link> and{' '}
          <Link href="#" className="underline hover:text-neutral-300">Privacy Policy</Link>.
        </p>
        <p className="text-[10px] text-neutral-600">
          &copy; 2026 Mettivo. All rights reserved.
        </p>
      </div>

    </div>
  );
}