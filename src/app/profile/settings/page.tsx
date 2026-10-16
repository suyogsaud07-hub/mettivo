'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import {
  LOCALE_OPTIONS,
  localeNativeName,
  searchLocales,
  type LocaleCode,
} from '@/lib/locales';
import {
  PrivacyError,
  downloadDataExport,
  exportMyData,
} from '@/lib/privacy';
import { PreferencesError } from '@/lib/preferences';
import { TRANSLATION_LANGUAGE_OPTIONS } from '@/lib/translation';
import { usePreferredTranslationLanguage } from '@/app/components/chat/usePreferredTranslationLanguage';
import { AvatarError, saveAvatar } from '@/lib/avatar';
import PhotoCropperModal from '@/app/components/verification/PhotoCropperModal';
import { LEGAL_DOC_TITLES, type LegalDocId } from '@/lib/legal-content';
import BottomSheet from './components/BottomSheet';
import Toast, { type ToastMessage } from './components/Toast';
import EditProfileSheet from './components/EditProfileSheet';
import AccountSheet from './components/AccountSheet';
import DeleteAccountSheet from './components/DeleteAccountSheet';
import NotificationsSheet from './components/NotificationsSheet';
import PrivacySheet from './components/PrivacySheet';
import BlockListSheet from './components/BlockListSheet';
import LegalSheet from './components/LegalSheet';

/**
 * Every language with strings is offered, so choosing one has a real effect on
 * the UI. The list is derived from `LOCALE_OPTIONS` — the same catalogue the
 * landing picker uses — rather than a second hand-written array, which is how
 * the landing page and this screen previously disagreed (5 entries vs 4).
 */
const LANGUAGES = LOCALE_OPTIONS;

/** Sheets that share the generic `BottomSheet` shell. */
type SheetId =
  | 'edit'
  | 'account'
  | 'delete'
  | 'notifications'
  | 'privacy'
  | 'blocklist'
  | LegalDocId;

const LEGAL_IDS: readonly LegalDocId[] = ['help', 'guidelines', 'safety', 'terms', 'about'];

function isLegalId(id: SheetId): id is LegalDocId {
  return (LEGAL_IDS as readonly string[]).includes(id);
}

function sheetTitle(id: SheetId): string {
  switch (id) {
    case 'edit':
      return 'Edit Profile';
    case 'account':
      return 'Account';
    case 'delete':
      return 'Delete Account';
    case 'notifications':
      return 'Notifications';
    case 'privacy':
      return 'Privacy Control';
    case 'blocklist':
      return 'Block List';
    default:
      return LEGAL_DOC_TITLES[id];
  }
}

