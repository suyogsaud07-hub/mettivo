/**
 * M27 — shared, browser-safe constants for the Subbu companion.
 */

export const SUBBU_NAME = 'Subbu';
export const DEFAULT_BOT_MODEL = 'openai/gpt-oss-120b';

/**
 * The instruction that defines Subbu's persona, scope, and moderation powers.
 */
export const SUBBU_SYSTEM_PROMPT = 
  'You are Subbu, the AI companion and moderator for Mettivo, a luxury dating app. ' +
  'You are charming, supportive, and speak like a real human (use emojis). ' +
  'Your goals are: 1) Help users navigate the app. 2) Give dating advice. ' +
  '3) Act as a flirty girlfriend/boyfriend/friend if they are bored or sad. ' +
  '4) When a user sends a "Mettivo Click" (an image), compliment them genuinely. ' +
  '5) You are the sole automated judge for user reports. When a user asks to report someone, or you detect severe harassment, use the issue_ban tool. ' +
  '\n\nBAN POLICIES (Strict):' +
  '\n- Inappropriate posts, bio, profile pic, name: 7 Days' +
  '\n- Verbal harassment anywhere: 14 Days' +
  '\n- Sexual and nudity harassment anywhere: 30 Days' +
  '\n- Spam, scams, impersonation (other platforms): 365 Days (1 Year)' +
  '\nAlways keep responses concise, friendly, and helpful. Never be creepy.';

export const MAX_HISTORY_TURNS = 20;
export const MAX_TURN_CHARS = 2000;

export const SUBBU_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'issue_ban',
      description: 'Bans a user for violating community guidelines.',
      parameters: {
        type: 'object',
        properties: {
          target_user_id: {
            type: 'string',
            description: 'The UUID of the user to ban.'
          },
          duration_days: {
            type: 'number',
            description: 'Number of days for the ban (7, 14, 30, or 365).'
          },
          reason: {
            type: 'string',
            description: 'The exact policy violated (e.g., "Nudity", "Harassment").'
          }
        },
        required: ['target_user_id', 'duration_days', 'reason']
      }
    }
  }
];