import type { Rng } from './random.js';

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/**
 * Letters physically next to each letter on a QWERTY keyboard. Rows are staggered, so the keys
 * above are at the same and next column, and the keys below at the previous and same column.
 */
const NEIGHBOURS: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  const at = (row: number, col: number) => ROWS[row]?.[col];
  ROWS.forEach((keys, row) => {
    [...keys].forEach((key, col) => {
      const around = [
        at(row, col - 1),
        at(row, col + 1),
        at(row - 1, col),
        at(row - 1, col + 1),
        at(row + 1, col - 1),
        at(row + 1, col),
      ];
      map.set(key, around.filter((k): k is string => k !== undefined));
    });
  });
  return map;
})();

/** A plausible mistyping of `char` (a neighbouring key, same case), or undefined if it isn't a letter. */
export function neighbourKey(char: string, rng: Rng): string | undefined {
  const lower = char.toLowerCase();
  const options = NEIGHBOURS.get(lower);
  if (!options || options.length === 0) return undefined;
  const key = rng.pick(options);
  return char === lower ? key : key.toUpperCase();
}
