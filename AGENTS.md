# dopagaki-games

極端で大げさな爽快感に振り切った、スマートフォン向けのブラウザゲーム集。React 19 と Vite で作り、ゲームの描画は three.js の WebGPURenderer（WebGL2 へ自動で切り替わる）で行う。各ゲームは `src/games/<ゲーム名>/` に置き、ゲーム固有の決まりはそこの `AGENTS.md` に書く。

## セットアップとコマンド

- 初回は `mise bootstrap`。`mise.toml` の道具（bun、node、lefthook、betterleaks）を入れたあと、依存のインストールと、コミット前に betterleaks（秘密情報の検出）を走らせる lefthook の設定をまとめて行う
- `bun run dev`: 開発サーバー
- `bunx tsc -b`: 型チェック
- `bun run lint`: oxlint
- `bun test`: テスト。1 ファイルだけなら `bun test <パス>`
- `bun run build`: 型チェックと本番ビルド

## 作業を終える前の確認

- 型チェック・lint・テスト・ビルドをすべて通す
- 画面や描画に関わる変更は、開発サーバーを開いてブラウザで確かめる。描画は WebGPU と WebGL2 で経路が違うので、描画を変えたときは WebGL2 でも確かめる（切り替え方は各ゲームの `AGENTS.md` に書く）
- 表示は幅 320px のスマートフォンからデスクトップまで、横にはみ出さないこと

## ディレクトリと依存の向き

- `src/shared/`: 何にも依存しない小さな関数（数値の計算、例外の文言）
- `src/engine/`: 描画の土台（レンダラー、ポストエフェクト、インスタンス描画、フレームループ、品質の自動調整）と入力
- `src/juice/`: 手触りの部品（Web Audio のエンジン、カメラの揺れ、時間の流れ、明滅の制限、振動、設定の保存）
- `src/games/<ゲーム名>/`: ゲーム本体
- `src/app/`: React の画面（ポータルと各ゲームの UI）とスタイル

依存は `shared` ← `juice` ← `games` ← `app`、`engine` ← `games` の向きだけにする。逆向きに import すると、下の層を単体で試せなくなる。

three.js を import してよいのは `src/engine/` と、各ゲームの `view/` だけ。描画の都合をそこに閉じ込め、ゲームのロジック（状態の管理、シミュレーション、演出の計算、記録など）は three.js を知らない素の値でやり取りする。

`src/app/` 以外で DOM や `window`、`localStorage`、`AudioContext` などのブラウザの機能を使うときは、引数やインターフェース（port）で外から受け取るか、存在を確かめてから使う。`bun test` には DOM がないので、こうしておくとモジュールを読み込めて、偽物を渡して試せる。

## コードの書き方

- 毎フレーム動く処理では、オブジェクトや配列、クロージャを新しく作らない。スマートフォンで GC による引っかかりが出るため。使い回す入れ物をフィールドに持つ
- テストの補助モジュールは `*.test-support.ts` という名前にする。アプリの型チェックとビルドから外れる

## 光と動きの安全

- 画面全体や広い範囲の明滅、bloom の一時的な強調は、`juice/flash.ts` の `FlashLimiter` を通す。1 秒に 3 回までに抑えるため（WCAG 2.3.1）。飽和した赤の全画面フラッシュは使わない
- `prefers-reduced-motion: reduce` では、カメラの引きや拍動、UI のアニメーションを弱める
