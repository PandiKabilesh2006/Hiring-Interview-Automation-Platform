export const ENGLISH_ONLY_WARNING = "You are not speaking in English. Please speak in English.";
export const NON_ENGLISH_TRANSCRIPT_TEXT = "(Non-English speech)";

const NON_LATIN_SCRIPT_RE =
  /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u0600-\u06FF]/;
const NON_LATIN_SCRIPT_GLOBAL_RE =
  /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u0600-\u06FF]+/g;

const STRONG_ENGLISH_MARKERS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "but", "can", "could",
  "did", "do", "does", "for", "from", "had", "has", "have", "how", "i", "in",
  "is", "it", "my", "of", "on", "or", "our", "that", "the", "this", "to",
  "was", "we", "what", "when", "where", "which", "with", "worked", "working",
  "would",
]);

const TAMIL_ENGLISH_STT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\u0B93/g, "oh"],
  [/\u0B90/g, "I"],
  [/\u0B9A\u0BC1\u0B9F\u0BCD/g, "should"],
  [/\u0BB8\u0BCD\u0BAA\u0BC0\u0B95\u0BCD/g, "speak"],
  [/\u0B87\u0BA9\u0BCD/g, "in"],
  [/\u0B87\u0B99\u0BCD\u0B95\u0BBF\u0BB2\u0BC0\u0BB7\u0BCD/g, "English"],
  [/\u0BB0\u0BC8\u0B9F\u0BCD/g, "right"],
  [/\u0BB2\u0BC8\u0B95\u0BCD/g, "like"],
  [/\u0BB2\u0BBE\u0BB8\u0BCD\u0B9F\u0BCD/g, "last"],
  [/\u0B9A\u0BC6\u0BAE\u0BB8\u0BCD\u0B9F\u0BB0\u0BCD/g, "semester"],
  [/\u0B9A\u0BC6\u0BAE\u0BB8\u0BCD\u0B9F/g, "semester"],
  [/\u0BB2\u0BC7\u0BB0\u0BCD\u0BA9\u0BCD\u0B9F\u0BCD/g, "learned"],
  [/\u0BB2\u0BC7\u0BB0\u0BCD\u0BA9\u0BCD/g, "learn"],
  [/\u0B95\u0BCB\u0BB0\u0BCD/g, "core"],
  [/\u0BA4\u0BBF/g, "the"],
];

function getWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z]+(?:'[a-z]+)?|\d+/g) || [];
}

export function sanitizeCandidateSpeech(text: string): string {
  let cleaned = text;
  for (const [pattern, replacement] of TAMIL_ENGLISH_STT_REPLACEMENTS) {
    cleaned = cleaned.replace(pattern, replacement);
  }

  return cleaned
    .replace(NON_LATIN_SCRIPT_GLOBAL_RE, " ")
    .replace(/[^\x00-\x7F]+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isLikelyEnglishSpeech(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed === NON_ENGLISH_TRANSCRIPT_TEXT || trimmed === "(candidate is waiting)") return true;

  const sanitized = sanitizeCandidateSpeech(trimmed);
  const sanitizedWords = getWords(sanitized);
  if (sanitizedWords.length >= 3) return true;

  const latinLetters = (trimmed.match(/[A-Za-z]/g) || []).length;
  const nonLatinLetters = Array.from(trimmed).filter((char) => NON_LATIN_SCRIPT_RE.test(char)).length;
  const letterCount = latinLetters + nonLatinLetters;
  const words = getWords(trimmed);
  if (words.length === 0) return nonLatinLetters < 3;

  const englishMarkerCount = words.filter((word) => STRONG_ENGLISH_MARKERS.has(word)).length;
  if (englishMarkerCount > 0) return true;

  return !(nonLatinLetters >= 6 && letterCount > 0 && nonLatinLetters / letterCount > 0.5);
}

export function displayCandidateSpeech(text: string): string {
  if (!isLikelyEnglishSpeech(text)) return NON_ENGLISH_TRANSCRIPT_TEXT;
  return sanitizeCandidateSpeech(text) || text;
}
