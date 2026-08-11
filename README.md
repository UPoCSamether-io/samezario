# サメザリオ / Samezario

調布を舞台にした .io 系ブラウザアクション。Vite + Canvas2D + Tailwind v4、ビルド設定なし。

```bash
npm install
npm run dev      # http://localhost:5173（対戦の中継 /ws も相乗りする）
npm run build
npm start        # 本番。dist を配りつつ /ws を受ける（PORT で変更可 / 既定 5174）
node server/relay.test.mjs   # 中継サーバのチェック
```

## 構成

| ファイル | 中身 |
| --- | --- |
| `index.html` | 全画面（タイトル / ロケ地 / サメ選択 / 図鑑 / 遊び方 / ゲーム / リザルト）のマークアップ |
| `src/main.js` | 画面遷移、各画面の描画、HUD更新、セーブ（localStorage） |
| `src/game.js` | ゲームループ。移動・成長・衝突・ボットAI・カメラ・Canvas描画 |
| `src/shark-art.js` | サメの見た目。ゲーム内とプレビューで共有 |
| `src/data.js` | サメ5種 / マップ4種 / 調布Tips のマスターデータ |
| `src/net.js` | 対戦サーバとの線。JSON を投げて受けるだけ |
| `server/index.mjs` | 対戦の中継サーバ。部屋割りと配り直しだけで、盤面は持たない |
| `src/style.css` | デザイントークン（Retro Pop Cinema）と共通クラス |
| `public/img/` | アセット画像（サメスプライト等）。エリアマップは `data.js` の SVG パスに置き換え済みで、`chofu_map.png` は取り直し用の原本 |
| — | プレイエリアの外周は `data.js` の `path`（実際のエリア輪郭）そのもの。内外判定は `Path2D` + `isPointInPath`。`size` は一辺ではなく**実効面積の平方根**で、ゲーム側が輪郭の面積が `size²` になるよう拡大する |
| `scripts/seal-arms.mjs` | エリア輪郭から細すぎる腕を落とすワンショット道具（`node scripts/seal-arms.mjs --emit`）。原本の path もここ |
| `docs/` | 仕様書・設計ドキュメント（`specifications.txt` 等） |

## 調整ポイント

`src/game.js` 冒頭の定数がゲームバランスの全て。

- `BASE_SPEED` / `BASE_TURN` — 基本の速さと旋回上限
- `TURN_RADIUS` — 旋回半径 ≒ 体の半径 × この値。大きいほど重い操作感
- `BOT_COUNT` / `BOT_GROWTH` — ボットの数と成長率（難易度）
- `DASH_DRAIN` / `DASH_REFILL` / `DASH_MIN` — ダッシュのスタミナ消費・回復・息切れ解除ライン
- `WAKE_LIFE` / `WAKE_R` — 航跡の寿命と太さ。囲い込みの成否はこれと `DASH_DRAIN`（＝航跡の長さ）で決まる
- `SEGS` — rope の骨の数。体長は `shark-art.js` の `bodyLength()`（太さ × 画像の縦横比）

サメ・マップ個別のパラメータは `src/data.js`。デバッグ中は `window.__sz` から
`cam` / `sharks` / `player` / `food` を直接触れる。

## 未実装

- **写真照合によるマップ解放**（`docs/specifications.txt` 4.2）。基準画像がまだないため、ロケ地画面は
  ロック表示と説明のみ。SSIM の実装は基準写真が揃ってから。
- 音（BGM / SE）。

## オンライン対戦

モードの切り替えは無い。開始すると必ずロケ地ごとの部屋へ入り（最大8人）、空席はボットが埋める。
中継サーバに繋がらなければ黙ってボットだけの部屋になる——それが従来のソロで、実装は同じ道を通る。

盤面の**正はホスト（部屋に最初に入った人）のブラウザ**で、`server/` は部屋割りとメッセージの
配り直しだけをする。ゲストは自分のサメをローカルで先に動かし、15Hz で届くスナップショットへ
ズレを溶かしながら寄せる。餌は差分（増えた分・消えた分）だけ流す。
ホストが抜けたら次の人へ委譲 —— 全員が同じ盤面を回しているので旗を立て替えるだけで続く。

未対応：ホストのクライアントを書き換えればチートできる。ホストの回線品質が全員に効く。
ホストがタブを裏に回すとブラウザが `requestAnimationFrame` を止めるので全員の盤面が固まる
（線は生きているため委譲も起きない）。
どちらも「サーバ側で `game.js` を回す」に移せば消えるが、`Path2D` などの DOM 依存を
切り離す必要がある。
