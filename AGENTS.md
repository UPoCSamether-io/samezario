# AGENTS.md — サメザリオ

このリポジトリで作業する AI コーディングエージェント（Claude Code / Codex / その他）向けの指示書。
Claude Code は `CLAUDE.md` を読むが、中身はこのファイルを指しているだけなので、実体はここ1本。

## worktree は `.worktrees/` に作る

git worktree を作るときは、必ず**リポジトリ直下の `.worktrees/<slug>`** に置くこと。

```bash
git worktree add .worktrees/feat-photo-unlock -b feat/photo-unlock
cd .worktrees/feat-photo-unlock && npm install     # 依存は worktree ごとに要る
```

- **`.claude/worktrees/` には作らない。** エディタのファイルツリーで埋もれて見つけられない
- `.worktrees/` は `.gitignore` 済み。ディレクトリ名はブランチ名の `/` を `-` にしたもの
- ブランチ名は `feat/<slug>` / `fix/<slug>` / `chore/<slug>`
- 片付けは `git worktree remove .worktrees/<slug>`（未コミットの変更があれば git が止める）

作業の場所を変えたときは、**どこに作ったかを最初に伝えること**。

## 変更したら通すもの

```bash
npm test        # 盤面 / 権威サーバ / 幾何 / 操舵 / 写真照合 / セーブデータ
npm run build
```

`node --test` で回るので、新しいモジュールも **DOM を触らない部分は素の関数に切り出して**
`*.test.mjs` を隣に置く（`src/geo.js` / `src/verify.js` がその形）。

## 守るもの

- **盤面の正はサーバ。** `src/sim.js` はブラウザとサーバの両方が同じものを回す。DOM を持ち込まない
- **ポイントと解放を書けるのは `src/progress.js` の `clearSpot` / `markShared` だけ。**
  差分加算（`points += 100`）を書かない
- 照合の合否を決めるのは `src/verify.js` の `verifyPhoto` ひとつ。判定を増やすならそこへ
- 色とフォントは `src/style.css` の `@theme` から。カラーコードの直書きはしない
- 新しいライブラリは原則入れない（依存ゼロで組んである）

## そのほか

構成・調整ポイント・オンライン対戦の仕組み・現地写真の解放は `README.md` に書いてある。
仕様の背景は `docs/`、U☆PoC 側の設計資料は別リポジトリ `UPoC_Samether.io`（`docs/05`〜`08`）。

実装の判断に迷ったら、**既存コードの流儀に合わせるほう**を選ぶ。
