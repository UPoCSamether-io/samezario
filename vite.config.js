import tailwindcss from '@tailwindcss/vite';
import { attach } from './server/index.mjs';

export default {
  plugins: [
    tailwindcss(),
    // 対戦の中継は dev サーバに相乗りさせる（/ws のみ。HMR は素通り）。
    // 本番は `node server/index.mjs` が dist を配りながら同じ /ws を受ける
    // 戻り値はポストフック扱いなので何も返さない
    { name: 'samezario-ws', configureServer: (s) => { attach(s.httpServer); } },
  ],
};
