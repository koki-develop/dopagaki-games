import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// UI で使う文字は日本語と英数字だけなので、その 2 つのサブセットだけを読み込む
import '@fontsource/dela-gothic-one/japanese-400.css';
import '@fontsource/dela-gothic-one/latin-400.css';
import './app/styles.css';
import App from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root がありません');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
