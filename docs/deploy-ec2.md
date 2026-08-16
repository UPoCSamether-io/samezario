# EC2 (t3.micro) へのデプロイ

Render からの移行先。**この箱の仕事は `/ws` だけ**。フロントは Cloudflare Pages が配る。

```
ブラウザ ──https──> Cloudflare Pages         （index.html / assets / img）
        └──wss───> Caddy(:443) ──> node server/index.mjs(:5174) ──> /ws
```

`server/index.mjs` は `src/sim.js` と `src/data.js` を ESM のまま import するので、
**対戦サーバに `vite build` も devDependencies も要らない**。この箱に入るのは `ws` 1つ
（212KB）だけで、`npm ci --omit=dev` のみ。誰も取りに来ない `dist` を作るために
0.2 vCPU のクレジットを燃やさない。デプロイは 40秒 → **2.9秒**。

`dist` が無いので `/` は 404 を返す。生きているかは `/health` で見る。

## Cloudflare Pages 側（必須）

フロントは `samezario.pages.dev`。Settings → Variables and Secrets にビルド環境変数を1つ:

```
VITE_WS_URL = https://54-168-149-87.nip.io
```

`src/net.js` は `import.meta.env.VITE_WS_URL || location.origin` なので、未設定だと
`wss://<project>.pages.dev/ws` を掘りに行って必ず失敗する。`^http` → `ws` に置換されるので
`https` のまま入れてよい。

**Vite はビルド時に値を埋め込むので、変数を変えただけでは既存のデプロイは変わらない。**
必ず再デプロイすること。効いたかは配信中のバンドルを直接見るのが早い:

```bash
ASSET=$(curl -sS https://samezario.pages.dev/ | grep -o '/assets/[A-Za-z0-9._-]*\.js' | head -1)
curl -sS "https://samezario.pages.dev$ASSET" | grep -o 'https://[a-z0-9.-]*\.nip\.io'
```

## 1. 箱を立てる（一度きり / ローカルの AWS CLI から）

```bash
export AWS_DEFAULT_REGION=ap-northeast-1

AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)

SG=$(aws ec2 create-security-group --group-name samezario \
  --description samezario --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $SG --ip-permissions \
  IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges='[{CidrIp=0.0.0.0/0}]' \
  IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges='[{CidrIp=0.0.0.0/0}]' \
  IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges="[{CidrIp=$(curl -s ifconfig.me)/32}]"

aws ec2 create-key-pair --key-name samezario --query KeyMaterial --output text \
  > ~/.ssh/samezario.pem && chmod 600 ~/.ssh/samezario.pem

ID=$(aws ec2 run-instances --image-id $AMI --instance-type t3.micro \
  --key-name samezario --security-group-ids $SG \
  --credit-specification CpuCredits=standard \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=8,VolumeType=gp3}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=samezario}]' \
  --query 'Instances[0].InstanceId' --output text)

# IP を固定する。証明書もURLも IP に紐づくので、これが無いと stop/start で両方壊れる。
# インスタンスに付いている限り、自動割り当てIPと料金は同じ（付けっぱなしの未使用EIPだけが余計に取られる）
ALLOC=$(aws ec2 allocate-address --query AllocationId --output text)
aws ec2 wait instance-running --instance-ids $ID
aws ec2 associate-address --instance-id $ID --allocation-id $ALLOC

aws ec2 describe-addresses --allocation-ids $ALLOC --query 'Addresses[0].PublicIp' --output text
```

### 立てた実物（2026-08-16）

| | |
| --- | --- |
| URL | https://54-168-149-87.nip.io |
| インスタンス | `i-0dc5a486f0fa63c31`（t3.micro / standard / ap-northeast-1） |
| EIP | `eipalloc-069300c898d75cb13` → 54.168.149.87 |
| SG | `sg-0dfbbb65d64f128fa`（80,443 は全開 / 22 は自宅IPのみ） |
| 鍵 | `~/.ssh/samezario.pem` |

## 2. 中身を入れる（初回）

```bash
ssh -i ~/.ssh/samezario.pem ec2-user@<上で出たIP> \
  'curl -fsSL https://raw.githubusercontent.com/UPoCSamether-io/samezario/master/scripts/ec2-deploy.sh | sudo bash'
```

最後に `https://<IPをハイフンに>.nip.io` が出る。それが本番URL。

## 3. 以後のデプロイ

```bash
ssh -i ~/.ssh/samezario.pem ec2-user@<IP> 'sudo bash /opt/samezario/scripts/ec2-deploy.sh'
```

`git pull` → `npm ci --omit=dev` → systemd 再起動。同じスクリプトを流し直すだけ（2.9秒）。

`src/sim.js` はブラウザとサーバが同じものを回すので、**Pages と EC2 は必ず同じ commit を出す**。
片方だけ出すと予測と権威がズレて「サメがワープする」「当たったのに判定されない」になる。

