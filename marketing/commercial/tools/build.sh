#!/bin/bash
# Full build: captures → frame sequences → composition renders → audio mix → final MP4s.
# Run tools/start-servers.sh and capture/scenes.cjs first (see README.md).
set -euo pipefail
P=$(cd "$(dirname "$0")/.." && pwd)
RAW=$P/captures/raw; SEQ=$P/captures/seq; OUT=$P/output
mkdir -p "$SEQ" "$OUT"
# 1 · phone-screen clips → 30fps JPEG sequences (the composition steps through them)
mkseq() { # name, then one or more  file[:start[:duration]]  pieces, joined in order
  local name=$1; shift; rm -rf "$SEQ/$name"; mkdir -p "$SEQ/$name/tmp"; local n=0
  for piece in "$@"; do
    IFS=: read -r f ss t <<< "$piece"
    ffmpeg -y -loglevel error -ss "${ss:-0}" ${t:+-t $t} -i "$f" -vf "fps=30,scale=780:-2:flags=lanczos" -q:v 2 "$SEQ/$name/tmp/%05d.jpg"
    for j in $(ls "$SEQ/$name/tmp" | sort); do n=$((n+1)); mv "$SEQ/$name/tmp/$j" "$SEQ/$name/$(printf %05d $n).jpg"; done
  done
  rmdir "$SEQ/$name/tmp"
}
mkseq download "$RAW/download.mp4"
mkseq ai "$RAW/ai1.mp4:0:3.6" "$RAW/ai2.mp4:0.3"
for n in reels history explore feed quests; do mkseq $n "$RAW/$n.mp4"; done
python3 - "$SEQ" <<'PY'
import os, sys, json
d = sys.argv[1]
m = {n: len([f for f in os.listdir(os.path.join(d, n)) if f.endswith('.jpg')]) for n in os.listdir(d) if os.path.isdir(os.path.join(d, n))}
open(os.path.join(d, 'manifest.js'), 'w').write('window.SEQ_MANIFEST = ' + json.dumps(m) + ';\n'); print(m)
PY
# 2 · picture: 16:9 and 9:16
node "$P/tools/render-frames.cjs" "$P/composition/commercial.html" "$OUT/picture-16x9.mp4" 1920 1080 30 46 fmt=h
node "$P/tools/render-frames.cjs" "$P/composition/commercial.html" "$OUT/picture-9x16.mp4" 1080 1920 30 46 fmt=v
# 3 · sound: music + voice-over
bash "$P/tools/mix.sh"
# 4 · mux
for f in 16x9 9x16; do
  ffmpeg -y -loglevel error -i "$OUT/picture-$f.mp4" -i "$OUT/mix.wav" -map 0:v -map 1:a -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -profile:v high -c:a aac -b:a 256k -movflags +faststart -t 46 "$OUT/frenzsave-commercial-$f.mp4"
done
ls -la "$OUT"
