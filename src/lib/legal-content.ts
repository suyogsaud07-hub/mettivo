/**
 * The text behind Settings → Help Center, Community Guidelines, Safety Center,
 * Terms of Use and About Us.
 *
 * One module, one shape (`LegalDoc`), rendered by a single sheet. Keeping the
 * copy out of the components means adding a section never means touching layout,
 * and the five documents cannot drift into five different visual treatments.
 *
 * These are plain typed paragraphs rather than a markdown parser: a second
 * dependency and an HTML-injection surface is not worth it for static copy.
 */

export type LegalDocId = 'help' | 'guidelines' | 'safety' | 'terms' | 'about';

export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalDoc {
  id: LegalDocId;
  title: string;
  subtitle: string;
  sections: LegalSection[];
}

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  help: {
    id: 'help',
    title: 'Help Center',
    subtitle: 'Answers to the questions members ask most.',
    sections: [
      {
        heading: 'Getting started',
        body: [
          'Complete your profile — a display name, a photo and a short bio — so other members have something to respond to.',
          'Use Discover to browse members who match your preferences, and Likes to see who has shown interest in you.',
        ],
      },
      {
        heading: 'Matching and messaging',
        body: [
          'A like becomes a match when the other member likes you back. Matches can message each other freely.',
          'You can unmatch or block anyone at any time from their profile or from a conversation.',
        ],
      },
      {
        heading: 'Your account',
        body: [
          'Change your photo, name and details under Settings → Edit Profile and Settings → Change Avatar.',
          'Download everything we hold about you from Settings → Download my data, or delete your account from Settings → Delete Account.',
        ],
      },
      {
        heading: 'Still stuck?',
        body: [
          'If something is not working, tell us what you expected and what happened instead. Reports about a specific member are best made from their profile so we have the context attached.',
        ],
      },
    ],
  },

  guidelines: {
    id: 'guidelines',
    title: 'Community Guidelines',
    subtitle: 'What we expect from everyone on Mettivo.',
    sections: [
      {
        heading: 'Be real',
        body: [
          'Use your own photos and describe yourself honestly. One person, one account.',
          'Impersonating someone else, or presenting a fake age, is not allowed.',
        ],
      },
      {
        heading: 'Be kind',
        body: [
          'Treat every member with respect. Disagreement is fine; cruelty is not.',
          'Harassment, hate speech, threats and sexual content involving minors have no place here and will be removed.',
        ],
      },
      {
        heading: 'Be safe',
        body: [
          'Never send money to someone you met here. Scams and financial fraud are prohibited.',
          'Do not share another person’s private information without their consent.',
        ],
      },
      {
        heading: 'What happens when a rule is broken',
        body: [
          'We may warn, suspend or remove an account. Every moderation action is recorded in an audit log.',
          'Serious cases — threats of violence, child safety, fraud — are removed immediately.',
        ],
      },
    ],
  },

  safety: {
    id: 'safety',
    title: 'Safety Center',
    subtitle: 'Practical advice for meeting people safely.',
    sections: [
      {
        heading: 'Before you meet',
        body: [
          'Get to know someone in the app first. A video call is a low-pressure way to confirm who you are talking to.',
          'Tell a friend or family member where you are going, when, and who you are meeting.',
        ],
      },
      {
        heading: 'Meeting in person',
        body: [
          'Meet in a public place for the first few dates, and arrange your own transport so you can leave whenever you want.',
          'Stay sober enough to make clear decisions, and keep your phone charged.',
        ],
      },
      {
        heading: 'Protect your information',
        body: [
          'Never share your financial details, one-time codes, or passwords. Mettivo will never ask for them.',
          'Be wary of anyone who quickly asks to move the conversation off the app or asks for money.',
        ],
      },
      {
        heading: 'If something feels wrong',
        body: [
          'Trust your instincts. It is always fine to end a conversation or a date early.',
          'Report the member and block them. Blocking stops all further contact.',
        ],
      },
    ],
  },

  terms: {
    id: 'terms',
    title: 'Terms of Use',
    subtitle: 'The rules for using Mettivo, including eligibility and conduct.',
    sections: [
      {
        heading: '1. Eligibility',
        body: [
          'You must be 18 years or older to use Mettivo. You confirm this when you create an account.',
          'Accounts found to belong to anyone under 18 are removed immediately, without notice.',
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
          'Prohibited: harassment or hate speech, sexual content involving minors, threats of violence, scams and financial fraud, solicitation, spam, and sharing another person’s private information without consent.',
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
          'You keep ownership of the content you post. You grant Mettivo the licence needed to operate the service.',
          'This licence ends when you delete your account, other than for backups that expire on their normal cycle.',
        ],
      },
      {
        heading: '6. Ending your use',
        body: [
          'You may delete your account at any time from Settings → Delete Account. Deletion is immediate and irreversible.',
          'See the Privacy Notice for exactly what is erased.',
        ],
      },
      {
        heading: '7. Disclaimers',
        body: [
          'We work to keep Mettivo available and safe, but the service is provided as-is without warranties.',
          'We do not conduct criminal background checks. You are responsible for your own decisions about meeting people.',
        ],
      },
    ],
  },

  about: {
    id: 'about',
    title: 'About Us',
    subtitle: 'Why Mettivo exists.',
    sections: [
      {
        heading: 'Our purpose',
        body: [
          'Mettivo is a place for genuine connection — friendship, dating, or something in between. The name is a promise: your next connection.',
          'We built it for people in Nepal first, and it grows outward from there.',
        ],
      },
      {
        heading: 'How we build',
        body: [
          'Privacy is designed in, not bolted on. Your exact date of birth is never shown, and access is enforced in the database itself.',
          'You are always in control: export your data or delete your account at any time, from Settings.',
        ],
      },
      {
        heading: 'A welcome',
        body: [
          'This product exists because someone wrote a welcome letter to every member who arrived. You can read it any time from the landing page.',
        ],
      },
    ],
  },
};

/** The titles shown on the settings rows, keyed by document. */
export const LEGAL_DOC_TITLES: Record<LegalDocId, string> = {
  help: 'Help Center',
  guidelines: 'Community Guidelines',
  safety: 'Safety Center',
  terms: 'Terms of Use',
  about: 'About Us',
};
