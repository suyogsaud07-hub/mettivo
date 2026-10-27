import Link from 'next/link';
import type {
  ProfileCompletion,
  ProfileCompletionItem,
} from '@/lib/profile-completion';
import type { ProfileSectionStage } from '@/lib/onboarding-steps';

interface ProfileCompletionPanelProps {
  completion: ProfileCompletion;
}

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Ring({ percentage }: { percentage: number }) {
  const offset = CIRCUMFERENCE - (percentage / 100) * CIRCUMFERENCE;
  return (
    <svg
      className="pf-ring"
      viewBox="0 0 64 64"
      role="img"
      aria-label={`Profile ${percentage}% complete`}
    >
      <circle cx="32" cy="32" r={RADIUS} fill="none" stroke="#34283f" strokeWidth="5" />
      <circle
        cx="32"
        cy="32"
        r={RADIUS}
        fill="none"
        stroke="#d8b38a"
        strokeWidth="5"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 32 32)"
      />
      <text
        x="32"
        y="36"
        textAnchor="middle"
        fill="#f2e9e4"
        fontSize="13"
        fontWeight="700"
      >
        {percentage}
      </text>
    </svg>
  );
}

function SectionRow({ item }: { item: ProfileCompletionItem }) {
  return (
    <li className="pf-section-row" data-testid={`profile-section-${item.sectionId}`}>
      <span
        className={`pf-section-mark${item.complete ? ' is-complete' : ''}`}
        aria-hidden="true"
      >
        {item.complete ? '✓' : '+'}
      </span>
      <span className="pf-section-copy">
        <span className="pf-section-name">{item.title}</span>
        <span className="pf-section-meta">
          {item.complete ? 'Complete' : item.description}
        </span>
      </span>
      <Link
        className="pf-section-action"
        href={item.href}
        aria-label={`${item.complete ? 'Edit' : 'Add'} ${item.title}`}
        data-testid={`profile-section-link-${item.sectionId}`}
      >
        {item.complete ? 'Edit' : 'Add'}
      </Link>
    </li>
  );
}

function SectionGroup({
  title,
  note,
  stage,
  items,
}: {
  title: string;
  note: string;
  stage: ProfileSectionStage;
  items: ProfileCompletionItem[];
}) {
  const matching = items.filter((item) => item.stage === stage);
  return (
    <section className="pf-section-group" aria-label={title}>
      <div className="pf-section-group-head">
        <h3 className="pf-section-group-title">{title}</h3>
        <span className="pf-section-group-note">{note}</span>
      </div>
      <ul className="pf-section-list">
        {matching.map((item) => (
          <SectionRow key={item.sectionId} item={item} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The dashboard's single destination for profile completeness.
 *
 * It is a renderer only: every number comes from `buildProfileCompletion`, which
 * derives from the persisted profile row. Reloading cannot show a stale
 * percentage because the value is recomputed, never stored.
 */
export default function ProfileCompletionPanel({ completion }: ProfileCompletionPanelProps) {
  const next = completion.nextRecommended[0];

  return (
    <div className="pf-overview pf-overview-single" id="profile-completion">
      <section className="pf-card pf-completion" aria-labelledby="profile-strength-title">
        <Ring percentage={completion.percentage} />
        <div className="pf-completion-copy">
          <div className="pf-completion-heading-row">
            <h2 className="pf-completion-title" id="profile-strength-title">
              Profile completeness
            </h2>
            <span className="pf-completion-count" data-testid="profile-completion-count">
              {completion.completedCount} of {completion.totalCount}
            </span>
          </div>
          <p className="pf-completion-text" data-testid="profile-completion-percentage">
            {completion.isComplete
              ? 'Every section is complete. Your profile is fully expressed.'
              : `${completion.percentage}% complete. ${completion.remainingCount} ${
                  completion.remainingCount === 1 ? 'section' : 'sections'
                } left to enrich your profile.`}
          </p>
          <div className="pf-completion-bar" aria-hidden="true">
            <span style={{ width: `${completion.percentage}%` }} />
          </div>
        </div>
        {completion.isComplete ? (
          <span className="pf-completion-badge">Complete</span>
        ) : next ? (
          <Link className="pf-btn pf-btn-small pf-btn-primary" href={next.href}>
            Continue with {next.title}
          </Link>
        ) : null}
      </section>

      {!completion.isComplete && completion.nextRecommended.length > 0 && (
        <section className="pf-card pf-next-card" aria-labelledby="profile-next-title">
          <div className="pf-next-head">
            <h2 className="pf-next-title" id="profile-next-title">
              Continue building
            </h2>
            <span className="pf-next-note">Recommended, never required</span>
          </div>
          <ul className="pf-next-list">
            {completion.nextRecommended.map((item) => (
              <li key={item.sectionId}>
                <Link className="pf-next-link" href={item.href}>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.recommendation}</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pf-card pf-sections-card" id="profile-sections" aria-labelledby="profile-sections-title">
        <div className="pf-sections-head">
          <h2 className="pf-sections-title" id="profile-sections-title">
            Your profile sections
          </h2>
          <p className="pf-sections-subtitle">
            Every section stays available. Add what feels right, whenever you like.
          </p>
        </div>
        <div className="pf-section-groups">
          <SectionGroup
            title="Your foundation"
            note="Used for discovery"
            stage="essential"
            items={completion.items}
          />
          <SectionGroup
            title="Complete your profile"
            note="Progressive depth"
            stage="progressive"
            items={completion.items}
          />
        </div>
      </section>
    </div>
  );
}
