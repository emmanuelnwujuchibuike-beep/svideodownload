# Login collage images

The login page (`/login`) shows 7 floating cards, each rendered with `next/image`
(sources are already 640px WebP; next/image still serves AVIF/WebP at the exact render size) so the collage stays light even on slow
connections. If a file is ever missing, the card's brand gradient shows instead —
the page never looks broken.

| File     | Card position      | Image                     |
|----------|---------------------|----------------------------|
| `1.webp`  | top-left            | rainbow paint splash      |
| `2.webp`  | center (portrait)   | neon clock girl on phone  |
| `3.webp`  | left                | neon music note ring      |
| `4.webp`  | top-right           | blue circuit globe        |
| `5.webp`  | bottom-right        | social-media chains guy   |
| `6.webp`  | right               | blue geometric abstract   |
| `7.webp`  | bottom-left         | rainbow neon rock         |

To swap a photo, just replace the matching numbered file in this folder — no code
change needed.
