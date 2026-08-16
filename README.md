# サメザリオ / Samezario

調布を舞台にした .io 系ブラウザアクション。Vite + Canvas2D + Tailwind v4、ビルド設定なし。

```bash
npm install
npm run dev      # http://localhost:5173（対戦の中継 /ws も相乗りする）
npm run build
npm start        # 本番。dist を配りつつ /ws を受ける（PORT で変更可 / 既定 5174）
npm test         # 盤面 / 権威サーバ / 幾何 / 操舵のチェック

# 負荷測定（本番と同じ CPU 制限をローカルで再現する）
npm run build
docker run --rm --cpus=0.5 --memory=512m -p 5199:5199 -v "$PWD":/app -w /app \
  -e PORT=5199 node:24-alpine node server/index.mjs
node scripts/loadtest.mjs --clients 24 --seconds 20
```

## 検証

ローカルと GitHub Actions は Node.js `24.18.0` を基準にする。CI と同じ検証は次の順で実行する。

```bash
npm ci
git diff --exit-code -- package-lock.json
npm run build
npm test
```

`npm test` はゲームロジックのほか、`server/relay.test.mjs` の WebSocket 中継テストも実行する。
GitHub Actions の `CI / Test and build (Node.js 24.18.0)` は push と pull request の両方で起動し、
依存関係の npm キャッシュを利用する。このチェックを master の required status check に指定できる。

負荷測定は通常の pull request CI には含めない。GitHub の Actions 画面で `Load test` を選び、
`Run workflow` からクライアント数・測定秒数・マップを指定して手動起動する。測定条件、
合格基準（最低配信レート 13 snapshots/s）、実測ログ、サーバーログは30日間 artifact に保存され、
実測結果は Job Summary にも表示される。

## 構成

| ファイル | 中身 |
| --- | --- |
| `index.html` | 全画面（タイトル / ロケ地 / サメ選択 / 図鑑 / 遊び方 / ゲーム / リザルト）のマークアップ |
| `src/main.js` | 画面遷移、各画面の描画、HUD更新、セーブ（localStorage） |
| `src/game.js` | ブラウザ側。入力・カメラ・Canvas描画と、サーバの答えの先読み |
| `src/shark-art.js` | サメの見た目。ゲーム内とプレビューで共有 |
| `src/data.js` | サメ5種 / マップ4種 / 調布Tips のマスターデータ |
| `src/sim.js` | 盤面そのもの。移動・成長・衝突・ボットAI・餌・スナップショット。**DOM を触らないのでサーバとブラウザが同じものを回す** |
| `src/net.js` | 対戦サーバとの線。JSON を投げて受けるだけ |
| `server/index.mjs` | 対戦の権威サーバ。部屋ごとに `sim.js` の world を 30Hz で回し、15Hz で配る |
| `src/style.css` | デザイントークン（Retro Pop Cinema）と共通クラス |
| `public/img/` | アセット画像（サメスプライト等）。エリアマップは `data.js` の SVG パスに置き換え済みで、`chofu_map.png`（5エリアを色で塗り分けた図）は取り直し用の原本 |
| — | プレイエリアの外周は `data.js` の `path`（実際のエリア輪郭）そのもの。内外判定は `Path2D` + `isPointInPath`。`size` は一辺ではなく**実効面積の平方根**で、ゲーム側が輪郭の面積が `size²` になるよう拡大する |
| `scripts/trace-areas.py` | 色分けしたエリア図から輪郭を起こす（`python3 scripts/trace-areas.py`）。出力は次の seal-arms へ |
| `scripts/seal-arms.mjs` | エリア輪郭から細すぎる腕を落とすワンショット道具（`node scripts/seal-arms.mjs --emit`）。原本の path もここ |
| `scripts/loadtest.mjs` | 人数分ぶら下がって配信レートを測る。判定は「スナップショットが 15Hz 届くか」 |
| `docs/` | 仕様書・設計ドキュメント（`specifications.md` 等）。デプロイ手順は `deploy-ec2.md` |
| `scripts/ec2-deploy.sh` | EC2(t3.micro) 上で流す初回セットアップ兼デプロイ。何度流してもいい |

## 調整ポイント

`src/sim.js` 冒頭の定数がゲームバランスの全て。

- `BASE_SPEED` / `BASE_TURN` — 基本の速さと旋回上限
- `TURN_RADIUS` — 旋回半径 ≒ 体の半径 × この値。大きいほど重い操作感
- `BOT_COUNT` / `BOT_GROWTH` — ボットの数と成長率（難易度）
- `DASH_DRAIN` / `DASH_REFILL` / `DASH_MIN` — ダッシュのスタミナ消費・回復・息切れ解除ライン
- `WAKE_LIFE` / `WAKE_R` — 航跡の寿命と太さ。囲い込みの成否はこれと `DASH_DRAIN`（＝航跡の長さ）で決まる
- `SEGS` — rope の骨の数。体長は `shark-art.js` の `bodyLength()`（太さ × `def.aspect`）

