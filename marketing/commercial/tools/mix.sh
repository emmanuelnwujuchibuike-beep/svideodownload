#!/bin/bash
# Music bed + voice-over → output/mix.wav (−14 LUFS integrated, −1 dBTP).
# Voice: Kokoro "af_heart" (audio/vo.py). Line start times match the picture edit.
set -euo pipefail
P=$(cd "$(dirname "$0")/.." && pwd)
VO=$P/audio/vo/${VOICE:-af_heart}; OUT=$P/output; mkdir -p "$OUT"
# line:start-seconds
CUES="l1:2.0 l2:5.0 l3:14.6 l4:24.6 l5:33.0 l6:39.0"
inputs=(); filters=""; i=1
for c in $CUES; do
  k=${c%%:*}; at=${c##*:}; ms=$(python3 -c "print(int($at*1000))")
  inputs+=(-i "$VO/$k.wav")
  filters+="[$i:a]aresample=44100,aformat=channel_layouts=stereo,highpass=f=90,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,adelay=${ms}|${ms}[v$i];"
  i=$((i+1))
done
vlabels=$(for j in $(seq 1 $((i-1))); do printf "[v$j]"; done)
ffmpeg -y -loglevel error -i "$P/audio/music.wav" "${inputs[@]}" -filter_complex "\
${filters}${vlabels}amix=inputs=$((i-1)):normalize=0,volume=2.4,apad=whole_dur=46,asplit=2[vo][key];\
[0:a]volume=0.32[mus];[mus][key]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=400:makeup=1[duck];\
[duck][vo]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1:LRA=9[out]" -map "[out]" -ar 48000 -t 46 "$OUT/mix.wav"
ffmpeg -hide_banner -i "$OUT/mix.wav" -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|Peak:" | tail -2
