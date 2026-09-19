/**
 * Phone helpers.
 *
 * Numbers are stored and sent in E.164 (`+255712345678`), which is the format
 * Africa's Talking expects, so no reformatting is needed before dispatch.
 */

/** Masks the middle digits so delivery logs stay useful without storing PII. */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 5)}***${phone.slice(-3)}`;
}
