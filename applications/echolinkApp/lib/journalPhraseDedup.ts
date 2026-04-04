export function normalizeJournalUserPhrase(raw: string): string {
  return raw
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
