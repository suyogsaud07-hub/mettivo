'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation'; // Import useRouter

export default function AuthPage() {
  const router = useRouter(); // Initialize router
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState('English (United Kingdom)');
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedLang = localStorage.getItem('mettivo_preferred_lang');
    if (savedLang) {
      setSelectedLang(savedLang);
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLanguageSelect = (lang: string) => {
    setSelectedLang(lang);
    localStorage.setItem('mettivo_preferred_lang', lang);
    setLangMenuOpen(false);
  };

  // Function to handle the Get Started button click
  const handleGetStarted = () => {
    router.push('/signup'); // Navigate to the new signup page
  };

  const languages = [
    'English (United Kingdom)', 'English (United States)', 'Mandarin Chinese (中文)',
    'Hindi (हिन्दी)', 'Spanish (Español)', 'French (Français)', 'Arabic (العربية)',
    'Bengali (বাংলা)', 'Portuguese (Português)', 'Russian (Русский)', 'Urdu (اردو)',
    'Nepali (नेपाली)', 'Japanese (日本語)', 'Korean (한국어)', 'Vietnamese (Tiếng Việt)',
    'Tagalog / Filipino', 'Thai (ไทย)', 'Indonesian (Bahasa Indonesia)', 'Malay (Bahasa Melayu)',
    'Punjabi (ਪੰਜਾਬੀ)', 'Marathi (मराठी)', 'Telugu (తెలుగు)', 'Tamil (தமிழ்)',
    'Gujarati (ગુજરાતી)', 'Burmese (မြန်မာဘာသာ)', 'Persian / Farsi (فارسی)',
    'Turkish (Türkçe)', 'German (Deutsch)', 'Italian (Italiano)', 'Dansk',
  ];

  return (
    <main className="relative min-h-screen w-full flex flex-col justify-between overflow-x-hidden bg-[#17121C] text-[#F2E9E4] font-sans selection:bg-[#D4B18A] selection:text-[#17121C]">
      
      {/* 1. Background Image with Overlay */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div 
          className="absolute inset-0 bg-cover bg-center transform scale-105 filter brightness-75 contrast-110 transition-transform duration-1000"
          style={{
            backgroundImage: "url('https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?q=80&w=2000&auto=format&fit=crop')",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#17121C] via-[#17121C]/85 to-[#17121C]/50" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#17121C]/90 via-transparent to-[#17121C]/90" />
        <div 
          className="absolute inset-0 opacity-30 mix-blend-overlay"
          style={{ backgroundColor: '#4A1828' }}
        />
      </div>

      {/* 2. Top Navigation Bar */}
      <header className="relative z-30 w-full max-w-7xl mx-auto px-6 md:px-10 py-5 flex items-center justify-between">
        
        {/* Top Left: Logo */}
        <div className="flex items-center gap-2.5 cursor-pointer group">
          <div className="w-6 h-6 transform group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full fill-none stroke-[9] stroke-round stroke-linejoin-round" style={{ stroke: '#D4B18A' }}>
              <path d="M 25,30 C 15,30 15,70 25,70 C 40,70 60,30 75,30 C 85,30 85,70 75,70 C 60,70 40,30 25,30 Z" />
            </svg>
          </div>

          <div className="flex flex-col">
            <span className="text-base font-bold tracking-[3px] uppercase text-[#F2E9E4] leading-none">
              METTIVO
            </span>
            <span 
              style={{ color: '#D4B18A' }}
              className="text-[8px] uppercase tracking-[1.8px] font-semibold opacity-90 mt-0.5"
            >
              YOUR NEXT CONNECTION
            </span>
          </div>
        </div>

        {/* Top Right Controls Container */}
        <div className="flex items-center gap-3">
          
          {/* Globe Button & Dropdown Wrapper */}
          <div className="relative flex-shrink-0" ref={dropdownRef}>
            <button 
              style={{ 
                backgroundColor: langMenuOpen ? '#F2E9E4' : '#29202D', 
                color: langMenuOpen ? '#17121C' : '#F2E9E4',
                borderColor: langMenuOpen ? '#D4B18A' : 'rgba(255, 255, 255, 0.15)'
              }}
              onClick={() => {
                setLangMenuOpen(!langMenuOpen);
                if (mobileMenuOpen) setMobileMenuOpen(false);
              }}
              className="h-11 px-4 rounded-2xl flex items-center gap-2.5 transition-all duration-300 border shadow-xl cursor-pointer"
            >
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
              <svg className={`w-3.5 h-3.5 fill-none stroke-current stroke-[2.5] transition-transform duration-200 ${langMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {langMenuOpen && (
              <div 
                style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '12px',
                  width: '260px', maxHeight: '350px', overflowY: 'auto',
                  backgroundColor: '#F2E9E4', borderRadius: '16px', padding: '8px',
                  zIndex: 100, boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}
              >
                <div className="flex flex-col gap-1">
                  {languages.map((lang) => {
                    const isSelected = selectedLang === lang;
                    return (
                      <button
                        key={lang}
                        onClick={() => handleLanguageSelect(lang)}
                        style={{
                          width: '100%', textAlign: 'left', padding: '12px 16px',
                          fontSize: '12px', fontWeight: 600, borderRadius: '12px',
                          cursor: 'pointer', display: 'flex', alignItems: 'center',
                          justifyContent: 'space-between', whiteSpace: 'nowrap',
                          backgroundColor: isSelected ? '#4A1828' : 'transparent',
                          color: isSelected ? '#F2E9E4' : '#17121C',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <span>{lang}</span>
                        {isSelected && (
                          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Hamburger Menu Button */}
          <button 
            style={{ backgroundColor: '#29202D', color: '#F2E9E4' }}
            onClick={() => {
              setMobileMenuOpen(!mobileMenuOpen);
              if (langMenuOpen) setLangMenuOpen(false);
            }}
            className="w-11 h-11 rounded-2xl flex items-center justify-center hover:bg-[#4A1828] transition-all duration-300 border border-white/15 shadow-xl cursor-pointer flex-shrink-0"
            aria-label="Toggle Menu"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path d="M18.3 5.71a1 1 0 0 0-1.42 0L12 10.59 7.12 5.7a1 1 0 0 0-1.42 1.42L10.59 12l-4.89 4.88a1 1 0 1 0 1.42 1.42L12 13.41l4.88 4.89a1 1 0 0 0 1.42-1.42L13.41 12l4.89-4.88a1 1 0 0 0 0-1.41z" />
              ) : (
                <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
              )}
            </svg>
          </button>
        </div>
      </header>

      {/* 3. Center Hero Section */}
      <section className="relative z-10 w-full max-w-xl mx-auto px-6 flex flex-col items-center text-center my-auto pt-0 pb-16">
        <h1 
          style={{ color: '#F2E9E4' }}
          className="text-4xl sm:text-5xl md:text-6xl font-serif font-black tracking-tight leading-[1.15] mb-12 drop-shadow-2xl"
        >
          Meet your <br />
          kind of <br />
          <span style={{ color: '#D4B18A' }} className="italic font-serif">people</span><span style={{ color: '#4A1828' }}>.</span>
        </h1>

        <div className="flex flex-col items-center justify-center gap-3 w-full max-w-[260px]">
          <button 
            style={{ 
              backgroundColor: '#D4B18A', 
              color: '#17121C',
              boxShadow: '0 8px 20px rgba(212, 177, 138, 0.25)' 
            }}
            onClick={handleGetStarted} // Updated to navigate to signup
            className="w-full py-3 px-6 rounded-full text-xs font-bold tracking-wide transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 group"
          >
            <span>Get started</span>
            <span className="transform group-hover:translate-x-1 transition-transform">&rarr;</span>
          </button>

          <button 
            style={{ 
              backgroundColor: '#29202D', 
              color: '#F2E9E4',
              borderColor: 'rgba(212, 177, 138, 0.3)' 
            }}
            onClick={() => alert('Get the app clicked')}
            className="w-full py-3 px-6 rounded-full text-xs font-semibold tracking-wide border transition-all duration-300 hover:bg-[#4A1828]/50 hover:border-[#D4B18A] active:scale-[0.98] cursor-pointer shadow-lg"
          >
            Get the app
          </button>
        </div>
      </section>

      {/* 4. Bottom Footer */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-10 pb-5 flex flex-col sm:flex-row items-center justify-between text-xs opacity-70 gap-3">
        <div className="text-center sm:text-left">
          <p className="font-medium tracking-wide">Someone on Mettivo might give you butterflies.</p>
          <span className="text-[10px] tracking-widest uppercase opacity-80 mt-0.5 block" style={{ color: '#D4B18A' }}>
            FIND OUT WHO &darr;
          </span>
        </div>

        <div className="text-center sm:text-right text-[10px] opacity-60 font-light">
          All photos are of models and used for illustrative purposes only &bull; Mettivo &copy; 2026
        </div>
      </footer>

      {/* 5. Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="absolute inset-0 z-50 bg-[#17121C]/95 backdrop-blur-xl flex flex-col p-8">
          <div className="flex justify-between items-center w-full max-w-md mx-auto mb-10">
            <span className="text-lg font-bold uppercase tracking-widest" style={{ color: '#D4B18A' }}>
              Menu
            </span>
            <button 
              onClick={() => setMobileMenuOpen(false)}
              className="w-9 h-9 rounded-full bg-[#29202D] text-white flex items-center justify-center cursor-pointer text-lg"
            >
              &times;
            </button>
          </div>
          <nav className="flex flex-col items-center gap-5 max-w-md mx-auto w-full text-base font-medium">
            <a href="#" className="hover:text-[#D4B18A] transition-colors py-2">Discover Dating</a>
            <a href="#" className="hover:text-[#D4B18A] transition-colors py-2">BFF & Friendship</a>
            <a href="#" className="hover:text-[#D4B18A] transition-colors py-2">Community Circles</a>
            <button 
              onClick={handleGetStarted}
              style={{ backgroundColor: '#D4B18A', color: '#17121C' }}
              className="w-full py-3.5 rounded-full font-bold mt-4 shadow-lg cursor-pointer text-sm"
            >
              Sign In Now
            </button>
          </nav>
        </div>
      )}

    </main>
  );
}