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

## Journal lettering

`ValleySerif-Medium.otf` is a renamed 1,463-code-point derivative of
[Noto Serif CJK SC Medium 2.003](https://github.com/notofonts/noto-cjk/releases/tag/Serif2.003).
The source OTF SHA256 is `19322be2ecf5dd2abd546db7a86cc83c286026cbd28593583bfcfd721e48c9fe`.
The subset covers repository strings and common punctuation. The interface falls
back to Valley CJK for other supported characters. The original copyright and
OFL 1.1 are included in `LICENSE.noto-serif`.

## Handwritten interface headings

`ValleyHand-Regular.ttf` is a renamed 1,464-code-point derivative of
[LXGW WenKai Regular v1.530](https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530).
The source TTF SHA256 is `2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b`.
The subset includes current script strings, Latin, digits and punctuation. The
interface uses Valley Serif and Valley CJK for additional characters. Copyright
and the full OFL 1.1 are included in `LICENSE.wenkai`.
