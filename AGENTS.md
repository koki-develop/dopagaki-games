# dopagaki-games

極端で大げさな爽快感に振り切った、スマートフォン向けのブラウザゲーム集。React 19 と Vite で作り、ゲームの描画は three.js の WebGPURenderer（WebGL2 へ自動で切り替わる）で行う。各ゲームは `src/games/<ゲーム名>/` に置き、ゲーム固有の決まりはそこの `AGENTS.md` に書く。

## セットアップとコマンド

- 初回は `mise bootstrap`。`mise.toml` の道具（bun、node、lefthook、betterleaks）を入れたあと、依存のインストールと、コミット前に betterleaks（秘密情報の検出）を走らせる lefthook の設定をまとめて行う
- `bun run dev`: 開発サーバー
- `bunx tsc -b`: 型チェック
- `bun run lint`: oxlint と dependency-cruiser（依存の向きの検査）
- `bun test`: テスト。1 ファイルだけなら `bun test <パス>`
- `bun run build`: 型チェックと本番ビルド

## 作業を終える前の確認

- 型チェック・lint・テスト・ビルドをすべて通す
- 画面や描画に関わる変更は、開発サーバーを開いてブラウザで確かめる。描画は WebGPU と WebGL2 で経路が違うので、描画を変えたときは WebGL2 でも確かめる（切り替え方は各ゲームの `AGENTS.md` に書く）
- 表示は幅 320px のスマートフォンからデスクトップまで、横にはみ出さないこと

## ディレクトリと依存の向き

- `src/shared/`: 何にも依存しない小さな関数と部品（数値の計算、スコアの表示（`format.ts`）、例外の文言、ゲームを続けられなくなった原因（`fatal.ts`）、シードつきの乱数、画面の状態機械の器、一時停止メニューの遷移（`pause-menu.ts`）、読み込み中のゲーム本体への命令の中継（`port-relay.ts`）、表示係への中継）
- `src/engine/`: 描画の土台（レンダラーと GPU を失ったときの作り直し、描画領域、ポストエフェクト、インスタンス描画、粒、画面全体のフラッシュと絞り込み、フレームループ、品質の自動調整）と入力（相対ドラッグ、位置を指す入力）、開発ビルドの操作口の置き場
- `src/juice/`: 手触りの部品（Web Audio のエンジン、BGM の土台、音の合成と残響・歪み、カメラの揺れ、時間の流れ（スローモーションとヒットストップ）、1 フレームの時刻、明滅の制限、振動、ゲームごとの設定の器、「視差効果を減らす」の窓口、記録の保存）
- `src/games/<ゲーム名>/`: ゲーム本体
- `src/app/`: React の画面（ポータルと各ゲームの UI）とスタイル。ゲームの画面に共通するフックとエラー画面は `src/app/game/`、一時停止のメニューなどの部品は `src/app/ui/`
- `build/`: Vite のプラグイン（`build/site/plugin.ts`）。ページごとの HTML（題名・説明・canonical・OGP）、OG 画像、アイコン、`sitemap.xml`、`robots.txt` を作る。Node で動く
- `lint/`: lint の設定が共有する素のモジュールの一覧（`pure-modules.ts`）

依存は `shared` ← `juice` ← `games` ← `app`、`shared` ← `engine` ← `games` の向きだけにする。逆向きに import すると、下の層を単体で試せなくなる。ゲームどうしも import し合わない。

素のモジュールは、ブラウザの機能にも Node の機能にも、時刻にも乱数にも触れないモジュールで、`lint/pure-modules.ts` に挙げる（`src/shared/`、`src/app/site.ts`、各ゲームの sim やルール・CPU・調整値・得点・記録の値・画面の状態機械・HUD の計算・セッションの状態・画面とゲームの間の型など。どれが素かは一覧のファイルを見る）。素のモジュールが import してよいのは素のモジュールだけ。`build/` が読んでよい `src/` のモジュールも素のモジュールだけ。ビルドから読むモジュールや、決定的に動かしたいモジュールを増やすときは、この一覧に足す。

three.js を import してよいのは `src/engine/` と、各ゲームの `view/` だけ。描画の都合をそこに閉じ込め、ゲームのロジック（状態の管理、シミュレーション、演出の計算、記録など）は three.js を知らない素の値でやり取りする。

各ゲームの `fx/`（演出）は three.js に依存させず、`view/` から読んでよいのは明るさの調整値（`look.ts`）と色（`palette.ts`）だけにする。演出は素の値の状態として描画へ渡す。

依存の決まりは `.dependency-cruiser.ts` で、素のモジュールが使ってよいグローバルは `oxlint.config.ts` で検査する。

`src/app/` 以外で DOM や `window`、`localStorage`、`AudioContext` などのブラウザの機能を使うときは、引数やインターフェース（port）で外から受け取るか、存在を確かめてから使う。`bun test` には DOM がないので、こうしておくとモジュールを読み込めて、偽物を渡して試せる。

## ページと URL

- ページのパス・題名・説明は `src/app/site.ts` にまとめ、画面の切り替え（`src/app/router.ts`）とビルドの両方がそこを読む。ゲームを足すときは、`GAMES`、OG 画像の `build/og/cards.ts`、`src/App.tsx` の画面の切り替えに足す
- ゲームのページの `<html>` には `data-game` が付き（ビルドの HTML と画面の切り替えの両方で書く）、スクロールや長押しのメニューを止めるスタイルが効く
- サイト内のリンクは `src/app/ui/Link.tsx` を使う。ページを読み込み直さずに画面を切り替える
- 本番は Vercel で、`vercel.json` の `cleanUrls` と `trailingSlash: false` により、末尾のスラッシュや `.html` の付いた URL をリダイレクトする。どのページにも当たらないパスには `404.html` をステータス 404 で返す。開発サーバーとプレビューも、同じ規則で返す（`build/site/resolve.ts`）
- OG 画像は、satori で描いた文字と簡単な図形だけの画像を sharp で PNG にする。ファイル名には中身のハッシュが入り、描き方を変えると URL も変わる

