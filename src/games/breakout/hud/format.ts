const scoreFormat = new Intl.NumberFormat('en-US');

/** スコアの表示。3 桁ごとにカンマで区切る */
export const formatScore = (n: number): string => scoreFormat.format(n);
