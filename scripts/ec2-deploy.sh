#!/usr/bin/env bash
# EC2 (t3.micro / Amazon Linux 2023) の上で流す、初回セットアップ兼デプロイ。
# 何度流してもいい。初回は node / caddy / swap / systemd を入れ、
# 2回目以降は実質「pull → build → 再起動」だけになる。
#
#   sudo bash /opt/samezario/scripts/ec2-deploy.sh
#
# 初回だけはリポジトリがまだ無いので curl から:
#   curl -fsSL https://raw.githubusercontent.com/UPoCSamether-io/samezario/master/scripts/ec2-deploy.sh | sudo bash
set -euo pipefail

APP_DIR=/opt/samezario
REPO=https://github.com/UPoCSamether-io/samezario.git
PORT=5174
USER_=ec2-user

# ---- swap ----------------------------------------------------------------
# t3.micro は 1GB。ビルドをやめた今、対戦サーバ自体は 40人でも 32MB しか使わないので
# 本来は要らない。それでも置いてあるのは、想定外の伸び方をしたときに OOM killer が
# 部屋ごと殺すのを防ぐため。ディスクを 2GB 食うだけの保険。
# 「ファイルがあるか」ではなく「swap として効いているか」で見る。作りかけで
# 転んだ後に流し直すと、前者ではフォーマット前のファイルを永久に飛ばしてしまう。
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  [ -f /swapfile ] || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---- node / git ----------------------------------------------------------
dnf install -y -q git nodejs22 >/dev/null
# vite 8 の要求は ^20.19 || >=22.12。満たさない node で build すると意味不明に転ぶので先に落とす
node -e 'const [a,b]=process.versions.node.split(".").map(Number);
  if(!((a===20&&b>=19)||a>=22)) { console.error("node too old:", process.version); process.exit(1); }'

# ---- caddy ---------------------------------------------------------------
# HTTPS のためだけに置く。証明書の取得・更新・HTTP→HTTPS 転送・WebSocket の
# Upgrade 透過が全部既定で入っているので、設定は下の2行で終わる（certbot + nginx より短い）。
if [ ! -x /usr/bin/caddy ]; then
  curl -fsSL 'https://caddyserver.com/api/download?os=linux&arch=amd64' -o /usr/bin/caddy
  chmod +x /usr/bin/caddy
  id caddy &>/dev/null || useradd --system --home /var/lib/caddy --shell /sbin/nologin caddy
  mkdir -p /var/lib/caddy /etc/caddy && chown caddy:caddy /var/lib/caddy
  cat > /etc/systemd/system/caddy.service <<'EOF'
[Unit]
After=network.target
[Service]
User=caddy
Environment=XDG_CONFIG_HOME=/etc/caddy XDG_DATA_HOME=/var/lib/caddy
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
# root でなく :80/:443 を持つための最小権限
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
[Install]
WantedBy=multi-user.target
EOF
fi

# ---- ソース --------------------------------------------------------------
if [ -d $APP_DIR/.git ]; then
  # pull --ff-only ではなく reset --hard。この箱は「master をそのまま置く場所」で、
  # ここで編集する人は居ない前提。緊急の scp や中断したデプロイで作業ツリーが汚れていると
  # pull は止まるが、デプロイは止まってほしくない（＝常に master と同じ状態に落とす）
  sudo -u $USER_ git -C $APP_DIR fetch -q --prune origin
  sudo -u $USER_ git -C $APP_DIR reset -q --hard origin/master
else
  git clone -q $REPO $APP_DIR && chown -R $USER_:$USER_ $APP_DIR
fi
# フロントは Cloudflare Pages が配る。この箱は /ws だけが仕事なので dist は要らない。
# server/index.mjs は src/sim.js と src/data.js を ESM のまま import するので、
# vite build も devDependencies（vite / tailwind）も一切要らない —— 実行時の依存は ws 1つ。
# 誰も取りに来ない dist を作るために、0.2 vCPU のクレジットを燃やす必要はない。
sudo -u $USER_ bash -c "cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund"

# ---- ドメイン ------------------------------------------------------------
# nip.io は「IPを含むホスト名をそのIPに返す」だけの公開DNS。
# ドメインを買わずに Let's Encrypt の証明書が取れる（= wss:// が使える）。
# IP が変わると証明書ごと別物になるので EIP を必ず張っておくこと（docs/deploy-ec2.md）。
TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
SITE="${IP//./-}.nip.io"
# 本番は ws.samether.io（A レコードが EIP を向いている / Cloudflare は proxy させない＝DNS only。
# オレンジ雲にすると 443 が Cloudflare 止まりになって Let's Encrypt も wss も通らない）。
# nip.io も残すのは、DNS を移す前の URL とデプロイの疎通確認がそのまま生きるから。
cat > /etc/caddy/Caddyfile <<EOF
ws.samether.io, $SITE {
	reverse_proxy 127.0.0.1:$PORT
}
EOF

# ---- アプリ --------------------------------------------------------------
cat > /etc/systemd/system/samezario.service <<EOF
[Unit]
After=network.target
[Service]
User=$USER_
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
ExecStart=/usr/bin/node server/index.mjs
Restart=always
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now caddy samezario
systemctl restart caddy samezario

echo "https://$SITE"