## ゲームの組み立て

ゲームは、どれも次の共通の部品で組む。ゲームに固有の部分（ルール、演出、描画のシーン、曲の中身）だけを各ゲームに書く。

- 描画一式とフレームのループ: `engine/render-driver.ts` の `RenderDriver`。GPU を失ったときの作り直しと、フレームの処理の例外の扱いも持つ。ブラウザの描画一式は `engine/post-graphics.ts`、描画領域の大きさは `engine/surface.ts` の `elementSurface`
- 画面の状態機械: 遷移は各ゲームの `controller.ts` の純粋関数で書き、`shared/machine.ts` の `createMachineStore` で React から使う。一時停止中の操作（再開、設定、やり直しとタイトルへの確認）の行き先は `shared/pause-menu.ts` の `pauseMenuStep` で決め、画面は `app/game/GameSheets.tsx` で出す。結果画面の演出の時刻は画面側（`app/<ゲーム名>/reveal.ts`）に置き、操作を受け付け始める時刻は controller の `RESULT_INPUT_GUARD_MS` に合わせる
- 画面とゲーム本体の結びつけ: `app/game/useGameSession.ts`。タブが隠れたときの一時停止と Escape などは `app/game/useScreenGuards.ts`。ゲーム本体ができる前から状態機械に渡しておく命令の口は、`shared/port-relay.ts` の `createPortRelay` に `GamePort` の命令の名前を挙げて作る
- 毎フレームの HUD の値は `shared/feed.ts` の `LatestFeed`、ときどき起きる出来事は `EventFeed` で画面へ渡す
- 記録の保存: `juice/persistent.ts` の `createPersistentStore`（版つき、別のタブの保存と合わせる）
- 設定: ゲームごとに持つ（各ゲームの `settings.ts`）。`juice/settings.ts` の `createGameSettings` に、保存先のキー・項目・既定値と、項目からカメラの動きと音の切り替えを決める方法（`SettingsSchema`）を渡して作る。画面の揺れ・効果音・BGM の 3 項目なら `standardSettingsSchema` にキーを渡して作る。ページで 1 つを共有する設定は `sharedGameSettings` で最初に読んだときに作る。保存するのはユーザーが選んだ項目だけで、選んでいない項目は既定値に従う。セッションは `bindAudioSwitches` で、効果音と BGM の切り替えを `AudioEngine.setEnabled` へ渡す。設定の画面は `app/ui/SettingsPanel.tsx` に、そのゲームの設定と項目（`SettingItem`）を渡して開く
- BGM: `juice/audio/bgm.ts` の `LayeredBgm` に、曲の中身（`Arrangement`）を渡す。効果音の枠は `juice/audio/voices.ts` の `VoiceOpener`
- 一時停止: セッションの `setPaused` で、BGM の `pause()` / `resume()` と一緒に `AudioEngine.setPaused` を呼び、鳴っている効果音ごと止める。エンジンはページで 1 つなので、プレイを終えたとき・次のプレイを始めたとき・続けられなくなったとき・セッションを捨てたときは `setPaused(false)` で解く（`unlock()` では解けない）
- 開発ビルドの操作口: `engine/debug-hooks.ts` の `DebugHookSlot` で `window.__<ゲーム名>` に置く。画面の調整パネルは、セッションから操作口を引く（`DebugHookSlot.of`）

## コードの書き方

- 毎フレーム動く処理では、オブジェクトや配列、クロージャを新しく作らない。スマートフォンで GC による引っかかりが出るため。使い回す入れ物をフィールドに持つ
- テストの補助モジュールは `*.test-support.ts` という名前にする。アプリの型チェックとビルドから外れる
- 過去の実装や保存形式との互換のための処理は書かない。保存形式を変えたら版を上げ、前の版の保存内容は捨てる。キーや形式を変えても、古いキーや前の形式を読む処理は残さない

## シェーダー

- 頂点の式（`positionNode` と varying に渡す式）は `Fn` の外で組むので、`Loop` や `If`、`assign` を使わない（使っても式に入らない）
- `smoothstep` は edge0 < edge1 で書く（下がる段差は 1 から `smoothstep` を引く）
- `pow` の底は負にしない（負の底では値が決まらない）。負になりうる値の 2 乗は `x * x` で書く
- シェーダーの式は、`src/engine/node-graph.test-support.ts` で `Fn` の中まで辿って確かめる。uniform を読むかは `reaches`、`smoothstep` の両端の順は `reversedSmoothsteps`、`pow` は `isPow` と `unguardedPows`

## 演出

演出を足したり変えたりするときは、`docs/game-feel.md` の原則に従う。原則とその根拠、演出に使う共通の部品、参考にする技法をまとめてある。

## 光と動きの安全

- 画面全体や広い範囲の明滅、bloom の一時的な強調は、`juice/flash.ts` の `FlashLimiter` を通す。1 秒に 3 回までに抑えるため（WCAG 2.3.1）。飽和した赤の全画面フラッシュは使わない
- `prefers-reduced-motion: reduce` では、カメラの引きや拍動、UI のアニメーションを弱める
