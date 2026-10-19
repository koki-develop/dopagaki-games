# カードの表の絵

52 枚の表は、Dmitry Fomin（Дмитрий Фомин）によるイギリス式（English pattern）のトランプの SVG で、作者が CC0 1.0（パブリックドメイン）で公開している。

- 出どころ: <https://commons.wikimedia.org/wiki/Category:SVG_English_pattern_playing_cards>（各ファイルは `File:English_pattern_<rank>_of_<suit>.svg`）
- ライセンス: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)

元のファイルから変えた点:

- svgo（精度 2 桁）で小さくした
- 拡大縮小しても形が変わらないよう、ルートに `viewBox="0 0 360 540"` を付けた
- カードの外形の黒い輪郭を消した（卓の上のカードの縁はシェーダーが描く）
- ファイル名を、ランクとスートの頭文字の表記（`AS.svg`、`10H.svg`、`KC.svg` など。`rules/cards.ts` の `cardCode`）にした
