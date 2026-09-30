// Page-level editing pipeline built on pdf-lib. Every operation takes the
// current document bytes and returns fresh bytes; the caller reloads the
// viewer in place.
import { PDFDocument, degrees, StandardFonts, rgb } from "pdf-lib";

export async function loadDoc(bytes: ArrayBuffer): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

// (loadDoc already passes ignoreEncryption; kept as single entry point)

export async function deletePages(bytes: ArrayBuffer, pages: number[]): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const sorted = [...pages].sort((a, b) => b - a);
  if (sorted.length >= doc.getPageCount()) throw new Error("不能删除全部页面");
  for (const p of sorted) doc.removePage(p - 1);
  return doc.save();
}

export async function insertBlankAfter(bytes: ArrayBuffer, page: number): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const size = doc.getPage(page - 1).getSize();
  doc.insertPage(page, [size.width, size.height]);
  return doc.save();
}

export async function rotatePages(bytes: ArrayBuffer, pages: number[], delta: number): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  for (const p of pages) {
    const page = doc.getPage(p - 1);
    const cur = page.getRotation().angle;
    page.setRotation(degrees((cur + delta + 720) % 360));
  }
  return doc.save();
}

export async function extractPages(bytes: ArrayBuffer, pages: number[]): Promise<Uint8Array> {
  const src = await loadDoc(bytes);
  const out = await PDFDocument.create();
  const ordered = [...pages].sort((a, b) => a - b);
  const copied = await out.copyPages(src, ordered.map((p) => p - 1));
  copied.forEach((pg) => out.addPage(pg));
  return out.save();
}

export async function appendDocument(bytes: ArrayBuffer, other: ArrayBuffer): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const src = await loadDoc(other);
  const copied = await doc.copyPages(src, src.getPageIndices());
  copied.forEach((pg) => doc.addPage(pg));
  return doc.save();
}

export interface TextBoxMark {
  page: number; // 1-based
  xRatio: number; // 0..1 from page left
  yRatio: number; // 0..1 from page top (top of text)
  text: string;
  size: number;
}

export interface WatermarkOptions {
  text: string;
  size: number;
  opacity: number;
}

// Draws session text boxes + optional diagonal watermark, baking them into
// the exported bytes. CJK text needs an embedded font; falls back to
// Helvetica with non-latin characters stripped when no system font found.
export async function bakeText(
  bytes: ArrayBuffer,
  textBoxes: TextBoxMark[],
  watermark: WatermarkOptions | null,
  loadSystemFont: () => Promise<Uint8Array | null>
): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  let cjkFont: Awaited<ReturnType<PDFDocument["embedFont"]>> | undefined;
  try {
    const ttf = await loadSystemFont();
    if (ttf) cjkFont = await doc.embedFont(ttf, { subset: true });
  } catch {
    cjkFont = undefined;
  }
  const latin = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontFor = (text: string) =>
    cjkFont && /[^\x00-\x7F]/.test(text) ? cjkFont : latin;

  if (watermark && watermark.text.trim()) {
    const font = fontFor(watermark.text);
    const safe = /[^\x00-\x7F]/.test(watermark.text) || cjkFont
      ? watermark.text
      : watermark.text.replace(/[^\x00-\x7F]/g, "");
    const size = watermark.size;
    for (let i = 0; i < doc.getPageCount(); i++) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(safe, size);
      page.drawText(safe, {
        x: width / 2 - textWidth / 2,
        y: height / 2 - size / 2,
        size,
        font,
        color: rgb(0.55, 0.55, 0.55),
        opacity: watermark.opacity,
        rotate: degrees(45),
      });
    }
  }

  for (const mark of textBoxes) {
    if (mark.page < 1 || mark.page > doc.getPageCount()) continue;
    const page = doc.getPage(mark.page - 1);
    const { width, height } = page.getSize();
    const font = fontFor(mark.text);
    const safe = /[^\x00-\x7F]/.test(mark.text) || cjkFont
      ? mark.text
      : mark.text.replace(/[^\x00-\x7F]/g, "");
    page.drawText(safe, {
      x: mark.xRatio * width + 4,
      y: height - mark.yRatio * height - mark.size - 2,
      size: mark.size,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }
  return doc.save();
}
