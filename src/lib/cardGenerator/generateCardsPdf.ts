import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// Matches the studio's existing pre-printed number cards exactly: 6"x4" landscape (432x288pt at
// 72pt/inch), confirmed via `pdfinfo` against a real sample batch PDF.
const PAGE_WIDTH = 432;
const PAGE_HEIGHT = 288;
const MARGIN = 14;

const FONT_DIR = path.join(process.cwd(), "src/lib/cardGenerator/fonts");
const FONT_REGULAR = path.join(FONT_DIR, "THSarabun.ttf");
const FONT_BOLD = path.join(FONT_DIR, "THSarabun-Bold.ttf");
const LOGO_PATH = path.join(process.cwd(), "public/nsl-logo.png");

const SHOP_NAME = "ห้องภาพนิวซาลอน";
const SHOP_PHONE = "02-233-2276";
// nsl-logo.png is a 154x60 wordmark (not a square icon) — its rendered width at a given height
// must be computed from its real aspect ratio, or text placed "next to" it at a fixed offset
// overlaps the logo's own right edge (confirmed visually: text was rendering on top of the mark).
const LOGO_NATIVE_W = 154;
const LOGO_NATIVE_H = 60;
const LOGO_HEIGHT = 18;
const LOGO_WIDTH = (LOGO_HEIGHT * LOGO_NATIVE_W) / LOGO_NATIVE_H;
const TITLE_CHECKBOXES = ["ศ", "รศ", "ผศ", "ดร", "อ"];

export type CardGeneratorOptions = {
  startCode: number;
  endCode: number;
  includeQr: boolean;
  includeFillIn: boolean;
  includeBrand: boolean;
  eventName: string;
  year: string;
  /** Absolute origin (e.g. https://group-pic-line-management.vercel.app) the QR code should point
   * registration at — read from the browser at request time (`window.location.origin`), same
   * pattern already used by SharePhotoLinksButton, rather than a hardcoded/env-derived value. */
  origin: string;
  universitySlug: string;
};

/** Shrink-to-fit the largest font size (in 1pt steps) whose rendered width fits maxWidth. */
function fitFontSize(doc: PDFKit.PDFDocument, text: string, maxWidth: number, maxSize: number, minSize = 10): number {
  let size = maxSize;
  while (size > minSize && doc.fontSize(size).widthOfString(text) > maxWidth) {
    size -= 1;
  }
  return size;
}

function drawDottedLine(doc: PDFKit.PDFDocument, x1: number, y: number, x2: number) {
  doc.save();
  doc.dash(1, { space: 2 }).moveTo(x1, y).lineTo(x2, y).stroke("#666666");
  doc.undash();
  doc.restore();
}

/** Right-pointing arrow banner, matching the studio's existing card design. */
function drawScanArrow(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number) {
  // A larger notch (most of the bar's height) reads as a clear arrowhead at this size — h/2 was
  // too shallow and looked like a plain rectangle with a clipped corner.
  const notch = h * 0.85;
  doc
    .save()
    .path(
      `M ${x} ${y} L ${x + w - notch} ${y} L ${x + w} ${y + h / 2} L ${x + w - notch} ${y + h} L ${x} ${y + h} Z`,
    )
    .fill("#000000")
    .restore();
  // The arrow can end up quite narrow once a fill-in box and QR both share the bottom band —
  // shrink-to-fit rather than a fixed size, or "SCAN TO REGISTER" silently clips to "SCAN TO"
  // (found via a real generated card, not caught by the earlier structural-only verification).
  const labelWidth = w - notch - 10;
  doc.font("Sarabun-Bold");
  const labelSize = fitFontSize(doc, "SCAN TO REGISTER", labelWidth, 11, 6);
  doc
    .fontSize(labelSize)
    .fillColor("#ffffff")
    .text("SCAN TO REGISTER", x + 6, y + h / 2 - labelSize / 2, { width: labelWidth, align: "center" });
  doc.fillColor("#000000");
}

function drawFillInBox(doc: PDFKit.PDFDocument, x: number, y: number, w: number) {
  doc.font("Sarabun-Bold").fontSize(11);
  doc.text("เขียนตัวบรรจง", x, y, { underline: true });
  const labelWidth = doc.widthOfString("เขียนตัวบรรจง");

  let cbX = x + labelWidth + 10;
  const cbY = y + 1;
  for (const label of TITLE_CHECKBOXES) {
    doc.rect(cbX, cbY, 9, 9).stroke("#000000");
    doc.font("Sarabun").fontSize(9).text(label, cbX + 11, cbY - 1);
    cbX += 11 + doc.widthOfString(label) + 6;
  }

  const lines = [
    { label: "ชื่อ Name", labelWidth: 0.28 },
    { label: "นามสกุล Surname", labelWidth: 0.35 },
    { label: "คณะ faculty", labelWidth: 0.3, extra: "Phone" },
    { label: "คนด้านซ้าย Left Person", labelWidth: 0.5 },
  ];
  let lineY = y + 20;
  doc.font("Sarabun").fontSize(11);
  for (const line of lines) {
    doc.text(line.label, x, lineY);
    const labelEndX = x + doc.widthOfString(line.label) + 4;
    if (line.extra) {
      const midX = x + w * 0.62;
      drawDottedLine(doc, labelEndX, lineY + 11, midX - 4);
      doc.text(line.extra, midX, lineY);
      drawDottedLine(doc, midX + doc.widthOfString(line.extra) + 4, lineY + 11, x + w);
    } else {
      drawDottedLine(doc, labelEndX, lineY + 11, x + w);
    }
    lineY += 13.5;
  }
}

