# Login collage images

The login page (`/login`) shows 7 floating cards, each rendered with `next/image`
(auto-compressed to AVIF/WebP + resized) so the collage stays light even on slow
connections. If a file is ever missing, the card's brand gradient shows instead —
the page never looks broken.

| File     | Card position      | Image                     |
|----------|---------------------|----------------------------|
| `1.png`  | top-left            | rainbow paint splash      |
| `2.png`  | center (portrait)   | neon clock girl on phone  |
| `3.png`  | left                | neon music note ring      |
| `4.png`  | top-right           | blue circuit globe        |
| `5.png`  | bottom-right        | social-media chains guy   |
| `6.png`  | right               | blue geometric abstract   |
| `7.png`  | bottom-left         | rainbow neon rock         |

To swap a photo, just replace the matching numbered file in this folder — no code
change needed.
