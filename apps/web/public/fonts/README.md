# Fonts

Self-hosted font target directory.

Expected files:

- `Newsreader-Variable.woff2`
- `Newsreader-Italic-Variable.woff2`
- `IBMPlexSans-Variable.woff2`
- `IBMPlexMono-Regular.woff2`
- `IBMPlexMono-Medium.woff2`

Sources:

- Newsreader: Google Fonts. License: OFL-1.1.
- IBM Plex: IBM Plex releases. License: OFL-1.1.

Budget:

- Each file < 120 KB.
- Total fonts < 400 KB.

Fallback:

- Site works without these files.
- CSS falls back to Georgia, system UI, and UI monospace.

Subset reference:

```bash
pyftsubset Newsreader-VariableFont_opsz,wght.ttf \
  --output-file=Newsreader-Variable.woff2 \
  --flavor=woff2 \
  --unicodes='U+0000-00FF,U+0100-017F,U+2000-206F,U+20AC,U+2122,U+2212' \
  --layout-features='kern,liga,ss01,ss02,calt' \
  --no-hinting \
  --desubroutinize
```
