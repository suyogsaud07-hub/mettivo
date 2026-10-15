'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { type Language } from '@/lib/translations';
import {
  PrivacyError,
  deleteMyAccount,
  downloadDataExport,
  exportMyData,
} from '@/lib/privacy';
import { PreferencesError } from '@/lib/preferences';
import { TRANSLATION_LANGUAGE_OPTIONS } from '@/lib/translation';
import { usePreferredTranslationLanguage } from '@/app/components/chat/usePreferredTranslationLanguage';

/**
 * Only languages that actually have translations are offered, so choosing one
 * has a real effect on the UI. Previously this list wrote a key
 * (`mettivo_preferred_lang`) that nothing in the app ever read.
 */
const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ne', label: 'Nepali (नेपाली)' },
  { code: 'hi', label: 'Hindi (हिन्दी)' },
  { code: 'es', label: 'Spanish (Español)' },
  { code: 'fr', label: 'French (Français)' },
];

export default function SettingsPage() {
  const router = useRouter();
  const { language, changeLanguage } = useLanguage();
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  // M15: data-subject rights (export / erasure)
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  /**
   * Chat translation target language (M17).
   *
   * Separate from the interface `Language` above on purpose: the UI locale and
   * the language you want *other people's messages* translated into are
   * different choices — a member may read the app in English while wanting
   * incoming Nepali translated to English.
   */
  const {
    language: translationLanguage,
    save: saveTranslationLanguage,
  } = usePreferredTranslationLanguage();
  const [isTranslateModalOpen, setIsTranslateModalOpen] = useState(false);
  const [isSavingTranslation, setIsSavingTranslation] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const translationLanguageLabel =
    TRANSLATION_LANGUAGE_OPTIONS.find((entry) => entry.code === translationLanguage)?.label ??
    translationLanguage;

  const handleTranslationLanguageSelect = async (code: string) => {
    setIsSavingTranslation(true);
    setTranslationError(null);
    try {
      await saveTranslationLanguage(code);
      setIsTranslateModalOpen(false);
    } catch (err) {
      // Surfaced inline rather than in an `alert()` (CODING_STANDARDS §4).
      setTranslationError(
        err instanceof PreferencesError
          ? err.message
          : 'Could not save your translation preference. Please try again.'
      );
    } finally {
      setIsSavingTranslation(false);
    }
  };

  const selectedLang =
    LANGUAGES.find((entry) => entry.code === language)?.label ?? 'English';
  
  // Ref for the avatar upload
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    router.push('/auth');
  };

  const handleClearCache = async () => {
    try {
      // Only clear cached network responses. `localStorage.clear()` would also
      // delete the Supabase auth token (sb-<ref>-auth-token), silently signing
      // the user out on the next refresh.
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      // Legacy key left behind by older builds; the live key is `mettivo_language`.
      localStorage.removeItem('mettivo_preferred_lang');
      alert('Cached data cleared.');
    } catch {
      alert('Could not clear cached data.');
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // Upsert, not a bare update: `update()` silently changes nothing when
          // the row does not exist yet, which is a data-loss bug
          // (AGENTS.md hard constraint 6). Only the supplied columns are
          // written, so the rest of the profile is untouched.
          const { error } = await supabase
            .from('profiles')
            .upsert({ id: user.id, avatar_url: base64String }, { onConflict: 'id' });
          if (error) {
            alert(`Error updating avatar: ${error.message}`);
          } else {
            alert('Avatar updated successfully!');
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLanguageSelect = (code: Language) => {
    changeLanguage(code);
    setIsLangModalOpen(false);
  };

  // --- M15: data-subject rights ---------------------------------------------

  /** Portability: fetch a machine-readable copy and hand it to the browser. */
  const handleExportData = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setPrivacyError(null);
    try {
      const payload = await exportMyData();
      downloadDataExport(payload);
    } catch (err) {
      console.error('Data export failed:', err);
      setPrivacyError(
        err instanceof PrivacyError ? err.message : 'Could not prepare your data export.'
      );
    } finally {
      setIsExporting(false);
    }
  };

  /** Erasure: irreversible, so it takes two deliberate taps. */
  const handleDeleteAccount = async () => {
    if (isDeleting) return;

    if (!confirmDelete) {
      setConfirmDelete(true);
      setPrivacyError(null);
      return;
    }

    setIsDeleting(true);
    setPrivacyError(null);
    try {
      await deleteMyAccount();
      // The session no longer exists; send the user to the landing page.
      router.replace('/');
    } catch (err) {
      console.error('Account deletion failed:', err);
      setPrivacyError(
        err instanceof PrivacyError
          ? err.message
          : 'Could not delete your account. Please try again.'
      );
      setConfirmDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  // Reusable styles for the menu items
  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '40px' },
    header: { display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', marginRight: '16px' },
    headerTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    
    // Menu Groups
    group: { backgroundColor: '#1C1822', marginTop: '16px', borderTop: '1px solid #29202D', borderBottom: '1px solid #29202D' },
    row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #29202D', cursor: 'pointer' },
    rowLast: { borderBottom: 'none' },
    rowLabel: { fontSize: '15px', fontWeight: '500', color: '#F2E9E4' },
    rowValue: { fontSize: '13px', color: '#B58A83', marginLeft: 'auto', marginRight: '10px' },
    chevron: { color: '#B58A83', fontSize: '18px' },
    signOutText: { color: '#EF4444', fontWeight: '700' },
    
    // Language Modal
    modalOverlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(13, 10, 16, 0.8)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'flex-end', flexDirection: 'column' as const, zIndex: 2000 },
    modalBox: { backgroundColor: '#1C1822', borderTopLeftRadius: '30px', borderTopRightRadius: '30px', padding: '30px 24px', borderTop: '1px solid #4A1828', maxHeight: '80vh', overflowY: 'auto' as const },
    modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
    modalTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    closeBtn: { background: 'none', border: 'none', color: '#B58A83', fontSize: '24px', cursor: 'pointer' },
    langItem: { padding: '16px', fontSize: '15px', color: '#F2E9E4', cursor: 'pointer', borderRadius: '12px', borderBottom: '1px solid #29202D', textAlign: 'center' as const },
    langItemActive: { backgroundColor: '#4A1828', color: '#D4B18A', fontWeight: '700' },
    modalHint: { fontSize: '12px', color: '#B58A83', lineHeight: '1.5', margin: '0 0 12px' },
    modalError: { fontSize: '12px', color: '#FCA5A5', margin: '0 0 12px' },
    modalCheck: { color: '#D4B18A', fontWeight: '700' }
  };

  return (
    <div style={styles.container}>
      
      {/* Hidden Avatar Input */}
      <input type="file" accept="image/*" ref={avatarInputRef} style={{ display: 'none' }} onChange={handleAvatarUpload} />

      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div style={styles.headerTitle}>Settings</div>
      </div>

      {/* Top Group */}
      <div style={styles.group}>
        <div style={styles.row} onClick={() => alert('Switch Mode coming soon!')}>
          <span style={styles.rowLabel}>Switch Mode</span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={styles.row} onClick={() => router.push('/profile/edit')}>
          <span style={styles.rowLabel}>Edit Profile</span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={styles.row} onClick={() => avatarInputRef.current?.click()}>
          <span style={styles.rowLabel}>Change Avatar</span>
          <span style={{ ...styles.chevron, fontSize: '24px' }}>👤</span>
        </div>
      </div>

      {/* Middle Group */}
      <div style={styles.group}>
        <div style={styles.row} onClick={() => alert('Notification settings coming soon!')}>
          <span style={styles.rowLabel}>Notifications</span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={styles.row} onClick={() => setIsLangModalOpen(true)}>
          <span style={styles.rowLabel}>Language</span>
          <span style={styles.rowValue}>{selectedLang}</span>
          <span style={styles.chevron}>›</span>
        </div>
        <div
          style={styles.row}
          onClick={() => setIsTranslateModalOpen(true)}
          data-testid="translate-language-row"
        >
          <span style={styles.rowLabel}>Translate chats to</span>
          <span style={styles.rowValue} data-testid="translate-language-value">
            {translationLanguageLabel}
          </span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={{ ...styles.row, ...styles.rowLast }} onClick={() => alert('Help Center coming soon!')}>
          <span style={styles.rowLabel}>Help Center</span>
          <span style={styles.chevron}>›</span>
        </div>
      </div>

      {/* Bottom Group */}
      <div style={styles.group}>
        <div style={styles.row} onClick={() => alert('Community Guidelines coming soon!')}><span style={styles.rowLabel}>Community Guidelines</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => alert('Safety Center coming soon!')}><span style={styles.rowLabel}>Safety Center</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => alert('Terms of Use coming soon!')}><span style={styles.rowLabel}>Terms of Use</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => alert('About Us coming soon!')}><span style={styles.rowLabel}>About Us</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => router.push('/report')}><span style={styles.rowLabel}>Block List</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => void handleClearCache()}><span style={styles.rowLabel}>Clear Cache</span><span style={styles.chevron}>›</span></div>

        {/* M15: data-subject rights. Additive rows — existing rows untouched. */}
        {privacyError && (
          <div
            role="alert"
            style={{
              margin: '12px 20px',
              backgroundColor: '#3B1220',
              border: '1px solid #7F1D2E',
              color: '#FCA5B5',
              borderRadius: '14px',
              padding: '12px 16px',
              fontSize: '13px',
              lineHeight: 1.5,
            }}
          >
            {privacyError}
          </div>
        )}

        <div style={styles.row} onClick={() => void handleExportData()}>
          <span style={styles.rowLabel}>
            {isExporting ? 'Preparing your data...' : 'Download my data'}
          </span>
          <span style={styles.chevron}>›</span>
        </div>

        <Link href="/privacy" style={{ ...styles.row, textDecoration: 'none' }}>
          <span style={styles.rowLabel}>Privacy &amp; Terms</span>
          <span style={styles.chevron}>›</span>
        </Link>

        <div
          style={{ ...styles.row, ...(confirmDelete ? { backgroundColor: '#3B1220' } : {}) }}
          onClick={() => void handleDeleteAccount()}
        >
          <span
            style={{
              ...styles.rowLabel,
              color: confirmDelete ? '#FCA5B5' : '#EF4444',
            }}
          >
            {isDeleting
              ? 'Deleting your account...'
              : confirmDelete
                ? 'Tap again to permanently delete'
                : 'Delete Account'}
          </span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={styles.row} onClick={() => alert('Account settings coming soon!')}><span style={styles.rowLabel}>Account</span><span style={styles.chevron}>›</span></div>
        <div style={{ ...styles.row, ...styles.rowLast }} onClick={() => alert('Privacy Control coming soon!')}>
          <span style={styles.rowLabel}>Privacy Control</span>
          <span style={styles.chevron}>›</span>
        </div>
      </div>

      {/* Sign Out */}
      <div style={styles.group}>
        <div style={{ ...styles.row, ...styles.rowLast }} onClick={handleSignOut}>
          <span style={{ ...styles.rowLabel, ...styles.signOutText }}>
            {isSigningOut ? 'Signing Out...' : 'Sign Out'}
          </span>
        </div>
      </div>

      {/* Language Selection Modal */}
      {isLangModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Select Language</div>
              <button style={styles.closeBtn} onClick={() => setIsLangModalOpen(false)}>×</button>
            </div>
            {LANGUAGES.map((entry) => (
              <div
                key={entry.code}
                style={{ ...styles.langItem, ...(language === entry.code ? styles.langItemActive : {}) }}
                onClick={() => handleLanguageSelect(entry.code)}
              >
                {entry.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chat translation target language (M17) */}
      {isTranslateModalOpen && (
        <div
          style={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Translate chats to"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsTranslateModalOpen(false);
          }}
        >
          <div style={styles.modalBox}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Translate chats to</div>
              <button
                style={styles.closeBtn}
                onClick={() => setIsTranslateModalOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <p style={styles.modalHint}>
              Incoming messages keep their original text. Tap Translate on a message to
              reveal it in this language.
            </p>

            {translationError && (
              <p role="alert" data-testid="translate-language-error" style={styles.modalError}>
                {translationError}
              </p>
            )}

            <div
              role="radiogroup"
              aria-label="Translation language"
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const target = event.target as HTMLElement;
                const code = target.getAttribute('data-language-code');
                if (code) void handleTranslationLanguageSelect(code);
              }}
            >
              {TRANSLATION_LANGUAGE_OPTIONS.map((entry) => {
                const isActive = entry.code === translationLanguage;
                return (
                  <div
                    key={entry.code}
                    role="radio"
                    tabIndex={0}
                    aria-checked={isActive}
                    data-language-code={entry.code}
                    data-testid={`translate-language-option-${entry.code}`}
                    style={{ ...styles.langItem, ...(isActive ? styles.langItemActive : {}) }}
                    onClick={() => {
                      if (!isSavingTranslation) void handleTranslationLanguageSelect(entry.code);
                    }}
                  >
                    {entry.label}
                    {isActive && <span style={styles.modalCheck}> ✓</span>}
                  </div>
                );
              })}
            </div>

            {isSavingTranslation && (
              <p role="status" style={styles.modalHint}>
                Saving…
              </p>
            )}
          </div>
        </div>
      )}

    </div>
  );
}