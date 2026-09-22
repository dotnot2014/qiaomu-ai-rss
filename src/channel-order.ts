const nameCollator = new Intl.Collator('zh-CN-u-co-pinyin', { sensitivity: 'base', numeric: true });
const pinyinBoundaries: [string, string][] = [
  ['a', '阿'], ['b', '八'], ['c', '擦'], ['d', '搭'], ['e', '蛾'], ['f', '发'],
  ['g', '该'], ['h', '哈'], ['j', '击'], ['k', '喀'], ['l', '拉'], ['m', '妈'],
  ['n', '拿'], ['o', '哦'], ['p', '趴'], ['q', '七'], ['r', '然'], ['s', '撒'],
  ['t', '塌'], ['w', '挖'], ['x', '夕'], ['y', '丫'], ['z', '匝'],
];

function firstLetter(name: string): string {
  const first = [...name.trim()][0] || '';
  if (/^[0-9]$/.test(first)) return '0';
  if (/^[a-z]$/i.test(first)) return first.toLowerCase();
  if (!/\p{Script=Han}/u.test(first)) return '~';
  let letter = 'a';
  for (const [initial, boundary] of pinyinBoundaries) {
    if (nameCollator.compare(first, boundary) >= 0) letter = initial;
    else break;
  }
  return letter;
}

export function compareChannelNames(a: { name: string; id: string }, b: { name: string; id: string }): number {
  const first = firstLetter(a.name).localeCompare(firstLetter(b.name), 'en');
  if (first) return first;
  const aLatin = /^[a-z]/i.test(a.name.trim()), bLatin = /^[a-z]/i.test(b.name.trim());
  if (aLatin !== bLatin) return aLatin ? -1 : 1;
  return nameCollator.compare(a.name.trim(), b.name.trim()) || a.id.localeCompare(b.id);
}
