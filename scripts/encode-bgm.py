#!/usr/bin/env python3
"""BGM の mp3 を Ogg Vorbis へ焼き直す。ループの跡切れを消すための一手間つき。

mp3 は 1152 サンプル単位でしか終われないので、エンコーダが末尾を無音で埋め、先頭にも
デコーダ遅延ぶんの無音が入る（この曲たちで実測 7〜70ms）。ループのたびにそこが挟まって
音が途切れる。mp3 のまま切っても再エンコードでまた埋まるが、Ogg Vorbis は granule
position でサンプル数を正確に持てるので、切った状態がそのまま残る。

やることは2つだけ:
  1. 両端の「完全な無音」（-60dB 以下）を測って落とす —— 曲の余韻は残す
  2. Vorbis 128k で書き出す（mp3 の約半分の容量になる）

    python scripts/encode-bgm.py

曲を足したら、mp3 を public/audio へ置いてもう一度これを走らせるだけでよい。
変換が済んだ mp3 はコミットしないこと。ブラウザへ配るのは ogg だけで、両方置くと
同じ曲を2形式ぶん抱えることになる（BGM 6曲で 18MB）。
"""
import re
import subprocess
import sys
from pathlib import Path

AUDIO = Path(__file__).resolve().parent.parent / 'public' / 'audio'
SKIP = {'時代劇演出3'}      # 効果音。ループしないので切る必要がない
BITRATE = '128k'
FLOOR = '-60dB'            # これ以下を「完全な無音」とみなす


def ffmpeg(*args):
    return subprocess.run(['ffmpeg', '-hide_banner', '-nostats', *args],
                          capture_output=True, text=True, encoding='utf-8', errors='replace').stderr


def probe_duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                          '-of', 'csv=p=0', str(path)], capture_output=True, text=True).stdout
    return float(out.strip())


def trim_points(path, dur):
    """両端に貼りついた無音だけを返す。曲の途中の静かな部分は対象にしない"""
    log = ffmpeg('-i', str(path), '-af', f'silencedetect=noise={FLOOR}:d=0.005', '-f', 'null', '-')
    runs = []
    start = None
    for m in re.finditer(r'silence_(start|end): (-?[\d.]+)', log):
        if m.group(1) == 'start':
            start = float(m.group(2))
        elif start is not None:
            runs.append((start, float(m.group(2))))
            start = None
    if start is not None:                      # 末尾の無音は silence_end が出ないことがある
        runs.append((start, dur))
    # 「端に貼りついている」の判定には 60ms の遊びを持たせる。ffprobe が返す長さは
    # mp3 のコンテナぶんだけ実データより長く、ぴったり一致させると末尾を取り逃す
    # （Dark_blue_night は format 165.146 に対し実データ 165.109 で終わっていた）
    head = next((e for s, e in runs if s <= 0.001), 0.0)
    tail = next((s for s, e in reversed(runs) if e >= dur - 0.06), dur)
    return head, min(tail, dur)


def main():
    files = sorted(p for p in AUDIO.glob('*.mp3') if p.stem not in SKIP)
    if not files:
        sys.exit(f'mp3 が見つからない: {AUDIO}')
    for src in files:
        dur = probe_duration(src)
        head, tail = trim_points(src, dur)
        dst = src.with_suffix('.ogg')
        err = ffmpeg('-y', '-i', str(src),
                     '-af', f'atrim=start={head:.6f}:end={tail:.6f},asetpts=N/SR/TB',
                     '-c:a', 'libvorbis', '-b:a', BITRATE, '-loglevel', 'error', str(dst))
        if err.strip():
            sys.exit(f'{src.name}: {err.strip()}')
        print(f'{src.name:<26} 頭 {head * 1000:5.1f}ms / 尻 {(dur - tail) * 1000:5.1f}ms を落として '
              f'{src.stat().st_size / 1e6:5.2f}MB → {dst.stat().st_size / 1e6:5.2f}MB')


if __name__ == '__main__':
    main()
