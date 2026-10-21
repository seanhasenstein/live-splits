import sharp from "sharp";

/** An uploaded image as the stored logo: trimmed, fit in 256×256 on transparent, PNG. */
export async function logoPng(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .trim({ threshold: 10 })
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
}