```bash
# 様子を見る
ssh ... 'systemctl status samezario caddy; journalctl -u samezario -n 50'
```

## ドメインについて

`nip.io` は「IPを含むホスト名をそのIPに返す」だけの公開DNS。ドメインを買わずに
Let's Encrypt の証明書が取れるので `wss://` が通る（`src/net.js` は `location.origin` から
スキームを引くので、コード側の変更は要らない）。

独自ドメインに変えるときは A レコードを EIP に向けて `/etc/caddy/Caddyfile` の
ホスト名を差し替え、`systemctl reload caddy` の1回だけ。

## CPU（Render との比較）

t3.micro は 2 vCPU バースト。**standard モード**（上の `CpuCredits=standard`）だと:

- 定常: 0.2 vCPU 相当（1時間に12クレジット貯まる）
- バースト: 貯めた分だけ 2 vCPU 全開。上限 288 クレジット = **2 vCPU で 2.4時間**

本番の箱に外から `loadtest.mjs` を当てた実測（**クレジット残 0 ＝ 定常 0.2 vCPU に絞られた状態**、
自宅回線から wss:// 経由なのでインターネットの揺れ込み）:

| 人数 | 部屋 | 受信レート 最悪 | 中央 | 判定 |
| --- | --- | --- | --- | --- |
| 8 | 1 | 14.55 /s | 14.95 | 合格 |
| 24 | 2 | 14.67 /s | 15.17 | 合格 |

**いちばん絞られた状態で 24人が通る。** Render 無料の 0.1 vCPU 固定（24人で 6.3/s）とは別物。
さらに一晩置けばクレジットが満タン（288）になり、2 vCPU 全開が 2.4時間続く。

> ⚠️ **立てた直後はクレジットが 0。** T3 standard は起動時に 0 から始まり毎時12ずつ貯まる
> （満タンまで24時間）。`npm ci` と `vite build` もそこから食う。デモの直前に箱を作り直すと
> いちばん痩せた状態で本番を迎えることになるので、前日までに立てておくこと。
> 残量は `CPUCreditBalance`（CloudWatch）で見える。

`unlimited` にはしないこと。速さは上記の通り足りていて、暴走したプロセスが
1つ残ると月 $60 級の請求になる。standard なら足りなくなったとき遅くなるだけで済む。

## お金（新無料枠 / クレジット式・ap-northeast-1）

| 項目 | 月 |
| --- | --- |
| t3.micro (standard, 720h) | $9.79 |
| EBS gp3 8GB | $0.77 |
| パブリック IPv4 × 1 | $3.60 |
| 外向き通信 | 100GB/月まで $0（負荷試験で40人 0.26GB/時） |
| **計** | **約 $14.2** |

$100 のクレジットに対して6ヶ月で約 $85。収まる。Render 無料枠の月5GB 転送制限が
100GB になるのが実務上いちばん大きい差。

### 夜間に止めるべきか → **止めない**

止まるのはインスタンス代だけで、EBS も IPv4 も動いていようが止まっていようが同額。

| | 常時 | 12h/日 停止 |
| --- | --- | --- |
| t3.micro | $9.79 | $4.90 |
| EBS 8GB | $0.77 | $0.77 |
| IPv4 ×1 | $3.60 | $3.60 |
| **月** | **$14.16** | **$9.26** |
| **6ヶ月** | **$85** | **$56** |

浮くのは月 $4.90。$100 のクレジットは止めなくても6ヶ月で $85 に収まるので、
この $29 のために払う代償のほうが高い:

- **公開中の PoC が夜間だけ死ぬ。** 審査員・関係者が 23時に開くと 2.5秒後に
  「サーバに接続できません」が出る。いちばん避けたい壊れ方。
- **バーストの貯金が半減する。** クレジットは動いている間しか貯まらないので、
  12h/日 だと上限 288 ではなく約 144 までしか貯まらない。
  （残高そのものは消えない —— T3 は停止後7日は保持される。T2 は即失う）
- EventBridge Scheduler ×2 と IAM ロールが増える。

**節約したいなら、夜を削るのではなく PoC 期間が終わったら terminate する。** それが効く。

どうしても削るなら、副作用ゼロで効く順:

1. **t4g.micro（Graviton / arm64）に置き換える** — $0.0136 → $0.0108/h で月 $2.0 安い。
   このアプリは純 JS（実行時依存は `ws` だけ）なので arm64 でそのまま動く。
   AMI を `al2023-ami-kernel-default-arm64` に変えて立て直し、EIP を張り替えるだけ。
2. Spot は使わないこと。2分前通知で回収されると対戦中の全部屋が飛ぶ。

止めるとき:

```bash
aws ec2 terminate-instances --instance-ids $ID
aws ec2 release-address --allocation-id $ALLOC   # 忘れると未使用EIPで課金が続く
```
