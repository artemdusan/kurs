// Kształt pikselowej mapy kursu.
// X = pole lekcji, o = Baleary (ozdoba, bez lekcji).
const SHAPE = [
  '.XXXXXXXXX......',
  'XXXXXXXXXXXXX...',
  'XXXXXXXXXXXXXX..',
  '.XXXXXXXXXXX....',
  '.XXXXXXXXXXX..o.',
  '.XXXXXXXXXX..o..',
  'XXXXXXXXXXX.....',
  '.XXXXXXXX.......',
  '.XXXXXXX........',
  '..XXXXX.........',
  '....X...........',
];
const cellsOf = (ch) => SHAPE.flatMap((row, y) => {
  const xs = [...row].map((c, x) => (c === ch ? x : -1)).filter((x) => x >= 0);
  return (y % 2 ? xs.reverse() : xs).map((x) => ({ x, y }));
});
export const MAP_CELLS = cellsOf('X');
export const ISLANDS = cellsOf('o');
