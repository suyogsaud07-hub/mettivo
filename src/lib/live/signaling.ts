/**
 * Mettivo Live — the signaling vocabulary, with no React and no network in it.
 *
 * WHY THIS MODULE EXISTS APART FROM THE HOOK
 *   The pairing protocol is the part of "Mettivo Live" that is easiest to get
 *   subtly wrong (two peers both offering, an answer that arrives after the
 *   caller gave up, a message addressed to someone else acted on by mistake).
 *   Keeping the message shapes, the addressing rule and the initiator tie-break
 *   as pure functions means they can be unit-tested without a camera, a peer
 *   connection or a Supabase channel.
 *
 * NO DATABASE
 *   Pairing is done entirely over Supabase Realtime broadcast + presence on one
 *   authenticated channel. Nothing about a live call is persisted: a member's
 *   peer id lives only in memory for the duration of the session, and the only
 *   thing exchanged about a partner is their COUNTRY — never a name, age or id
 *   from `profiles`. That is the anonymity guarantee the UI promises.
 */

/** The single Realtime channel every live client joins while in the pool. */
export const LIVE_CHANNEL_NAME = 'mettivo-live';

/**
 * Public STUN only. There is no TURN server, so a call between two members
 * behind symmetric NATs may fail to connect — an honest, documented limitation
 * rather than a silent hang.
 */
export const LIVE_ICE_SERVERS: readonly RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** The events that travel over the `mettivo-live` channel. */
export type LiveEvent =
  | 'seek'
  | 'available'
  | 'offer'
  | 'answer'
  | 'ice'
  | 'bye'
  | 'chat';

const LIVE_EVENTS: readonly LiveEvent[] = [
  'seek',
  'available',
  'offer',
  'answer',
  'ice',
  'bye',
  'chat',
];

/** What a member announces about themselves while in the pool. */
export interface LivePresence {
  peerId: string;
  /** ISO-ish country of the member, for the flag. Never a name. */
  country: string;
}

export interface SeekMessage {
  from: string;
  country: string;
}

export interface AvailableMessage {
  from: string;
  to: string;
  country: string;
}

export interface OfferMessage {
  from: string;
  to: string;
  country: string;
  sdp: RTCSessionDescriptionInit;
}

export interface AnswerMessage {
  from: string;
  to: string;
  sdp: RTCSessionDescriptionInit;
}

export interface IceMessage {
  from: string;
  to: string;
  candidate: RTCIceCandidateInit;
}

export interface ByeMessage {
  from: string;
  to: string;
}

export interface ChatSignalMessage {
  from: string;
  to: string;
  text: string;
  at: number;
}

/** A chat line as the drawer renders it. */
export interface LiveChatMessage {
  id: string;
  text: string;
  mine: boolean;
  at: number;
}

