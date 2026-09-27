import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  build: {
    // 配信物に含まれる依存（フォントを含む）のライセンス表示。本文ごと Markdown で配信物に同梱する
    license: { fileName: 'licenses.md' },
    // three.js のチャンク（約 900 KB）は分けても小さくできないので、警告の閾値をその大きさに合わせる
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      // three.js は大きく、どのゲームも使うので、ゲーム本体とは別のチャンクにしてキャッシュを共有する
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 }],
        },
      },
    },
  },
})
