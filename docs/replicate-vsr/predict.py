"""
Cog wrapper around video-subtitle-remover (Apache-2.0).

Dropped into a clone of the upstream repository so `SubtitleRemover` can be
imported directly; nothing upstream is modified.

── 🔴 WHY THIS EXISTS ──────────────────────────────────────────────────────

The model AI Clean used before fills text regions with `cv2.inpaint`, a
single-frame diffusion algorithm. Measured on a real video it produced a smeared
grey blob with the caption still legible along the top edge — it covers text, it
does not remove it, and no parameter changes that.

This project is temporal: STTN and ProPainter recover the covered region from
frames where it was NOT covered, so what goes back is real picture rather than
an average of the surrounding pixels. It also finds the subtitles itself, which
is what lets it drop into the existing pipeline unchanged.

── The interface is deliberately the same shape as the old model ───────────

`video` in, a cleaned video out. The extra inputs are optional and default to
the sensible thing, so `lib/ai/config.ts` needs a model id and a version and
nothing else.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path as SysPath

from cog import BasePredictor, Input, Path

# Upstream expects to be run from the repository root — `backend` imports its
# siblings by package path, and its config reads files relative to itself.
REPO_ROOT = SysPath(__file__).parent.resolve()
sys.path.insert(0, str(REPO_ROOT))


class Predictor(BasePredictor):
    def setup(self) -> None:
        """
        Import once, at container start.

        🔴 The import is the expensive part — it pulls in torch, PaddleOCR and
        the bundled weights. Doing it here rather than inside `predict` is what
        keeps the SECOND and later requests fast; a cold container still pays
        for it once, which is inherent to the model's size.
        """
        os.chdir(REPO_ROOT)

        from backend import config  # noqa: E402
        from backend.main import SubtitleRemover  # noqa: E402

        self._config = config
        self._SubtitleRemover = SubtitleRemover

        # Upstream's CLI forces English and loads the matching translation file
        # before constructing anything; skipping it leaves `tr` unpopulated and
        # the first status message raises.
        try:
            import configparser

            from backend.main import tr  # noqa: E402

            config.set(config.interface, "en")
            translation = REPO_ROOT / "backend" / "interface" / f"{config.interface.value}.ini"
            if translation.exists():
                tr.read(str(translation), encoding="utf-8")
        except Exception as e:  # pragma: no cover - defensive, never fatal
            print(f"[vsr] translation setup skipped: {e}")

    def predict(
        self,
        video: Path = Input(description="Video to remove hardcoded text from"),
        mode: str = Input(
            description=(
                "Inpainting algorithm. sttn is temporal and fast and is the right "
                "default for real footage; propainter is slower and better on heavy "
                "motion; lama is single-frame and suits animation and stills."
            ),
            choices=["sttn", "propainter", "lama"],
            default="sttn",
        ),
        subtitle_area: str = Input(
            description=(
                "Optional 'ymin,ymax,xmin,xmax' to restrict removal to one band. "
                "Leave empty to detect and remove all text automatically."
            ),
            default="",
        ),
    ) -> Path:
        out_dir = SysPath(tempfile.mkdtemp(prefix="vsr-"))
        # Upstream derives its own output name from the input; giving it a plain
        # ascii one avoids any question of how it handles unicode filenames.
        local_in = out_dir / "input.mp4"
        shutil.copy(str(video), local_in)
        local_out = out_dir / "output.mp4"

        # Exactly the sequence upstream's own CLI performs.
        self._config.inpaintMode.value = mode

        remover = self._SubtitleRemover(str(local_in))
        remover.video_out_path = str(local_out)

        if subtitle_area.strip():
            try:
                ymin, ymax, xmin, xmax = (int(v.strip()) for v in subtitle_area.split(","))
                remover.sub_areas = [(ymin, ymax, xmin, xmax)]
                print(f"[vsr] restricted to {remover.sub_areas}")
            except Exception:
                # 🔴 A malformed box falls back to AUTOMATIC rather than failing
                # the job. The caller asked for text removed; a bad optional hint
                # is not a reason to return nothing.
                print(f"[vsr] could not parse subtitle_area {subtitle_area!r} — detecting automatically")

        remover.run()

        if not local_out.exists() or local_out.stat().st_size == 0:
            raise RuntimeError("video-subtitle-remover produced no output")

        # ── Make sure the original audio is on it ───────────────────────────
        #
        # Upstream merges audio back itself, but it is not guaranteed for every
        # input, and a silent result is the one failure a member notices
        # instantly. This is a stream COPY when audio is already present and a
        # cheap remux when it is not — no re-encode either way.
        final = out_dir / "final.mp4"
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-loglevel", "error",
                    "-i", str(local_out),
                    "-i", str(local_in),
                    "-map", "0:v:0", "-map", "1:a:0?",
                    "-c", "copy", "-shortest",
                    str(final),
                ],
                check=True,
            )
            if final.exists() and final.stat().st_size > 0:
                return Path(str(final))
        except Exception as e:
            print(f"[vsr] audio remux skipped: {e}")

        return Path(str(local_out))