サメ・マップ個別のパラメータは `src/data.js`。デバッグ中は `window.__sz` から
`cam` / `sharks` / `player` / `food` を直接触れる。

`def.aspect` は当たり判定の寸法（体長）なので手で書かない。原画を差し替えたら
`python3 scripts/sprite-aspect.py` で測り直して `data.js` へ写す。

## 未実装

- **写真照合によるマップ解放**（`docs/specifications.md` 4.2）。基準画像がまだないため、ロケ地画面は
  ロック表示と説明のみ。SSIM の実装は基準写真が揃ってから。
- 音（BGM / SE）。

## オンライン対戦

モードの切り替えは無い。開始すると必ずロケ地ごとの部屋へ入り（最大14人）、空席はボットが埋めて
合計14匹になる。人が増えるとボットが1匹ずつ抜けるので、密度は人数によらず一定で、
満席なら全員が人になる。
サーバに繋がらなければ黙ってボットだけの部屋になる——それが従来のソロで、実装は同じ道を通る。

盤面の**正はサーバ**。部屋ごとに `src/sim.js` の world を持ち、固定 dt で 30Hz 回して 15Hz で配る。
ブラウザから受け取るのは操作だけ（向き・ダッシュ・スキル・ポーズ）で、位置も生死も餌もサーバが決める。

ブラウザも同じ `sim.js` を回すが `authority=false`。つまり手元にあるのは
**「サーバがこう答えるはず」という先読み**で、押した瞬間から自分のサメは動く。
届いたスナップショットとのズレは `ex`/`ey` に積んで数フレームかけて溶かす（実測 1〜43px）。
餌は差分（増えた分・消えた分）だけ流し、入室した人にだけ盤面まるごとを送る。
配信は部屋で1回だけ JSON にしてバイナリフレームで配る（人数ぶん作り直さない）。
このとき差分を先に確定させてから撮らないと、full に載った餌が直後の差分でもう一度届いて
その人の海だけ餌が倍になる（`makeRoom` のコメント参照）。

サーバに繋がらない・切られた場合は `world.goSolo()` でその場の盤面を引き継いで独りの海になる。
盤面を作り直さないので、遊んでいる最中に落ちても画面は途切れない。

線の生死は ping ではなく**無言**で見る。生きている側は 20Hz で操作を送ってくるので、30秒黙った線は
落ちたか裏に回ったかのどちらかとして切る（`WS_DEAD_MS` で変更可）。タブを長く裏に回すと切れるのは仕様。

以前はホスト（最初に入った人）のブラウザが正だった。やめた理由は、ホストがタブを裏に回すと
`requestAnimationFrame` が止まって部屋ごと凍る・ホストの回線品質が全員に効く・ホストの
クライアントを書き換えればチートできる、の3つ。往復も減った —— 入力が
「ゲスト→サーバ→ホスト」、盤面が「ホスト→サーバ→ゲスト」で Render を2往復していたのが、いまは1往復。

代わりに、以前ホストだけが持っていた「ズレゼロ」は誰も持たない。全員が同じだけ先読みする。

### 必要なCPU（実測）

`--cpus` を変えた Docker で `scripts/loadtest.mjs` を当てた結果（目標 15/s）。
サーバは固定 dt なので、受信レートが落ちる＝盤面がスローモーションになっている。

| CPU | 8人（1部屋） | 24人（3部屋） | 40人（5部屋） |
| --- | --- | --- | --- |
| 0.1 | **13.8** | 6.3 | — |
| 0.25（t3.micro の定常 0.2 に近い） | — | 13.9 | 10.7 |
| 0.5 | 15.1 | 15.1 | **14.5** |

**0.1 vCPU で回るのは1部屋（8人）まで。** 数十人なら 0.5 CPU。
本番の t3.micro は定常 0.2 vCPU ＝ 1〜3部屋。ただしクレジットを貯めておけば
2 vCPU 全開で 2.4時間バーストするので、デモの数時間は 40人でも落ちない（`docs/deploy-ec2.md`）。
メモリは 40人でも 32MB で、512MB はどの段でも余る。詰まるのは常に CPU。

天井の正体はゲームの計算ではなく **WebSocket の1メッセージあたりのコスト（約0.22ms）**。
0.1 vCPU が捌けるのは毎秒 200〜450 本で、8人×(配信15Hz + 入力20Hz) = 280本/秒 がちょうど収まる量。
配信レートを 10Hz へ落としても本数が減るだけで天井は動かなかったので、
これ以上詰めるならメッセージを JSON からバイナリにするしかない。

ここへ来るまでに効いた順:

1. **圧縮を切る**（3.9 → 14.1/s）。zlib がプロセス全体の CPU の 51% だった
2. **餌の格子分割**（1tick 0.50 → 0.16ms）。捕食判定が サメ14 × 餌1260 の総当たりだった
3. **格子を計数ソートに**（0.16 → 0.11ms）。マスごとの配列を毎tick作り直すのが今度は 46% を占めた
4. **航跡走査の早期棄却**と、**スナップショットを部屋で1回だけ作る**（人数ぶん JSON 化していた）
