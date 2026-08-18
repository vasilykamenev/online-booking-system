import "server-only";
import sharp from "sharp";

/**
 * Master-image cap for stored vessel photos. 20" monitors ship at up to
 * 1920x1080 (~110 ppi) at DPR 1 — this display class is never Retina, so a
 * full-bleed hero photo never needs more than the viewport's CSS pixel width.
 * 2560 adds ~33% headroom for OS display scaling (125%/150%) without storing
 * pixels no browser at this screen size can ever show.
 */
export const MAX_IMAGE_DIMENSION = 2560;
export const IMAGE_QUALITY = 80;
// Decode-time guard against decompression-bomb style inputs (huge pixel count
// hiding behind a small compressed size) — independent of the output cap above.
const MAX_INPUT_PIXELS = 40_000_000; // ~40 MP, e.g. an 8000x5000 source photo

export const OPTIMIZED_IMAGE_CONTENT_TYPE = "image/webp";
export const OPTIMIZED_IMAGE_EXTENSION = "webp";

/**
 * Downscales to {@link MAX_IMAGE_DIMENSION} (never upscales) and re-encodes as
 * WebP. Also applies EXIF orientation and strips metadata (incl. GPS tags a
 * phone photo may carry) via `.rotate()` with no arguments.
 */
export async function optimizeImage(input: ArrayBuffer): Promise<Buffer> {
  return sharp(Buffer.from(input), { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_QUALITY, effort: 4 })
    .toBuffer();
}
