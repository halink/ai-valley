# Bundled browser font

`ValleyCJK-Regular.otf` is an OFL derivative of face 2 (Noto Sans CJK SC Regular) from Debian `fonts-noto-cjk`'s `NotoSansCJK-Regular.ttc`. Upstream: https://github.com/notofonts/noto-cjk. Copyright and complete SIL Open Font License 1.1 remain in `LICENSE.debian`. This font is not MIT project artwork.

The derivative has a distinct family name, **Valley CJK**. It retains all **44,810 Unicode code points** in the original SC face, including dynamic resident/event text coverage, rather than taking a UI-string-only subset. It drops regional `locl` substitutions and optional non-default layout features; retained features include standard ligatures, composition, Hangul composition, and vertical layout. Chinese regional glyph appearance is SC; Japanese/Traditional text keeps code-point coverage but regional appearance is not promised. Unsupported emoji and characters outside the source coverage still need a future fallback. No font can guarantee arbitrary user text.

This reduces the bundled resource from a 19 MB, ten-face collection to about 11 MB, below the GitHub connector's request size limit after base64 encoding. UI and 3D labels explicitly load it; no host-system CJK font is required. Headless glyph/loading tests and Web export are not browser visual acceptance.

## Reproduce (maintenance only)

Use Python fontTools 4.61.1 and the original TTC from the Debian package:

```sh
python scripts/fonts/build-valley-cjk.py /path/to/NotoSansCJK-Regular.ttc
```

The script checks source SHA256 `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`, preserves the complete SC cmap, renames the derivative and checks transfer size. Normal game builds use the committed OTF; they do not download or regenerate fonts.
