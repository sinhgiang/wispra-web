// Groq's error answers are passed back to the apps as they are, because the apps
// read them (a 429 that says "per day" / "(TPD)" is a daily limit, see
// /api/chat/completions). Only the server account's organization id is taken out
// (T-0201, L4): it says nothing the apps need and identifies the server's key.

const ORGANIZATION_ID = /\borg_[A-Za-z0-9]+/g

/** Groq's error text with the organization id replaced by "org_…". */
export function cleanGroqError(text: string): string {
  return text.replace(ORGANIZATION_ID, 'org_…')
}
