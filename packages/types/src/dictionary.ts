export interface DictionaryDefinition {
  definition: string;
  example?: string | null;
}

export interface DictionaryEntry {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
}

export interface DictionaryResult {
  word: string;
  phonetic: string | null;
  audioUrl: string | null;
  entries: DictionaryEntry[];
  provider: "free-dictionary" | "wiktionary";
}
