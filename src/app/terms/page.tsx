import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'The rules for using Mettivo, including eligibility, conduct and moderation.',
};

const SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: '1. Eligibility',
    body: [
      'You must be 18 years or older to use Mettivo. You confirm this when you create an account.',
      'Accounts found to belong to anyone under 18 are removed immediately, without notice.',
      'You must not use Mettivo if you are barred from doing so under the law that applies to you.',
    ],
  },
  {
    heading: '2. Your account',
    body: [
      'You are responsible for the accuracy of your profile and for keeping access to your email or phone number secure.',
      'One person, one account. Impersonation and duplicate accounts are not permitted.',
    ],
  },
  {
    heading: '3. Community conduct',
    body: [
      'Treat other members with respect. Mettivo exists for genuine connection, not for harassment.',
      'The following are prohibited: harassment or hate speech, sexual content involving minors, threats of violence, scams and financial fraud, solicitation, spam, and the sharing of another person’s private information without consent.',
      'Do not post content you do not have the right to share.',
    ],
  },
  {
    heading: '4. Safety tools',
    body: [
      'You can report a profile or a conversation, and block anyone at any time. Blocking prevents further contact.',
      'We review reports and may warn, suspend or remove accounts that break these rules. Every moderation action is logged.',
    ],
  },
  {
    heading: '5. Your content',
    body: [
      'You keep ownership of the content you post. You grant Mettivo the licence needed to operate the service — to store your profile, show it to members you may match with, and deliver your messages.',
      'This licence ends when you delete your account, other than for backups that expire on their normal cycle.',
    ],
  },
  {
    heading: '6. Suspension and removal',
    body: [
      'We may suspend or remove an account that breaks these terms, that we reasonably believe presents a safety risk, or where we are required to by law.',
      'A suspended account cannot post, send messages, or take new actions in the app.',
    ],
  },
  {
    heading: '7. Ending your use',
    body: [
      'You may delete your account at any time from Settings → Delete account. Deletion is immediate and irreversible.',
      'See the Privacy Notice for exactly what is erased.',
    ],
  },
  {
    heading: '8. Disclaimers',
    body: [
      'We work to keep Mettivo available and safe, but the service is provided as-is without warranties.',
      'We do not conduct criminal background checks. You are responsible for your own decisions about meeting people, and we encourage meeting in public places.',
    ],
  },
  {
    heading: '9. Changes',
    body: [
      'We may update these terms as the service develops. Material changes will be surfaced in the app before they take effect.',
    ],
  },
];

export default function TermsPage() {
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
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Terms of Use</h1>
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
          href="/privacy"
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
          Read the Privacy Notice →
        </Link>
      </main>
    </div>
  );
}
