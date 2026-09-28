# 演出の原則

dopagaki-games の演出（プレイヤーの行為に返す音・動き・光）を設計するときの原則と、その根拠をまとめる。ここにはどのゲームにも通じる考え方を書き、ゲーム固有の値や決まりは各ゲームの `AGENTS.md` に書く。

1. [入力への反応を何より優先する](#1-入力への反応を何より優先する)
2. [演出の強さは成果から決める](#2-演出の強さは成果から決める)
3. [普段は抑え、決定的な瞬間に振り切る](#3-普段は抑え決定的な瞬間に振り切る)
4. [衝撃には音とカメラをそろえて返す](#4-衝撃には音とカメラをそろえて返す)
5. [音に手をかけ、見た目と同じフレームで鳴らす](#5-音に手をかけ見た目と同じフレームで鳴らす)
6. [変化で好奇心を保つ](#6-変化で好奇心を保つ)
7. [判断に必要なものを隠さない](#7-判断に必要なものを隠さない)
8. [実際の結果を偽らない](#8-実際の結果を偽らない)
9. [光と動きの安全を共通の部品で守る](#9-光と動きの安全を共通の部品で守る)

## 1. 入力への反応を何より優先する

- 入力を受けたフレームで、目に見える反応か音を返す。操作する物は、sim の次のステップを待たずに入力どおりの位置へ描く（ブロック崩しのパドル）
- スローモーションで遅くするのは世界の時間だけにする。入力、操作する物、UI は実時間で動かし続ける
- 演出の最中も入力を受け付ける。演出を飛ばす操作は、演出のきっかけ（ブロック崩しでは勝敗の決着）より後に押されたものだけを数える。前から押していた指を離しただけでは飛ばさない

根拠:

- タッチ画面では、わずかな遅延でも気づかれる。特にドラッグで気づかれやすい。Deber et al. (2015) の実験では、画面を直接触る操作で、約 1ms の遅延と比べて違いに気づける遅延（JND）の平均が、ドラッグで 11ms、タップで 69ms だった。直接触るドラッグでは、遅延を 60Hz の 1 フレーム（16.7ms）縮めただけでも、被験者は全体として違いにはっきり気づけた
- Swink (2009) は、人が知覚・判断・動作を一巡する時間（約 240ms）をもとに、応答の遅れを次のように整理している。50ms なら瞬時に感じる。100ms を超えると遅れに気づくが、気にならない。200ms で鈍く感じる。240ms を超えると、リアルタイムに操作している感覚が失われる

## 2. 演出の強さは成果から決める

- 演出の強さは、プレイヤーの行為が実際に生んだ成果（壊した数、連鎖、得点など）から計算する。成果と関係なく演出を大きくしない
- 成果は 0〜1 の値（intensity）にまとめ、揺れ・bloom・音色などの強さをそこから導く。成果の幅が桁違いに広いときは、対数で 0〜1 に収める（ブロック崩しは、1 秒に 1 個から数百個まで変わる破壊の速さを対数で収めている）

根拠:

- Kao et al. (2024) は、アクション RPG で 1,699 人を比べた（事前登録あり）。成功したときにだけ出るフィードバックは、効力感・有能感・好奇心をすべて高めた。一方、成功と関係なく増幅したフィードバックは、増幅しない標準の演出と比べて、効力感と有能感を下げた。著者は、増幅した演出（攻撃の振りの光）が当たったときの手応えを覆い隠し、自分が起こしたという感覚を損なった可能性を挙げている

## 3. 普段は抑え、決定的な瞬間に振り切る

演出の強さを段階に分け、段階の落差で気持ちよさを作る。

| 段階 | 場面 | 強さ | ブロック崩しの例 |
|---|---|---|---|
| 普段 | 通常の操作 | 音と小さな変形 | パドルで打つ（パドルの squash と打撃音） |
| 成果 | 成果が出たとき | 成果に比例させる | ブロックを壊す（破片、連鎖で上がる音程、揺れ） |
| 決定的な瞬間 | 勝敗や記録が決まるとき | 振り切る。カメラの大きな動き、画面全体の演出、専用の音。スローモーションも使う | 自己ベストの更新（Peak）、ステージクリアのフィナーレ |

- 決定的な瞬間の演出は、1 回のプレイで数回までにする
- 成果の段階では、プレイヤーが自分の操作の結果を見届けられる強さにとどめる

根拠:

- Kao (2020) は、1 つのアクション RPG から、演出の量だけを None / Medium / High / Extreme の 4 段階に変えた版を作り、3,018 人で比べた。None と Extreme は、Medium と High に比べて、プレイ時間、プレイヤー体験、内発的動機、成績がどれも有意に低かった
- Juul & Begy (2016) は、タイルをつなげて消すパズルの素朴な版と、演出を足した版を 46 人で比べた。演出を足した版は品質の評価が 3.26 から 3.74 へ上がり、スコアは 49,682 から 40,340 へ下がった。どちらも有意差はない（p=.20、p=.12）。著者は、重複したフィードバックがプレイの認知負荷を上げた可能性を挙げている
- Peggle の Extreme Fever では、最後のオレンジのペグに当たる直前の数秒間に、カメラが寄り、ボールの最後の数ミリがスローモーションになり、「歓喜の歌」が流れ、「EXTREME FEVER」の大きな文字が出る。開発者の Sukhbir Sidhu は、プレイヤーが自分の打った球を見届ける妨げにならないよう、派手な演出を入れる場所をレベルの終わりに限ったと語っている（Edge, 2007）

## 4. 衝撃には音とカメラをそろえて返す

- 重い衝撃（ブロック崩しでは、ブロックを壊す、ボールが 0 個になる）には、同じフレームで音とカメラの反応を返す。軽い衝撃（パドルで打つ）は、音と物の変形で返す
- 当たりを 1 つずつ見分けられるゲームでは、ヒットストップで当たった物と当てた物を一瞬止める。ヒットストップは一部の物だけを止める局所的な演出で、画面全体でゲームの時間を止める freeze frame とは別に扱う（Pichlmair & Johansen, 2022）
- 当たりが 1 フレームに数十から数百も起きるゲームでは、ヒットストップを使わない。当たりをフレームごとに数えてから、揺れと音にまとめる（ブロック崩し）
- カメラの揺れは trauma 方式にする（[技法](#trauma-方式のカメラの揺れ)）

根拠:

- Lin et al. (2022) は、Steam の中国語のレビューから、打撃感の評価が高いアクションゲーム 8 作と低い 8 作を選んで比べた。ヒットストップ、音の整合（見た目と音がずれないこと）、カメラの制御が、打撃感を強く左右する可能性を示した。3 つのうち 1 つでも作り込みが欠けると、打撃感が損なわれうる

## 5. 音に手をかけ、見た目と同じフレームで鳴らす

- 効果音は、それを起こしたイベントがあったフレームで鳴らす。先の時刻へ予約したり、BGM の拍に合わせて遅らせたりすると、見た目とずれる
- 続けて成果が出たら、音程を上げていく。ブロック崩しでは、Shepard tone（無限音階）で上限に当たらずに上がり続けて聞こえるようにしている
- 同じ効果音でも、毎回ピッチと音色をわずかに揺らす
- 衝撃の重さは低音で出す
- 大量に起きる音は間引いて 1 音にまとめ、数に応じて音量と厚みを増やす。一度きりの大事な音（決着、Peak の和音など）は優先度を上げ、頻繁な音に途中で切られないようにする
- マスターにコンプレッサーを置き、重なった音の音量をならす

根拠:

- Dixon et al. (2014) は、スロットマシンのプレイヤー 96 人に、自分が何回勝ったか（賭け金より多く戻ったか）を見積もらせた。実際の勝ちは 28 回だったが、音がない条件では平均 33 回、勝ちと、実際には負けている結果（[8](#8-実際の結果を偽らない)）の両方に音が付く条件では、平均 36 回と見積もった。音が付く条件では、皮膚電気反応と、自己評価の覚醒度も高かった。音は、勝った回数の見積もりを押し上げる
- Lin et al. (2022) は、見た目と音のずれが不自然さを生むことを、打撃感を損なう要因に挙げている

## 6. 変化で好奇心を保つ

- 粒の散り方、破片の割れ方、効果音の響きに、毎回の揺らぎを持たせる
- まれにしか起きない出来事を用意する（ブロック崩しのエンドレスでは、ボールを大量に出すブロックが 1% の確率で混じる）
- 壊したものの痕跡をしばらく画面に残し、行為の結果を見せる（The Art of Screenshake の permanence）。ただし、判断に使う物と重なるときは短く消す（[7](#7-判断に必要なものを隠さない)）。ブロック崩しの破片は、回りながら落ち、0.5〜0.8 秒で薄れて消える

根拠:

- Kao et al. (2024) の構造方程式モデルでは、好奇心が楽しさを最も強く予測し、自由に続けたプレイ時間を予測した唯一の要因だった。著者は、成功するかどうか分からない瞬間が好奇心を生む、と論じている。ただし、演出を毎回変えることは好奇心と相関せず、楽しさとは小さな正の相関（.11）があっただけだった

## 7. 判断に必要なものを隠さない

- ボールやパドルなど、プレイヤーが判断に使う物は、粒や破片より手前に描く
- 数が多い粒は、発生時の色より抑えて描く。破片は bloom の閾値より暗く描き、光らせない
- 1 フレームに出す粒や破片の数には上限を設ける
- 長く遊んでも目が疲れない明るさに抑える。色の鮮やかさは保ち、明るさだけを控えめにする
- 演出は、プレイヤーが次に見るべき場所へ視線を導くために使う

根拠:

- Hicks et al. (2018) は、ゲーム開発者 17 人のオンラインアンケートへの回答を整理した。回答には "Juice should be used to direct the players attention, not divide it" や "The pleasure aspects should not detract from the others like too much screenshake." という声があった
- Kao et al. (2024) で増幅した演出が逆効果になった理由として、著者は、攻撃の振りの光が、当たったときや倒したときの演出を覆い隠していた可能性を挙げている

## 8. 実際の結果を偽らない

- 負けや損をした結果に、勝ったような演出を付けない。負けの場面では、祝福に見える明るさ（bloom の強調やフラッシュ）、外へ弾ける粒、上がっていく音を出さない
- 記録の更新などの節目の演出は、実際に達成したときだけ出す

根拠:

- 複数のラインに賭けるスロットマシンでは、払い戻しが賭け金を下回る（実際には負けている）結果にも、勝利の光と音が付く。これを losses disguised as wins（LDW）と呼ぶ。Dixon et al. (2010) の実験では、初心者 40 人の LDW 後の皮膚電気反応は、本当の勝ちと同じくらい大きかった。どちらも、ふつうの負けより有意に大きかった

## 9. 光と動きの安全を共通の部品で守る

- 画面全体や広い範囲の明滅と、bloom の一時的な強調は、`FlashLimiter` を通して 1 秒に 3 回までに抑える。飽和した赤の全画面フラッシュは使わない
- 「画面の揺れ」をオフにすると、衝撃による揺れと、それに伴う引き、ビートに合わせた拍動を止める。大きな節目でカメラを引いて戻す動きは残す
- `prefers-reduced-motion: reduce` のときは、画面の揺れを初めからオフにし、カメラの引きと拍動を弱め、UI のアニメーションを止める
- 振動は、端末が対応しているときだけ、節目に限って使う

根拠:

- WCAG 2.2 の達成基準 2.3.1 は、1 秒間に 3 回を超えて明滅するものを置かないよう求めている（明滅が一定の閾値より小さい場合を除く）

## 共通の部品

どのゲームも、次の部品で演出を組む。

| 用途 | 部品 |
|---|---|
| 世界の時間（スローモーション） | `src/juice/time.ts` の `WorldClock` |
| カメラの揺れ、引き、拍動 | `src/juice/camera.ts` の `CameraRig` |
| 明滅の制限 | `src/juice/flash.ts` の `FlashLimiter` |
| 効果音の発音、優先度、マスターのコンプレッサー | `src/juice/audio/engine.ts` の `AudioEngine` |
| 1 回のプレイの音をまとめて止める | `src/juice/audio/engine.ts` の `VoiceGroup` |
| 音の合成と、ピッチの揺らぎ | `src/juice/audio/synth.ts` |
| 大量に起きる音の間引き | `src/juice/audio/throttle.ts` の `SoundThrottle` |
| 上がり続ける音程 | `src/juice/audio/shepard.ts` |
| BGM の拍 | `src/juice/audio/sequencer.ts` の `Sequencer` |
| 出来事が起きる速さの計測 | `src/juice/rate.ts` の `EventRate` |
| 振動 | `src/juice/haptics.ts` の `vibrate` |
| ユーザー設定と、reduced motion の反映 | `src/juice/settings.ts` |
| bloom | `src/engine/post.ts` の `PostChain` |
| 大量の粒や破片の描画 | `src/engine/instanced.ts` の `InstanceRing` |
| 品質の自動調整 | `src/engine/quality.ts` の `QualityGovernor` |

intensity の計算は、何を成果とするかがゲームごとに違うので、各ゲームに置く（ブロック崩しは `src/games/breakout/fx/intensity.ts`）。

## 技法

新しいゲームの演出を選ぶときに参考にする、講演やコラムの技法をまとめる。

### Juice It or Lose It

Martin Jonasson と Petri Purho の講演（GDC Europe 2012）。ブロック崩しに演出を 1 つずつ足していく。デモのソース（juicy-breakout）にある技法:

- 動きと変形: tween と easing（Robert Penner の easing 関数）、パドルを動かす速さに応じた squash & stretch、ボールの速さに応じた伸び、進む向きに合わせたボールの回転、当たった後のボールの揺れ
- 色: 当たった後にボールが白くなる
- 壊れ方: 壊れたブロックが落ち、縮み、回り、暗くなる。ボールの軌道でブロックを切り分ける。ボールが何かに当たるたびに、すべてのブロックが少し揺れる。壁がゴムのように弾む
- 粒: 当たるたびに飛び散る火花、ボールの軌跡、壊れたブロックからボールの進む向きへ飛ばすブロック色の小片
- 音: 壁・ブロック・パドルでそれぞれ別の音を鳴らす。ブロックに続けて当てるたびに 12 種の音を順に進めて鳴らし、音程を変えていく。BGM
- 画面: ボールの速度と逆向きに蹴るバネ式の揺れ
- 時間: ゲーム全体の速さを一瞬落とす freeze（落とす長さと、入りと戻りのフェードを調整できる）

### The Art of Screenshake

Jan Willem Nijman（Vlambeer）の講演（INDIGO Classes 2013）。退屈な 2D シューターに、小技を 1 つずつ足していく。

- 演出: 弾を大きく速くする、マズルフラッシュ、着弾の演出、敵の被弾の動きとノックバック、permanence（残骸を画面に残す）、カメラの lerp、画面の揺れ、プレイヤーの反動、当たった瞬間の一時停止（sleep）、銃の反動、薬莢、低音を足す、カメラのキック、爆発を大きくする、爆発の煙を残す
- ルール側: 敵の体力を下げる、連射を速める、敵を増やす、精度をわざと下げる、プレイヤーが死ぬようにする

### ヒットストップの仕様

桜井政博のコラム（週刊ファミ通 Vol. 490–491）が挙げる、大乱闘スマッシュブラザーズのヒットストップの仕様:

- 与えるダメージが大きいほど長くする
- 技ごとに固有の倍率を持たせる。電撃の技は倍率が自動で上がる。飛び道具は短めにする
- 長さに上限を設ける
- 攻撃した側と受けた側を、同じ時間だけ止める
- 振動の向きは、地上にいるときは横、空中にいるときは縦にする
- 振動の幅は、初めを大きくして、だんだん小さくする。カメラとの距離に応じて強さを変える
- 止まっている間も、攻撃した側は 1 フレームでは気づけないほどの速さで動かし続ける

SmashWiki によると、15% のダメージの技のヒットストップは、初代（64）で 10 フレーム（日本版は 9 フレーム）、DX で 8 フレーム、X と for で 10 フレーム、SP で 15 フレーム。電撃の技は 1.5 倍になる。上限は DX で 20 フレーム、X 以降で 30 フレーム。

### trauma 方式のカメラの揺れ

Squirrel Eiserloh の講演（GDC 2016「Math for Game Programmers: Juicing Your Cameras With Math」）。`CameraRig` はこの方式で揺らす。

- trauma という 0〜1 の値を持つ。衝撃が起きたら足し（例: +0.2、+0.5）、時間とともに一定の速さで減らす
- 揺れの幅は trauma² か trauma³ にする。小さな衝撃は控えめに、大きな衝撃は急に強く揺れる（trauma が 0.3、0.6、0.9 のとき、trauma³ で揺れは 3%、22%、73%）
- 揺れの値は、乱数ではなく Perlin ノイズから取る。ノイズは時刻を引数に取るので、一時停止やスローモーションにも自然に従う
- 2D では平行移動と回転を組み合わせる。3D では回転だけを使う

## 参考文献

- Deber, J., Jota, R., Forlines, C., & Wigdor, D. (2015). How Much Faster is Fast Enough? User Perception of Latency & Latency Improvements in Direct and Indirect Touch. *CHI 2015*, 1827–1836. https://doi.org/10.1145/2702123.2702300
- Dixon, M. J., Harrigan, K. A., Sandhu, R., Collins, K., & Fugelsang, J. A. (2010). Losses disguised as wins in modern multi-line video slot machines. *Addiction*, 105(10), 1819–1824. https://doi.org/10.1111/j.1360-0443.2010.03050.x
- Dixon, M. J., Harrigan, K. A., Santesso, D. L., Graydon, C., Fugelsang, J. A., & Collins, K. (2014). The Impact of Sound in Modern Multiline Video Slot Machine Play. *Journal of Gambling Studies*, 30(4), 913–929. https://doi.org/10.1007/s10899-013-9391-8
- Edge Staff (2007). The Making of Peggle. *Edge*. https://web.archive.org/web/20111203020957/http://www.next-gen.biz/features/feature-making-ofacirc?page=show
- Eiserloh, S. (2016). Math for Game Programmers: Juicing Your Cameras With Math. *GDC 2016*. https://gdcvault.com/play/1023146/Math-for-Game-Programmers-Juicing
- Hicks, K., Dickinson, P., Holopainen, J., & Gerling, K. (2018). Good Game Feel: An Empirically Grounded Framework for Juicy Design. *DiGRA 2018*. https://doi.org/10.26503/dl.v2018i1.936
- Jonasson, M., & Purho, P. (2012). Juice It or Lose It. *GDC Europe 2012*. https://www.gdcvault.com/play/1016487/juice-it-or-lose ／ デモのソース: https://github.com/grapefrukt/juicy-breakout ／ 講演の要約: https://devblog.heisarzola.com/gdcr-juice-it-or-lose-it/
- Juul, J., & Begy, J. S. (2016). Good Feedback for bad Players? A preliminary Study of 'juicy' Interface feedback. *First Joint FDG/DiGRA Conference*. https://jesperjuul.net/text/juiciness.pdf
- Kao, D. (2020). The effects of juiciness in an action RPG. *Entertainment Computing*, 34, 100359. https://doi.org/10.1016/j.entcom.2020.100359
- Kao, D., Ballou, N., Gerling, K., Breitsohl, H., & Deterding, S. (2024). How does Juicy Game Feedback Motivate? Testing Curiosity, Competence, and Effectance. *CHI 2024*. https://doi.org/10.1145/3613904.3642656
- Lin, Z., Duan, H., Wen, Z. A., & Cai, W. (2022). What Features Influence Impact Feel? A Study of Impact Feedback in Action Games. *IEEE GEM 2022*. https://doi.org/10.1109/GEM56474.2022.10017782
- Nijman, J. W. (2013). The Art of Screenshake. *INDIGO Classes 2013*. https://www.youtube.com/watch?v=AJdEqssNZ-U
- Pichlmair, M., & Johansen, M. (2022). Designing Game Feel: A Survey. *IEEE Transactions on Games*, 14(2), 138–152. https://doi.org/10.1109/TG.2021.3072241
- 桜井政博. 週刊ファミ通 Vol. 490–491 のコラム（英訳: Source Gaming, 2015）. https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/
- SmashWiki. Hitlag. https://www.ssbwiki.com/Hitlag
- Swink, S. (2009). *Game Feel: A Game Designer's Guide to Virtual Sensation*. Morgan Kaufmann. ISBN 978-0-12-374328-2
- W3C (2024). Web Content Accessibility Guidelines (WCAG) 2.2, 2.3.1 Three Flashes or Below Threshold. https://www.w3.org/TR/WCAG22/#three-flashes-or-below-threshold
