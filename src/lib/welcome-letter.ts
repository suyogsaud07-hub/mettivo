/**
 * The Welcome Letter from the founder.
 *
 * WHY A CONFIG FILE
 *   The letter is authored copy, not application logic. Keeping it in one plain
 *   TypeScript constant means it can be edited by hand in VS Code (or by anyone
 *   comfortable in a text editor) without touching a page component, and the
 *   landing-page trigger and the `/letter` route can never disagree about what
 *   the letter says — they both read this object.
 *
 * EDITING THE LETTER
 *   Change the values below. `salutation`, `body` and `signature` are rendered in
 *   order: the greeting, one paragraph per array entry, the sign-off, then the
 *   signature. Add or remove paragraphs freely; the page maps over `body`.
 *
 *   Do NOT move the strings into `src/lib/locale-data.ts`: that file is generated
 *   for the UI's fixed 18 keys, and the letter is deliberately a single authored
 *   voice rather than 50 translations of it.
 */

export interface WelcomeLetter {
  /** Small label above the letter, also used as the document title. */
  heading: string;
  /** The greeting line, e.g. "Dear users,". */
  salutation: string;
  /** One entry per paragraph. */
  body: string[];
  /** The sign-off line, e.g. "-Founder". */
  closing: string;
  /** Who signed it. */
  signature: string;
  /** Optional voluntary donation appeal rendered at the end of the letter. */
  donation?: {
    heading: string;
    body: string[];
    ctaLabel: string;
    ctaHref: string;
  };
}

export const WELCOME_LETTER: WelcomeLetter = {
  heading: 'A Welcome Letter from the Founder',
  salutation: 'Dear User,',
  body: [
    'First of all, welcome to METTIVO! ❤️',
    "We're genuinely happy you're here.",
    "Whether you're here to find true love, meet someone special, make new friends, discover like-minded people, or simply explore and enjoy the experience — we're glad you found us.",
    'So, take a breath, relax, explore, and enjoy yourself!',
    "You never know. Your next favorite person, your best friend, or even your forever person might be just one connection away.",
    "And hey, don't put too much pressure on yourself. Be yourself, be curious, have fun, and let things happen naturally.",
    'A little message from us:',
    '• Explore new people and discover new connections.',
    '• Enjoy conversations and make beautiful memories.',
    '• Be genuine. Be kind. Be respectful.',
    '• Don\'t be afraid to say hello!',
    '• And most importantly, have fun. You\'ve got this! ❤️',
    'A small request from our team:',
    'METTIVO is built for people, not just profiles.',
    'Please remember that there is a real person behind every profile.',
    '• Respect everyone\'s boundaries and personal choices.',
    '• Don\'t harass, pressure, threaten, or disrespect anyone.',
    '• Don\'t spam or send unwanted messages.',
    '• Be honest about who you are.',
    '• Maintain good manners and discipline.',
    '• Make this a comfortable and enjoyable place for everyone.',
    'A little kindness can make someone\'s day. Let\'s make METTIVO a place where people actually enjoy being here.',
    'Help us keep METTIVO alive.',
    'Building and maintaining a platform like METTIVO takes time, effort, technology, and resources.',
    'If you enjoy being part of our community and would like to support us, consider making a small voluntary donation.',
    'Your contribution helps us maintain, improve, and keep METTIVO running for everyone.',
    'There is absolutely no pressure. Your presence and participation already mean a lot to us.',
    'Thank you for being here.',
    "We're building something special, and we're happy to have you as part of it.",
    'Explore more. Smile more. Connect genuinely. Have fun. And who knows... maybe your next beautiful story starts here.',
  ],
  closing: 'With love,',
  signature: 'The METTIVO Founder & Team',
  donation: {
    heading: 'Support METTIVO',
    body: [
      'METTIVO is built for people, not for profit. If this letter made you smile, consider a small voluntary donation to help keep our community running.',
      'There is absolutely no pressure — your presence here already means everything to us.',
    ],
    ctaLabel: 'Donate to Mettivo',
    ctaHref: '/donate',
  },
};
