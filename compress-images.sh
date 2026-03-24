#!/usr/bin/env bash
# compress-images.sh — Shoulders of Giants
#
# Compresses card art and the card-back image using ImageMagick.
# Targets ~200-300 KB per image at 80% JPEG quality, 900px max height.
#
# Requirements:
#   ImageMagick (install via Homebrew: brew install imagemagick)
#
# Usage:
#   chmod +x compress-images.sh
#   ./compress-images.sh

set -euo pipefail

# ── Dependency check ─────────────────────────────────────────────
if ! command -v magick &>/dev/null && ! command -v convert &>/dev/null; then
  echo "ImageMagick not found."
  echo "Install it with:  brew install imagemagick"
  exit 1
fi

# Use 'magick' (v7) if available, fall back to 'convert' (v6)
IM="magick"
command -v magick &>/dev/null || IM="convert"

CARD_DIR="images/cards"
QUALITY=80
MAX_HEIGHT=900

echo "── Compressing card images in ${CARD_DIR}/ ─────────────────"
shopt -s nullglob
for src in "${CARD_DIR}"/*.png "${CARD_DIR}"/*.jpg; do
  base="${src%.*}"
  out="${base}.jpg"
  before=$(du -k "$src" | cut -f1)
  $IM "$src" \
    -resize "x${MAX_HEIGHT}>" \
    -quality $QUALITY \
    -sampling-factor 4:2:0 \
    -strip \
    "$out"
  # If source was PNG and we just made a .jpg, remove the original PNG
  [[ "$src" != "$out" ]] && rm -f "$src"
  after=$(du -k "$out" | cut -f1)
  printf "  %-40s %5d KB → %d KB\n" "$(basename "$out")" "$before" "$after"
done

echo ""
echo "── Compressing card back ────────────────────────────────────"
BACK_SRC=""
[[ -f "images/SOG_Card_Back.png" ]] && BACK_SRC="images/SOG_Card_Back.png"
[[ -f "images/SOG_Card_Back.jpg" ]] && BACK_SRC="images/SOG_Card_Back.jpg"

if [[ -n "$BACK_SRC" ]]; then
  before=$(du -k "$BACK_SRC" | cut -f1)
  $IM "$BACK_SRC" \
    -resize "x${MAX_HEIGHT}>" \
    -quality $QUALITY \
    -sampling-factor 4:2:0 \
    -strip \
    "images/SOG_Card_Back.jpg"
  [[ "$BACK_SRC" != "images/SOG_Card_Back.jpg" ]] && rm -f "$BACK_SRC"
  after=$(du -k "images/SOG_Card_Back.jpg" | cut -f1)
  printf "  %-40s %5d KB → %d KB\n" "SOG_Card_Back.jpg" "$before" "$after"
else
  echo "  images/SOG_Card_Back.png/jpg not found — skipping"
fi

echo ""
echo "Done."
