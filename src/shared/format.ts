/** スコアの表示。0 以上の整数に切り捨て、3 桁ごとにカンマで区切る（ロケールによらない） */
export function formatScore(n: number): string {
  const s = String(Math.max(0, Math.floor(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}
