'use client';

import { intentionLabel } from '@/lib/profile-options';

/**
 * The "User Details" tab body, shared by the own dashboard and the public
 * profile view.
 *
 * The fields are identical on both surfaces; only editability differs. When
 * `onEdit` is supplied each row becomes a button that opens the editor sheet.
 * Contact (email / phone) is passed in ONLY for the member's own profile and is
 * never rendered for anybody else, by design.
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
  label: string;
  value: string;
  key: ProfileDetailKey;
}

function PencilIcon() {
  return (
    <svg
      className="pf-detail-edit"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export default function ProfileDetails({ data, onEdit, contact }: ProfileDetailsProps) {
  const aboutRows: InfoRowConfig[] = [
    { label: 'Age', value: data.age ? `${data.age} years` : 'Not set', key: 'age' },
    { label: 'Gender', value: data.gender || 'Not set', key: 'gender' },
    {
      label: 'Looking for',
      value: data.looking_for?.join(', ') || 'Not set',
      key: 'looking_for',
    },
  ];

  const moreRows: InfoRowConfig[] = [
    {
      label: 'Intention',
      value: data.intention ? intentionLabel(data.intention) : 'Not set',
      key: 'intention',
    },
    { label: 'Drinking', value: data.drinking || 'Not set', key: 'drinking' },
    { label: 'Smoking', value: data.smoking || 'Not set', key: 'smoking' },
    { label: 'Religion', value: data.religion || 'Not set', key: 'religion' },
    { label: 'Politics', value: data.politics || 'Not set', key: 'politics' },
    { label: 'Pets', value: data.pets?.join(', ') || 'Not set', key: 'pets' },
    {
      label: 'Personality',
      value: data.personality?.join(', ') || 'Not set',
      key: 'personality',
    },
  ];

  const renderRow = (row: InfoRowConfig) =>
    onEdit ? (
      <button
        key={row.key}
        type="button"
        onClick={() => onEdit(row.key)}
        aria-label={`Edit ${row.label}`}
        className="pf-detail-row"
      >
        <span className="pf-detail-label">{row.label}</span>
        <span className="pf-detail-value">
          <span>{row.value}</span>
          <PencilIcon />
        </span>
      </button>
    ) : (
      <div key={row.key} className="pf-detail-row">
        <span className="pf-detail-label">{row.label}</span>
        <span className="pf-detail-value">{row.value}</span>
      </div>
    );

  return (
    <div>
      <section className="pf-detail-card">
        <div className="pf-detail-head">
          <h2 className="pf-detail-title">About Me</h2>
        </div>
        {onEdit && <p className="pf-detail-hint">Tap any row to edit it.</p>}
        {aboutRows.map(renderRow)}
      </section>

      <section className="pf-detail-card">
        <div className="pf-detail-head">
          <h2 className="pf-detail-title">More About Me</h2>
        </div>
        {moreRows.map(renderRow)}
      </section>

      <section className="pf-detail-card">
        <div className="pf-detail-head">
          <h2 className="pf-detail-title">Interests &amp; Hobbies</h2>
          {onEdit && (
            <button
              type="button"
              className="pf-link-btn"
              onClick={() => onEdit('hobbies')}
            >
              Edit
            </button>
          )}
        </div>
        {data.hobbies && data.hobbies.length > 0 ? (
          <div className="pf-chips">
            {data.hobbies.map((hobby) => (
              <span key={hobby} className="pf-chip">
                {hobby}
              </span>
            ))}
          </div>
        ) : (
          <p className="pf-muted">No interests or hobbies added yet.</p>
        )}
      </section>

      {contact && onEdit && (
        <section className="pf-detail-card">
          <div className="pf-detail-head">
            <h2 className="pf-detail-title">Contact</h2>
          </div>
          <button
            type="button"
            onClick={() => onEdit('email')}
            aria-label="Edit Email"
            className="pf-detail-row"
          >
            <span className="pf-detail-label">Email</span>
            <span className="pf-detail-value">
              <span>{contact.email || 'Not set'}</span>
              <PencilIcon />
            </span>
          </button>
          <button
            type="button"
            onClick={() => onEdit('phone')}
            aria-label="Edit Phone"
            className="pf-detail-row"
          >
            <span className="pf-detail-label">Phone</span>
            <span className="pf-detail-value">
              <span>{contact.phone || 'Not set'}</span>
              <PencilIcon />
            </span>
          </button>
        </section>
      )}
    </div>
  );
}
