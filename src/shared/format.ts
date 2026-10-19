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

/** 増減の表示。増えたら +、減ったら - を付け、大きさは formatScore と同じく整数に切り捨てて 3 桁ごとに区切る。0 は符号を付けない */
export function formatSigned(n: number): string {
  const size = Math.floor(Math.abs(n));
  if (size === 0) return '0';
  return `${n > 0 ? '+' : '-'}${formatScore(size)}`;
}
