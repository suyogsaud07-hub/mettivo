import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Notice',
  description:
    'What Mettivo collects, why, how long it is kept, and how to export or delete your data.',
};

const SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: '1. Who we are',
    body: [
      'Mettivo is a dating and social connection service operated for users in Nepal.',
      'This notice explains what personal data we hold, why we hold it, and the control you have over it.',
    ],
  },
  {
    heading: '2. What we collect',
    body: [
      'Account data: your email address or phone number, used to sign you in.',
      'Profile data: display name, age, gender, city, country, photos, and the preferences you choose to share.',
      'Activity data: who you like or pass, who you match with, messages you send, and the accounts you block or report.',
      'We do not collect your precise location, your contacts, or your device advertising identifier.',
    ],
  },
  {
    heading: '3. What we deliberately do not expose',
    body: [
      'Your exact date of birth is never shown to other members — only your age is displayed.',
      'Your private content — likes, passes, messages and reports — is readable only by you and, where a report concerns safety, by our moderators.',
      'Access is enforced in the database itself, not only in the interface.',
    ],
  },
  {
    heading: '4. Why we process it',
    body: [
      'To create and secure your account.',
      'To suggest people you may want to meet, based on the preferences you set.',
      'To deliver messages between matched members.',
      'To detect abuse, enforce our rules, and keep members safe.',
    ],
  },
  {
    heading: '5. Who can see it',
    body: [
      'Other members see only your public profile fields and anything you send them directly.',
      'Our moderators can see reports and suspend accounts. Every moderation action is recorded in an audit log.',
      'We do not sell your personal data, and we do not share it with advertisers.',
    ],
  },
  {
    heading: '6. How long we keep it',
    body: [
      'Profile and activity data are kept while your account is open.',
      'When you delete your account, your profile, likes, matches, messages, blocks and reports are erased, and your login is removed. This is immediate and irreversible.',
      'A minimal record that a deletion occurred is retained for moderation integrity; it does not identify you after erasure.',
    ],
  },
  {
    heading: '7. Your rights',
    body: [
      'Access and portability: download a machine-readable copy of your data at any time from Settings → Download my data.',
      'Erasure: delete your account and data at any time from Settings → Delete account.',
      'You may also contact us to ask what we hold about you.',
    ],
  },
  {
    heading: '8. Security',
    body: [
      'All traffic is encrypted in transit over HTTPS.',
      'Data is stored with row level security, so one member cannot read another member’s private rows.',
      'Only a small number of authorised moderators can access report data.',
    ],
  },
  {
    heading: '9. Children',
    body: [
      'Mettivo is strictly for adults. You must confirm that you are 18 or older, and accounts found to belong to minors are removed.',
    ],
  },
  {
    heading: '10. Contact',
    body: [
      'For any privacy request or concern, contact the Mettivo team through the support channel listed in Settings.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0D0A10',
        color: '#F2E9E4',
        paddingBottom: '60px',
      }}
    >
      <header style={{ padding: '20px', borderBottom: '1px solid #29202D' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Privacy Notice</h1>
        <p style={{ fontSize: '12px', color: '#B58A83', marginTop: '6px' }}>
          Mettivo · Your next connection
        </p>
      </header>

      <main
        style={{
          padding: '24px 20px',
          maxWidth: '640px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '22px',
        }}
      >
        {SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color: '#D4B18A',
                margin: '0 0 8px 0',
              }}
            >
              {section.heading}
            </h2>
            {section.body.map((paragraph) => (
              <p
                key={paragraph}
                style={{
                  fontSize: '13px',
                  lineHeight: 1.65,
                  color: '#F2E9E4',
                  margin: '0 0 8px 0',
                }}
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <Link
          href="/profile/settings"
          style={{
            marginTop: '8px',
            alignSelf: 'flex-start',
            backgroundColor: '#1C1822',
            border: '1px solid #4A1828',
            color: '#F2E9E4',
            padding: '12px 24px',
            borderRadius: '30px',
            fontSize: '13px',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          ← Back to settings
        </Link>
      </main>
    </div>
  );
}