async function buildQrBuffer(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { margin: 1, width: 300 });
}

export async function generateCardsPdf(options: CardGeneratorOptions): Promise<Buffer> {
  const {
    startCode,
    endCode,
    includeQr,
    includeFillIn,
    includeBrand,
    eventName,
    year,
    origin,
    universitySlug,
  } = options;

  const qrBuffer = includeQr ? await buildQrBuffer(`${origin}/register/${universitySlug}`) : null;

  // `font: null` skips pdfkit's default-font init, which reads a bundled Helvetica .afm metrics
  // file from a path that doesn't survive Next.js/Turbopack bundling (ENOENT at runtime) — we
  // register and use our own embedded Thai font immediately below instead.
  const doc = new PDFDocument({
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    margin: 0,
    autoFirstPage: false,
    font: null as unknown as string,
  });
  doc.registerFont("Sarabun", FONT_REGULAR);
  doc.registerFont("Sarabun-Bold", FONT_BOLD);
  // registerFont only makes a font available by name — it doesn't activate one, so `doc._font`
  // stays null (and any width/size call throws) until something calls .font(). Activate
  // immediately so the very first page-level call (e.g. fitFontSize, before any text is drawn)
  // never runs with no active font — reproduced with brand/eventName/year all off, where nothing
  // else happened to call .font() first.
  doc.font("Sarabun");

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const bottomBandY = 200;
  const bottomBandHeight = PAGE_HEIGHT - bottomBandY - MARGIN;
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  for (let code = startCode; code <= endCode; code++) {
    doc.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });

    if (includeBrand) {
      doc.image(LOGO_PATH, MARGIN, MARGIN - 2, { height: LOGO_HEIGHT });
      doc
        .font("Sarabun")
        .fontSize(11)
        .fillColor("#000000")
        .text(`${SHOP_NAME}  ${SHOP_PHONE}`, MARGIN + LOGO_WIDTH + 8, MARGIN, { lineBreak: false });
    }

    if (eventName.trim() || year.trim()) {
      const headerRight = [eventName.trim(), year.trim()].filter(Boolean).join("  ");
      doc
        .font("Sarabun")
        .fontSize(11)
        .fillColor("#000000")
        .text(headerRight, MARGIN, MARGIN, { width: contentWidth, align: "right", lineBreak: false });
    }

    const codeStr = String(code);
    const codeSize = fitFontSize(doc, codeStr, contentWidth - 20, 150);
    doc
      .font("Sarabun-Bold")
      .fontSize(codeSize)
      .fillColor("#000000")
      .text(codeStr, MARGIN, 50, { width: contentWidth, align: "center" });

    if (includeFillIn && includeQr) {
      // Leaves the arrow section (fillInWidth is the only free variable here — QR is a fixed
      // square, MARGIN/gaps are constants) enough room for "SCAN TO REGISTER" at a readable size;
      // 0.55 left it too narrow and the label was clipping.
      const fillInWidth = contentWidth * 0.48;
      drawFillInBox(doc, MARGIN, bottomBandY, fillInWidth);

      const qrSize = bottomBandHeight;
      // A small gap before the QR — with 0 gap the arrow's point visually fused into the QR's own
      // edge instead of reading as a separate arrowhead pointing at it.
      const arrowGap = 6;
      const arrowW = contentWidth - fillInWidth - 14 - qrSize - arrowGap;
      const arrowX = MARGIN + fillInWidth + 14;
      drawScanArrow(doc, arrowX, bottomBandY + bottomBandHeight / 2 - 9, arrowW, 18);
      // A fresh Buffer copy per page — reusing the exact same Buffer object across many
      // doc.image() calls corrupted the PDF's xref table past the first page (confirmed via
      // `pdftoppm`: "XObject 'I3' is unknown" on page 2 onward). Recomputing the QR PNG per page
      // would also work but costs far more CPU for no benefit; copying the small cached buffer is
      // cheap and sidesteps whatever internal state pdfkit keys off the buffer identity for.
      doc.image(Buffer.from(qrBuffer!), PAGE_WIDTH - MARGIN - qrSize, bottomBandY, {
        width: qrSize,
        height: qrSize,
      });
    } else if (includeFillIn) {
      drawFillInBox(doc, MARGIN, bottomBandY, contentWidth);
    } else if (includeQr) {
      const qrSize = bottomBandHeight;
      const arrowGap = 6;
      const arrowW = contentWidth - qrSize - 14 - arrowGap;
      drawScanArrow(doc, MARGIN, bottomBandY + bottomBandHeight / 2 - 9, arrowW, 18);
      doc.image(Buffer.from(qrBuffer!), PAGE_WIDTH - MARGIN - qrSize, bottomBandY, {
        width: qrSize,
        height: qrSize,
      });
    }
  }

  doc.end();
  return done;
}