/** A fresh, unguessable peer id for one live session. */
export function makePeerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for the rare environment without crypto.randomUUID (older WebViews).
  return `peer-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** True when the event name is one of ours, so unknown traffic is ignored. */
export function isLiveEvent(value: unknown): value is LiveEvent {
  return typeof value === 'string' && (LIVE_EVENTS as readonly string[]).includes(value);
}

/**
 * The tie-break that stops two peers offering to each other at once.
 *
 * Both members broadcast `seek` when they tap Start, so each receives the
 * other's seek. If both then answered, the pair would glare (two offers, two
 * answerers, no call). The rule: a member only responds to a seek whose sender
 * has the LOWER id. Exactly one of any two peers satisfies that, so exactly one
 * becomes the answerer and the other is the caller.
 */
export function shouldAnswerSeek(myPeerId: string, seekerPeerId: string): boolean {
  if (!myPeerId || !seekerPeerId || myPeerId === seekerPeerId) return false;
  return seekerPeerId < myPeerId;
}

/** True when a directly-addressed message (offer/answer/ice/chat) is for me. */
export function isAddressedTo(
  message: { to?: unknown },
  myPeerId: string
): boolean {
  return message.to === myPeerId;
}

const FLAG_BASE = 0x1f1e6;

/** Country names/aliases → ISO 3166-1 alpha-2, for the common cases. */
const COUNTRY_CODES: Record<string, string> = {
  nepal: 'NP',
  india: 'IN',
  bhutan: 'BT',
  bangladesh: 'BD',
  'sri lanka': 'LK',
  pakistan: 'PK',
  china: 'CN',
  japan: 'JP',
  'south korea': 'KR',
  korea: 'KR',
  thailand: 'TH',
  malaysia: 'MY',
  singapore: 'SG',
  indonesia: 'ID',
  philippines: 'PH',
  vietnam: 'VN',
  australia: 'AU',
  'new zealand': 'NZ',
  'united states': 'US',
  usa: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  canada: 'CA',
  mexico: 'MX',
  brazil: 'BR',
  france: 'FR',
  germany: 'DE',
  italy: 'IT',
  spain: 'ES',
  portugal: 'PT',
  netherlands: 'NL',
  belgium: 'BE',
  switzerland: 'CH',
  sweden: 'SE',
  norway: 'NO',
  denmark: 'DK',
  finland: 'FI',
  ireland: 'IE',
  poland: 'PL',
  russia: 'RU',
  ukraine: 'UA',
  turkey: 'TR',
  'saudi arabia': 'SA',
  'united arab emirates': 'AE',
  uae: 'AE',
  qatar: 'QA',
  israel: 'IL',
  egypt: 'EG',
  'south africa': 'ZA',
  nigeria: 'NG',
  kenya: 'KE',
  ghana: 'GH',
  argentina: 'AR',
  chile: 'CL',
  colombia: 'CO',
  peru: 'PE',
};

/**
 * A flag emoji for a member's country, from either a two-letter code (`NP`) or
 * a country name (`Nepal`). Unknown or empty values get a neutral globe, so the
 * UI never renders a wrong flag rather than none.
 */
export function countryFlagEmoji(country: string | null | undefined): string {
  if (!country) return '🌐';
  const trimmed = country.trim();
  if (!trimmed) return '🌐';

  const code = /^[a-zA-Z]{2}$/.test(trimmed)
    ? trimmed.toUpperCase()
    : COUNTRY_CODES[trimmed.toLowerCase()];

  if (!code) return '🌐';

  return String.fromCodePoint(
    FLAG_BASE + (code.charCodeAt(0) - 65),
    FLAG_BASE + (code.charCodeAt(1) - 65)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The shared shape every signal must have: an object with a non-empty `from`.
 *
 * Realtime delivers whatever the sender broadcast, so nothing here is trusted
 * until it has been shaped. A payload that fails validation is dropped by the
 * reader that needed it, never half-applied.
 */
interface Envelope {
  record: Record<string, unknown>;
  from: string;
}

function readEnvelope(payload: unknown): Envelope | null {
  if (!isRecord(payload)) return null;
  const from = readString(payload, 'from');
  if (!from) return null;
  return { record: payload, from };
}

/** Reads a broadcast `seek`: "I am available, here is my country". */
export function readSeek(payload: unknown): SeekMessage | null {
  const envelope = readEnvelope(payload);
  if (!envelope) return null;
  return { from: envelope.from, country: readString(envelope.record, 'country') };
}

/** Reads a broadcast `available`: "I accept your seek, pair with me". */
export function readAvailable(payload: unknown): AvailableMessage | null {
  const envelope = readEnvelope(payload);
  if (!envelope) return null;
  const to = readString(envelope.record, 'to');
  if (!to) return null;
  return { from: envelope.from, to, country: readString(envelope.record, 'country') };
}

function readDescription(
  payload: unknown,
  expectedType: 'offer' | 'answer'
): { from: string; to: string; country: string; sdp: RTCSessionDescriptionInit } | null {
  const envelope = readEnvelope(payload);
  if (!envelope) return null;
  const to = readString(envelope.record, 'to');
  const sdp = envelope.record.sdp;
  if (!to || !isRecord(sdp) || sdp.type !== expectedType) return null;
  return {
    from: envelope.from,
    to,
    country: readString(envelope.record, 'country'),
    sdp: { type: expectedType, sdp: readOptionalString(sdp, 'sdp') ?? undefined },
  };
}

/** Reads a caller's `offer` SDP, addressed to a specific answerer. */
export function readOffer(payload: unknown): OfferMessage | null {
  return readDescription(payload, 'offer');
}

/** Reads an answerer's `answer` SDP, addressed to the caller. */
export function readAnswer(payload: unknown): AnswerMessage | null {
  const description = readDescription(payload, 'answer');
  if (!description) return null;
  return {
    from: description.from,
    to: description.to,
    sdp: description.sdp,
  };
}

/** Reads a single trickle ICE candidate. */
export function readIce(payload: unknown): IceMessage | null {
  const envelope = readEnvelope(payload);
  if (!envelope) return null;
  const to = readString(envelope.record, 'to');
  const candidate = envelope.record.candidate;
  if (!to || !isRecord(candidate)) return null;
  const value = readOptionalString(candidate, 'candidate');
  if (!value) return null;
  return {
    from: envelope.from,
    to,
    candidate: {
      candidate: value,
      sdpMid: readOptionalString(candidate, 'sdpMid'),
      sdpMLineIndex:
        typeof candidate.sdpMLineIndex === 'number' ? candidate.sdpMLineIndex : null,
      usernameFragment: readOptionalString(candidate, 'usernameFragment'),
    },
  };
}

/** Reads a `bye`: the partner left, so tear the call down. */
export function readBye(payload: unknown): ByeMessage | null {
  const envelope = readEnvelope(payload);
  if (!envelope) return null;
  const to = readString(envelope.record, 'to');
  if (!to) return null;
  return { from: envelope.from, to };
}

/** Reads an in-call chat line. */
export function readChat(payload: unknown): ChatSignalMessage | null {
  const envelope = readEnvelope(payload);
  if (!envelope) return null;
  const to = readString(envelope.record, 'to');
  const text = readString(envelope.record, 'text').trim();
  if (!to || !text) return null;
  const at = envelope.record.at;
  return {
    from: envelope.from,
    to,
    text,
    at: typeof at === 'number' && Number.isFinite(at) ? at : Date.now(),
  };
}
