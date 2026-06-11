declare module 'nspell' {
  interface Nspell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): Nspell;
    remove(word: string): Nspell;
  }
  function nspell(dictionary: { aff: Uint8Array; dic: Uint8Array }): Nspell;
  export default nspell;
}
