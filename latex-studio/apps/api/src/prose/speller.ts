export interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
}

let spellerPromise: Promise<Speller> | null = null;

/** Lazy, cached en-GB Hunspell speller (pure JS, fully local). */
export function getSpeller(): Promise<Speller> {
  if (!spellerPromise) {
    spellerPromise = (async () => {
      const [{ default: nspell }, { default: enGb }] = await Promise.all([
        import('nspell'),
        import('dictionary-en-gb'),
      ]);
      return nspell(enGb) as Speller;
    })();
  }
  return spellerPromise;
}
