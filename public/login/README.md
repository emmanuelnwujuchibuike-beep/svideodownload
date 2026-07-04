# Login collage images

The login page (`/login`) shows 7 floating cards. Each card auto-uses a photo if
the matching file exists here; otherwise it falls back to its brand gradient — so
the page always looks finished.

Drop your 7 images in **this folder** with these exact names (JPG, ~800px wide is plenty):

| File          | Card position   | Image you sent            |
|---------------|-----------------|---------------------------|
| `1.jpg`       | top-left        | rainbow paint splash      |
| `2.jpg`       | center (portrait) | neon clock girl on phone |
| `3.jpg`       | left            | neon music note ring      |
| `4.jpg`       | top-right       | blue circuit globe        |
| `5.jpg`       | bottom-right    | social-media chains guy   |
| `6.jpg`       | right           | blue geometric abstract   |
| `7.jpg`       | bottom-left     | rainbow neon rock         |

Notes
- Names must be lowercase `.jpg`. If yours are PNG, either convert to `.jpg` or
  rename the extension in `app/login/page.tsx` (the `img` field per card).
- No rebuild logic needed — files in `public/` are served as-is; a redeploy (or
  local refresh) picks them up.
