/** The kerned LaTeX Studio wordmark from the design exports — Newsreader serif
 *  with the raised A and dropped E of real TeX. */
export function Wordmark({ size = 23 }: { size?: number }) {
  return (
    <span style={{ fontFamily: "var(--ls-serif, 'Newsreader', Georgia, serif)", fontSize: size, letterSpacing: '.005em', lineHeight: 1 }} className="text-zinc-900 dark:text-[#f2f4fa]">
      <span>L</span>
      <span style={{ fontSize: '0.72em', verticalAlign: '0.30em', marginLeft: '-0.30em', marginRight: '-0.05em' }}>A</span>
      <span>T</span>
      <span style={{ verticalAlign: '-0.22em', marginLeft: '-0.10em', marginRight: '-0.02em' }}>E</span>
      <span>X</span>
      <span style={{ fontWeight: 400, marginLeft: '0.34em' }} className="text-[#4e68f5] dark:text-[#7e96f8]">
        Studio
      </span>
    </span>
  );
}
