'use client';

import { intentionLabel } from '@/lib/profile-options';

/**
 * The "User Details" tab body, shared by the own dashboard and the public
 * profile view.
 *
 * The fields are identical on both surfaces; the only difference is editability.
 * When `onEdit` is supplied (the member's own profile) each row is a button that
 * opens the editor sheet, and the Interests section gains an Edit affordance.
 * When it is omitted (another member's profile) the same rows render as plain
 * text, so the two views cannot drift apart.
 *
 * Contact (email / phone) is passed in ONLY for the member's own profile. It is
 * never rendered for anybody else, by design — it is not on `public_profiles`.
 */

export type ProfileDetailKey =
  | 'bio'
  | 'age'
  | 'gender'
  | 'looking_for'
  | 'intention'
  | 'drinking'
  | 'smoking'
  | 'religion'
  | 'politics'
  | 'pets'
  | 'personality'
  | 'hobbies'
  | 'email'
  | 'phone';

export interface ProfileDetailsData {
  bio: string | null;
  age: number | null;
  gender: string | null;
  looking_for: string[] | null;
  intention: string | null;
  drinking: string | null;
  smoking: string | null;
  religion: string | null;
  politics: string | null;
  pets: string[] | null;
  personality: string[] | null;
  hobbies: string[] | null;
}

export interface ProfileContact {
  email: string;
  phone: string;
}

export interface ProfileDetailsProps {
  data: ProfileDetailsData;
  onEdit?: (key: ProfileDetailKey) => void;
  /** Own profile only. */
  contact?: ProfileContact;
}

interface InfoRowConfig {
  icon: string;
  label: string;
  value: string;
  key: ProfileDetailKey;
  last?: boolean;
}

export default function ProfileDetails({ data, onEdit, contact }: ProfileDetailsProps) {
  const aboutRows: InfoRowConfig[] = [
    { icon: '📝', label: 'Bio', value: data.bio?.trim() || 'No bio added yet.', key: 'bio' },
    {
      icon: '🎂',
      label: 'Age',
      value: data.age ? `${data.age} years` : 'Not set',
      key: 'age',
    },
    { icon: '👥', label: 'Gender', value: data.gender || 'Not set', key: 'gender' },
    {
      icon: '❤️',
      label: 'Looking for',
      value: data.looking_for?.join(', ') || 'Not set',
      key: 'looking_for',
      last: true,
    },
  ];

  const moreRows: InfoRowConfig[] = [
    {
      icon: '💫',
      label: 'Intention',
      value: data.intention ? intentionLabel(data.intention) : 'Not set',
      key: 'intention',
    },
    { icon: '🍷', label: 'Drinking', value: data.drinking || 'Not set', key: 'drinking' },
    { icon: '🚬', label: 'Smoking', value: data.smoking || 'Not set', key: 'smoking' },
    { icon: '🛐', label: 'Religion', value: data.religion || 'Not set', key: 'religion' },
    { icon: '⚖️', label: 'Politics', value: data.politics || 'Not set', key: 'politics' },
    { icon: '🐾', label: 'Pets', value: data.pets?.join(', ') || 'Not set', key: 'pets' },
    {
      icon: '🧠',
      label: 'Personality',
      value: data.personality?.join(', ') || 'Not set',
      key: 'personality',
      last: true,
    },
  ];

  const renderRow = (row: InfoRowConfig) => (
    <div
      key={row.key}
      style={{ ...styles.infoRow, ...(row.last ? { borderBottom: 'none' } : {}) }}
    >
      <div style={styles.infoLabel}>
        {row.icon} {row.label}
      </div>
      {onEdit ? (
        <button
          type="button"
          onClick={() => onEdit(row.key)}
          aria-label={`Edit ${row.label}`}
          style={styles.infoValueButton}
        >
          <span style={styles.infoValue}>{row.value}</span>
          <span style={styles.editIcon} aria-hidden="true">
            ✏️
          </span>
        </button>
      ) : (
        <div style={styles.infoValue}>{row.value}</div>
      )}
    </div>
  );

  return (
    <div>
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionIcon}>👤</div>
          <div style={styles.sectionTitle}>About Me</div>
        </div>
        {onEdit && <p style={styles.editHint}>Tap any row to edit it.</p>}
        {aboutRows.map(renderRow)}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionIcon}>✨</div>
          <div style={styles.sectionTitle}>More About Me</div>
        </div>
        {moreRows.map(renderRow)}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionIcon}>🎨</div>
          <div style={styles.sectionTitle}>Interests/Hobbies</div>
          {onEdit && (
            <button type="button" style={styles.sectionEditBtn} onClick={() => onEdit('hobbies')}>
              Edit
            </button>
          )}
        </div>
        {data.hobbies && data.hobbies.length > 0 ? (
          <div style={styles.chipWrap}>
            {data.hobbies.map((hobby) => (
              <span key={hobby} style={styles.chip}>
                {hobby}
              </span>
            ))}
          </div>
        ) : (
          <div style={styles.emptyText}>No interests or hobbies added yet.</div>
        )}
      </div>

      {contact && onEdit && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionIcon}>📞</div>
            <div style={styles.sectionTitle}>Contact</div>
          </div>
          <div style={styles.infoRow}>
            <div style={styles.infoLabel}>📧 Email</div>
            <button
              type="button"
              onClick={() => onEdit('email')}
              aria-label="Edit Email"
              style={styles.infoValueButton}
            >
              <span style={styles.infoValue}>{contact.email || 'Not set'}</span>
              <span style={styles.editIcon} aria-hidden="true">
                ✏️
              </span>
            </button>
          </div>
          <div style={{ ...styles.infoRow, borderBottom: 'none' }}>
            <div style={styles.infoLabel}>📱 Phone</div>
            <button
              type="button"
              onClick={() => onEdit('phone')}
              aria-label="Edit Phone"
              style={styles.infoValueButton}
            >
              <span style={styles.infoValue}>{contact.phone || 'Not set'}</span>
              <span style={styles.editIcon} aria-hidden="true">
                ✏️
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  section: {
    margin: '0 20px 24px 20px',
    backgroundColor: '#211A28',
    borderRadius: '20px',
    padding: '20px',
    border: '1px solid #34283F',
  },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' },
  sectionIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #4A1828, #D8B38A)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '16px',
  },
  sectionTitle: { fontSize: '16px', fontWeight: 700, color: '#EAE2F0' },
  sectionEditBtn: {
    marginLeft: 'auto',
    background: 'none',
    border: '1px solid #D8B38A',
    color: '#D8B38A',
    borderRadius: '20px',
    padding: '6px 16px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid #34283F',
  },
  infoLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '14px',
    color: '#B58A83',
    fontWeight: 500,
  },
  infoValueButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'none',
    border: 'none',
    padding: '4px',
    margin: 0,
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'right' as const,
    maxWidth: '64%',
  },
  infoValue: {
    fontSize: '14px',
    color: '#EAE2F0',
    fontWeight: 600,
    textAlign: 'right' as const,
    wordBreak: 'break-word' as const,
  },
  editIcon: { fontSize: '12px', opacity: 0.6, flexShrink: 0 },
  editHint: { fontSize: '12px', color: '#B58A83', marginTop: '-8px', marginBottom: '16px' },
  chipWrap: { display: 'flex', flexWrap: 'wrap' as const, gap: '8px' },
  chip: {
    backgroundColor: '#241C2C',
    color: '#D8B38A',
    border: '1px solid #4A1828',
    borderRadius: '20px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 600,
  },
  emptyText: { fontSize: '13px', color: '#B58A83' },
};
