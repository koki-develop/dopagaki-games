/** 例外を、画面や記録に出せる 1 行の文字列にする */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