export default function SettingsPage() {
  const router = useRouter();
  const { language, changeLanguage } = useLanguage();
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  /** Filters the language sheet; 51 rows is too many to scroll blindly. */
  const [langQuery, setLangQuery] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);
  // M15: data-subject rights (export)
  const [isExporting, setIsExporting] = useState(false);
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

  /** The open settings sheet, or null. */
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);

  // Toast is page-owned so a sheet closing cannot cancel the confirmation.
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: ToastMessage['tone'] = 'success') => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const closeSheet = useCallback(() => setSheet(null), []);

  const translationLanguageLabel =
    TRANSLATION_LANGUAGE_OPTIONS.find((entry) => entry.code === translationLanguage)?.label ??
    translationLanguage;

  const handleTranslationLanguageSelect = async (code: string) => {
    setIsSavingTranslation(true);
    setTranslationError(null);
    try {
      await saveTranslationLanguage(code);
      setIsTranslateModalOpen(false);
      showToast('Translation preference saved');
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

  // The endonym is what a member recognises: "日本語", not "Japanese".
  const selectedLang = localeNativeName(language);
  /** Filtered rows for the open sheet. */
  const visibleLanguages = searchLocales(langQuery);

  // Ref for the avatar upload
  const avatarInputRef = useRef<HTMLInputElement>(null);
  // Data URL of the picked image, shown in the cropper before it is uploaded.
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      // `signOut()` reports failure in `error`, it does not throw. Navigating
      // regardless would strand the member on /auth while still signed in.
      if (error) {
        console.error('Sign out failed:', error.message);
        showToast('Could not sign you out. Please try again.', 'error');
        return;
      }
      router.push('/auth');
    } finally {
      // Loading states must always terminate (AGENTS.md hard constraint 7).
      setIsSigningOut(false);
    }
  };

  const handleClearCache = async () => {
    try {
      // Clear caches and storage, but PRESERVE the Supabase auth keys
      // (`sb-*`, `supabase*`): a blind `localStorage.clear()` deletes
      // `sb-<ref>-auth-token` and silently signs the member out on reload.
      const preserved = new Map<string, string>();
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('sb-') || key.startsWith('supabase'))) {
          preserved.set(key, localStorage.getItem(key) ?? '');
        }
      }
      localStorage.clear();
      preserved.forEach((value, key) => localStorage.setItem(key, value));

      sessionStorage.clear();

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      showToast('App cache cleared successfully.');
    } catch {
      showToast('Could not clear cached data.', 'error');
    }
  };

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-selecting the same file fires `change` again.
    event.target.value = '';
    if (!file) return;

    // M24: crop before upload so the member controls the framing — the same
    // pan/zoom tool the onboarding flow uses.
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setCropperSrc(reader.result);
      } else {
        showToast('That image could not be read.', 'error');
      }
    };
    reader.onerror = () => showToast('That image could not be read.', 'error');
    reader.readAsDataURL(file);
  };

  const handleCroppedAvatar = async (dataUrl: string) => {
    setCropperSrc(null);
    setIsAvatarBusy(true);
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], 'avatar.jpg', { type: blob.type || 'image/jpeg' });
      await saveAvatar(file);
      showToast('Avatar updated');
    } catch (err) {
      console.error('[settings] avatar upload failed:', err);
      showToast(
        err instanceof AvatarError ? err.message : 'Could not update your avatar. Please try again.',
        'error'
      );
    } finally {
      setIsAvatarBusy(false);
    }
  };

  const handleLanguageSelect = (code: LocaleCode) => {
    changeLanguage(code);
    setIsLangModalOpen(false);
    setLangQuery('');
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
      showToast('Your data export is downloading.');
    } catch (err) {
      console.error('Data export failed:', err);
      setPrivacyError(
        err instanceof PrivacyError ? err.message : 'Could not prepare your data export.'
      );
    } finally {
      setIsExporting(false);
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
    langItemSub: { display: 'block', fontSize: '11px', color: '#B58A83', fontWeight: 400, marginTop: '2px' },
    /** Search field for the ~50-row language sheet. */
    langSearch: { width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #3e314b', backgroundColor: '#251d2d', color: '#eae2f0', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as const, marginBottom: '12px' },
    /** Scrollable row container with a slim scrollbar for the long list. */
    langList: { maxHeight: '52vh', overflowY: 'auto' as const, overscrollBehavior: 'contain' as const, scrollbarWidth: 'thin' as const, scrollbarColor: '#34283f transparent' },
    langEmpty: { fontSize: '13px', color: '#B58A83', textAlign: 'center' as const, padding: '18px 0', margin: 0 },
    langNote: { margin: '12px 0 0', fontSize: '10px', color: '#9b8ba6', lineHeight: 1.5, textAlign: 'center' as const },
    modalHint: { fontSize: '12px', color: '#B58A83', lineHeight: '1.5', margin: '0 0 12px' },
    modalError: { fontSize: '12px', color: '#FCA5A5', margin: '0 0 12px' },
    modalCheck: { color: '#D4B18A', fontWeight: '700' }
  };

  return (
    <div style={styles.container}>

      {/* Hidden Avatar Input */}
      <input
        type="file"
        accept="image/*"
        ref={avatarInputRef}
        data-testid="avatar-input"
        style={{ display: 'none' }}
        onChange={handleAvatarUpload}
      />

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
        <div style={styles.row} data-testid="settings-edit-profile" onClick={() => setSheet('edit')}>
          <span style={styles.rowLabel}>Edit Profile</span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={styles.row} data-testid="settings-change-avatar" onClick={() => avatarInputRef.current?.click()}>
          <span style={styles.rowLabel}>{isAvatarBusy ? 'Uploading…' : 'Change Avatar'}</span>
          <span style={{ ...styles.chevron, fontSize: '24px' }}>👤</span>
        </div>
      </div>

      {/* Middle Group */}
      <div style={styles.group}>
        <div style={styles.row} data-testid="settings-notifications" onClick={() => setSheet('notifications')}>
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
        <div style={{ ...styles.row, ...styles.rowLast }} data-testid="settings-help" onClick={() => setSheet('help')}>
          <span style={styles.rowLabel}>Help Center</span>
          <span style={styles.chevron}>›</span>
        </div>
      </div>

      {/* Bottom Group */}
      <div style={styles.group}>
        <div style={styles.row} data-testid="settings-guidelines" onClick={() => setSheet('guidelines')}><span style={styles.rowLabel}>Community Guidelines</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} data-testid="settings-safety" onClick={() => setSheet('safety')}><span style={styles.rowLabel}>Safety Center</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} data-testid="settings-terms" onClick={() => setSheet('terms')}><span style={styles.rowLabel}>Terms of Use</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} data-testid="settings-about" onClick={() => setSheet('about')}><span style={styles.rowLabel}>About Us</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} data-testid="settings-blocklist" onClick={() => setSheet('blocklist')}><span style={styles.rowLabel}>Block List</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} data-testid="settings-clear-cache" onClick={() => void handleClearCache()}><span style={styles.rowLabel}>Clear Cache</span><span style={styles.chevron}>›</span></div>

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

        <div style={styles.row} data-testid="settings-export" onClick={() => void handleExportData()}>
          <span style={styles.rowLabel}>
            {isExporting ? 'Preparing your data...' : 'Download my data'}
          </span>
          <span style={styles.chevron}>›</span>
        </div>

        <Link href="/privacy" style={{ ...styles.row, textDecoration: 'none' }}>
          <span style={styles.rowLabel}>Privacy &amp; Terms</span>
          <span style={styles.chevron}>›</span>
        </Link>

        <div style={styles.row} data-testid="settings-account" onClick={() => setSheet('account')}>
          <span style={styles.rowLabel}>Account</span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={{ ...styles.row, ...styles.rowLast }} data-testid="settings-privacy" onClick={() => setSheet('privacy')}>
          <span style={styles.rowLabel}>Privacy Control</span>
          <span style={styles.chevron}>›</span>
        </div>
      </div>

      {/* Sign Out */}
      <div style={styles.group}>
        <div style={{ ...styles.row, ...styles.rowLast }} onClick={() => void handleSignOut()}>
          <span style={{ ...styles.rowLabel, ...styles.signOutText }}>
            {isSigningOut ? 'Signing Out...' : 'Sign Out'}
          </span>
        </div>
      </div>

      {/* Danger zone — deletion now lives behind a typed confirmation sheet. */}
      <div style={styles.group}>
        <div style={{ ...styles.row, ...styles.rowLast }} data-testid="settings-delete" onClick={() => setSheet('delete')}>
          <span style={{ ...styles.rowLabel, color: '#EF4444' }}>Delete Account</span>
          <span style={styles.chevron}>›</span>
        </div>
      </div>

      {/* Shared sheets (Edit / Account / Delete / Notifications / Privacy /
          Block List / the five legal documents). */}
      {sheet && (
        <BottomSheet
          title={sheetTitle(sheet)}
          testId={`settings-sheet-${sheet}`}
          onClose={closeSheet}
          busy={false}
        >
          {sheet === 'edit' && (
            <EditProfileSheet
              onClose={closeSheet}
              onSaved={() => undefined}
              onToast={showToast}
            />
          )}
          {sheet === 'account' && <AccountSheet onToast={showToast} />}
          {sheet === 'delete' && (
            <DeleteAccountSheet
              onClose={closeSheet}
              onToast={showToast}
              onDeleted={() => {
                // The session no longer exists; send the member to the landing page.
                router.replace('/');
              }}
            />
          )}
          {sheet === 'notifications' && (
            <NotificationsSheet onToast={showToast} />
          )}
          {sheet === 'privacy' && <PrivacySheet onToast={showToast} />}
          {sheet === 'blocklist' && <BlockListSheet onToast={showToast} />}
          {isLegalId(sheet) && <LegalSheet docId={sheet} />}
        </BottomSheet>
      )}

      {/* Interface language sheet. Searchable, because the catalogue is ~50
          languages rather than the four this screen used to hard-code. */}
      {isLangModalOpen && (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="Select language">
          <div style={styles.modalBox}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Select Language</div>
              <button
                style={styles.closeBtn}
                onClick={() => {
                  setIsLangModalOpen(false);
                  setLangQuery('');
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <input
              type="search"
              data-testid="language-modal-search"
              autoComplete="off"
              placeholder="Search languages…"
              aria-label="Search languages"
              value={langQuery}
              onChange={(event) => setLangQuery(event.target.value)}
              style={styles.langSearch}
            />

            <div style={styles.langList}>
              {visibleLanguages.length === 0 && (
                <p data-testid="language-modal-empty" style={styles.langEmpty}>
                  No language matches “{langQuery}”.
                </p>
              )}

              {visibleLanguages.map((entry) => {
                const isActive = language === entry.code;
                return (
                  <div
                    key={entry.code}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isActive}
                    data-testid={`language-modal-option-${entry.code}`}
                    style={{ ...styles.langItem, ...(isActive ? styles.langItemActive : {}) }}
                    onClick={() => handleLanguageSelect(entry.code)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleLanguageSelect(entry.code);
                      }
                    }}
                  >
                    <span style={{ display: 'block', fontWeight: 600 }}>{entry.nativeName}</span>
                    {/* Hidden when the endonym is already the English name. */}
                    {entry.nativeName !== entry.englishName && (
                      <span style={styles.langItemSub}>{entry.englishName}</span>
                    )}
                  </div>
                );
              })}
            </div>

            <p style={styles.langNote}>
              {LANGUAGES.length} languages · translations are machine-generated and being improved
            </p>
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

      <Toast toast={toast} />

      {cropperSrc && (
        <PhotoCropperModal
          src={cropperSrc}
          shape="circle"
          onCancel={() => setCropperSrc(null)}
          onSave={(dataUrl) => void handleCroppedAvatar(dataUrl)}
        />
      )}

    </div>
  );
}
