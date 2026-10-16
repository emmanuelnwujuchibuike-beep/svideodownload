# Voice-over lines, synthesised locally with Kokoro (Apache-2.0 open model).
import sys, soundfile as sf
from kokoro_onnx import Kokoro
M = sys.argv[1]; OUT = sys.argv[2]; VOICE = sys.argv[3] if len(sys.argv) > 3 else 'am_michael'
LINES = {
  'l1': "Meet Frenzsave.",
  'l2': "Paste a link from the apps you already use, and save it in seconds.",
  'l3': "Then create with Frenz AI. Turn words into motion, and bring your photos to life.",
  'l4': "Discover reels from the community, and keep every save in your history.",
  'l5': "Complete quests, and earn as you go.",
  'l6': "Frenzsave. Save. Discover. Create and earn.",
}
k = Kokoro(f"{M}/kokoro-v1.0.onnx", f"{M}/voices-v1.0.bin")
for key, text in LINES.items():
    audio, sr = k.create(text, voice=VOICE, speed=1.0, lang="en-us")
    sf.write(f"{OUT}/{key}.wav", audio, sr)
    print(key, round(len(audio) / sr, 2))
