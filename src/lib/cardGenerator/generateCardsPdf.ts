import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// Matches the studio's existing pre-printed number cards exactly: 6"x4" landscape (432x288pt at
// 72pt/inch), confirmed via `pdfinfo` against a real sample batch PDF.
const PAGE_WIDTH = 432;
const PAGE_HEIGHT = 288;
const MARGIN = 14;
// fitFontSizeBox() below fills the number's box as fully as possible — this trims that back down
// a bit, since the max-fit size read as slightly too large/close to the box edge against a real
// printed sample (user comparison, 2026-07-19).
const CODE_SIZE_SCALE = 0.92;

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
// QR-only layout (no fill-in box) uses a bigger logo/brand text than every other layout — its
// header is a single compact row instead of sharing space with a fill-in box, so there's room to
// make the brand mark more prominent (2026-07-20 request).
const QR_LAYOUT_LOGO_HEIGHT = 26;
const QR_LAYOUT_LOGO_WIDTH = (QR_LAYOUT_LOGO_HEIGHT * LOGO_NATIVE_W) / LOGO_NATIVE_H;
const QR_LAYOUT_BRAND_FONT_SIZE = 14;
const TITLE_CHECKBOXES = ["ศ", "รศ", "ผศ", "ดร", "อ"];
const RETURN_REMINDER = "โปรดส่งคืนหลังถ่ายภาพเสร็จ";

export type CardGeneratorOptions = {
  startCode: number;
  endCode: number;
  includeQr: boolean;
  includeFillIn: boolean;
  includeBrand: boolean;
  eventName: string;
  year: string;
  /** The LINE channel's own "add friend" URL (same link/QR shown on the channel management page,
   * e.g. https://line.me/R/ti/p/@xxxxx) — scanning it opens LINE directly and adds the studio's OA
   * as a friend, which is what a phone camera scan of a printed card needs (a plain /register/
   * link opens in an external browser instead of LINE). Required whenever includeQr is true. */
  qrUrl: string | null;
};

/** Shrink-to-fit the largest font size (in 1pt steps) whose rendered width fits maxWidth. */
function fitFontSize(doc: PDFKit.PDFDocument, text: string, maxWidth: number, maxSize: number, minSize = 10): number {
  let size = maxSize;
  while (size > minSize && doc.fontSize(size).widthOfString(text) > maxWidth) {
    size -= 1;
  }
  return size;
}

/** The font's cap-height (glyph height above baseline, in em-relative 1000ths) — not exposed in
 * PDFKit's public types, but present at runtime on the internal font object. */
function capHeightRatio(doc: PDFKit.PDFDocument): number {
  const internalFont = (doc as unknown as { _font: { capHeight: number } })._font;
  return internalFont.capHeight / 1000;
}

/** Shrink-to-fit against BOTH a max width and a max height, using the font's cap-height (the
 * actual vertical extent of digit glyphs) rather than currentLineHeight(). currentLineHeight()
 * spans the font's full ascender-to-descender range, which for a Thai typeface is ~2.3x taller
 * than a digit's cap-height because it reserves room for tone marks/vowels that sit well above
 * and below the baseline — text with no such marks (e.g. a card number) only ever needs
 * cap-height, so fitting against line-height left most of the box empty. Caller must have already
 * set the intended font (e.g. `doc.font("Sarabun-Bold")`) before calling this, since bold glyphs
 * are wider than regular at the same size and measuring with the wrong font under-fits. */
function fitFontSizeBox(
  doc: PDFKit.PDFDocument,
  text: string,
  maxWidth: number,
  maxHeight: number,
  maxSize: number,
  minSize = 10,
): number {
  const capRatio = capHeightRatio(doc);
  let size = maxSize;
  while (size > minSize) {
    doc.fontSize(size);
    if (doc.widthOfString(text) <= maxWidth && capRatio * size <= maxHeight) break;
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

/** Left-aligned footnote reminding whoever's holding the card to hand it back — mirrors the
 * event-name/year footer's own position/size so the two can share the bottom row (that footer is
 * right-aligned, this is left-aligned, so they never collide even when both are present). Only
 * called where the bottom band actually has free space; layouts where the fill-in box or QR
 * already fill that band are left alone rather than cramming another line into them. */
function drawReturnReminder(doc: PDFKit.PDFDocument, contentWidth: number) {
  doc
    .font("Sarabun")
    .fontSize(13)
    .fillColor("#000000")
    .text(RETURN_REMINDER, MARGIN, PAGE_HEIGHT - MARGIN - 15, { width: contentWidth, align: "left", lineBreak: false });
}

/** Right-aligned — sits in the gap between the header row (brand/event-name) and the number,
 * under the event-name text specifically (both right-aligned, so they read as one block). This
 * is the only free space in the layouts that pair a fill-in box with a QR, where the whole
 * bottom band is already spoken for. Shrink-to-fit against contentWidth as a safety net, but the
 * gap (see numberTop below) is sized to comfortably fit the max size without shrinking. */
function drawReturnReminderTop(doc: PDFKit.PDFDocument, contentWidth: number) {
  doc.font("Sarabun");
  const size = fitFontSize(doc, RETURN_REMINDER, contentWidth, 13, 7);
  doc
    .fontSize(size)
    .fillColor("#000000")
    .text(RETURN_REMINDER, MARGIN, MARGIN + 15, { width: contentWidth, align: "right", lineBreak: false });
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
    qrUrl,
  } = options;

  const qrBuffer = includeQr && qrUrl ? await buildQrBuffer(qrUrl) : null;

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
  // qrBuffer is null if includeQr was requested but no qrUrl was resolvable (e.g. university has
  // no LINE channel yet) — falls back to the fill-in-only/no-QR layout rather than drawing a blank box.
  const showQr = includeQr && !!qrBuffer;
  // With no fill-in box, the QR/arrow don't need to share a bottom band with anything — moves them
  // to a dedicated band near the top instead, freeing the rest of the card for a bigger number
  // (per the user's own reference layout, 2026-07-20). The combined fill-in+QR layout below is
  // unaffected — that one still needs the QR anchored to the fill-in box it's paired with.
  const qrOnlyTopLayout = showQr && !includeFillIn;
  // QR-only layout: everything (bigger logo/brand text, a shortened scan arrow, and a small QR)
  // shares one compact top row instead of the brand block and QR each getting their own dedicated
  // band — frees up far more vertical room for the number below. Event name/year moves to the
  // bottom-right corner since the top row has no space left for it (2026-07-20 redesign).
  const QR_TOP_ROW_Y = 12;
  const QR_TOP_ROW_H = 30;
  // Bigger than the row height on purpose (2026-07-20 follow-ups: "a bit bigger", then "bigger
  // still") — the QR is top-aligned with the row and allowed to extend below it; numberTop
  // (below) accounts for whichever of the row height or QR size is taller, so the number never
  // overlaps it.
  const QR_TOP_ROW_QR_SIZE = 58;
  const QR_TOP_ROW_ARROW_W = 110;
  const QR_TOP_ROW_ARROW_H = 20;
  const topRowContentH = Math.max(QR_TOP_ROW_H, QR_TOP_ROW_QR_SIZE);
  const hasEventFooter = qrOnlyTopLayout && (eventName.trim() || year.trim());
  const EVENT_FOOTER_H = 20;

  for (let code = startCode; code <= endCode; code++) {
    doc.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });

    if (qrOnlyTopLayout) {
      if (includeBrand) {
        doc.image(LOGO_PATH, MARGIN, QR_TOP_ROW_Y + (QR_TOP_ROW_H - QR_LAYOUT_LOGO_HEIGHT) / 2, {
          height: QR_LAYOUT_LOGO_HEIGHT,
        });
        doc
          .font("Sarabun")
          .fontSize(QR_LAYOUT_BRAND_FONT_SIZE)
          .fillColor("#000000")
          .text(`${SHOP_NAME}  ${SHOP_PHONE}`, MARGIN + QR_LAYOUT_LOGO_WIDTH + 8, QR_TOP_ROW_Y + (QR_TOP_ROW_H - QR_LAYOUT_BRAND_FONT_SIZE) / 2, {
            lineBreak: false,
          });
      }

      const qrX = PAGE_WIDTH - MARGIN - QR_TOP_ROW_QR_SIZE;
      const arrowGap = 8;
      const arrowX = qrX - arrowGap - QR_TOP_ROW_ARROW_W;
      const arrowY = QR_TOP_ROW_Y + (QR_TOP_ROW_H - QR_TOP_ROW_ARROW_H) / 2;
      drawScanArrow(doc, arrowX, arrowY, QR_TOP_ROW_ARROW_W, QR_TOP_ROW_ARROW_H);
      doc.image(Buffer.from(qrBuffer!), qrX, QR_TOP_ROW_Y, {
        width: QR_TOP_ROW_QR_SIZE,
        height: QR_TOP_ROW_QR_SIZE,
      });

      drawReturnReminder(doc, contentWidth);

      if (hasEventFooter) {
        const headerRight = [eventName.trim(), year.trim()].filter(Boolean).join("  ");
        doc
          .font("Sarabun")
          .fontSize(11)
          .fillColor("#000000")
          .text(headerRight, MARGIN, PAGE_HEIGHT - MARGIN - 13, { width: contentWidth, align: "right", lineBreak: false });
      }
    } else {
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

      // The bottom band is only free in the "neither" case (handled below, after the number, at
      // the bottom) — when a fill-in box or QR occupies it, this header gap is the only space
      // left, so the reminder goes here instead.
      if (includeFillIn || showQr) {
        drawReturnReminderTop(doc, contentWidth);
      }
    }

    // Fills the whole space between the header row (or the top QR row, in QR-only layout) and the
    // fill-in/QR band (or the bottom-right event footer, in QR-only layout), not a fixed
    // (previously 150pt-capped) size — the fixed cap left a lot of unused vertical room, and
    // fitFontSize's width-only check had also been measuring against the *regular* font (it ran
    // before `.font("Sarabun-Bold")` was set below), which under-fits since bold glyphs are wider.
    // 54 (not 40) in the non-QR-only branch leaves room for drawReturnReminderTop's line above.
    const numberTop = qrOnlyTopLayout ? QR_TOP_ROW_Y + topRowContentH + 14 : 54;
    const numberBottom = qrOnlyTopLayout ? PAGE_HEIGHT - MARGIN - (hasEventFooter ? EVENT_FOOTER_H : 0) : bottomBandY - 14;
    const codeStr = String(code);
    doc.font("Sarabun-Bold");
    const codeSize = fitFontSizeBox(doc, codeStr, contentWidth - 16, numberBottom - numberTop, 400, 40) * CODE_SIZE_SCALE;
    doc.fontSize(codeSize);
    // PDFKit positions .text()'s y as the top of the ascender box, with the baseline at
    // y + ascender. Centering by cap-height (not currentLineHeight) means we have to place the
    // baseline ourselves: solve for y so the glyphs' visual cap-height band sits in the middle
    // of [numberTop, numberBottom], using the same internal font metrics as fitFontSizeBox.
    const internalFont = (doc as unknown as { _font: { ascender: number; capHeight: number } })._font;
    const ascenderPt = (internalFont.ascender / 1000) * codeSize;
    const capHeightPt = (internalFont.capHeight / 1000) * codeSize;
    const boxCenterY = numberTop + (numberBottom - numberTop) / 2;
    const codeY = boxCenterY - ascenderPt + capHeightPt / 2;
    // Scoped in save/restore — the stroke reinforcement below sets a multi-point lineWidth
    // directly on `doc`, and without scoping it stays active for every stroke() drawn afterward
    // (checkbox borders, dotted fill-in lines), rendering them as solid black blocks instead of
    // thin lines. Found via a real generated card, not caught by earlier checks.
    doc.save();
    doc
      .font("Sarabun-Bold")
      .fontSize(codeSize)
      .fillColor("#000000")
      .strokeColor("#000000")
      // A stroke reinforcement on top of the already-bold face — at this size TH Sarabun Bold's
      // stroke weight alone still read as fairly light, per the user's own comparison against a
      // hand-drawn reference box.
      .lineWidth(Math.max(1, codeSize * 0.02))
      // `height` isn't a real layout constraint here (codeY is already solved by hand above via
      // cap-height centering) — it's there purely to stop PDFKit's own auto-pagination, which
      // checks the text's *nominal* ascender-to-descender line height (much taller than a digit's
      // visual cap-height) against the page bottom and silently inserts an extra blank/overflow
      // page if that nominal box would extend past it, even though nothing visually overflows.
      // Only ever surfaced once codeY was placed close enough to the bottom margin (the top-QR
      // layout) for the nominal line height to spill past page 288 — bit us as a real 2-page PDF.
      .text(codeStr, MARGIN, codeY, { width: contentWidth, height: PAGE_HEIGHT, align: "center", fill: true, stroke: true });
    doc.restore();

    if (includeFillIn && showQr) {
      const qrSize = bottomBandHeight;
      // The arrow only needs its own narrow column in the top ~18pt of the band — the fill-in
      // lines (rows below the checkbox row) start well under that and can run much wider, all the
      // way up to the QR, instead of stopping at the same boundary the arrow's column uses.
      const arrowColumnWidth = contentWidth * 0.48;
      const fillInLineWidth = contentWidth - qrSize - 10;
      drawFillInBox(doc, MARGIN, bottomBandY, fillInLineWidth);

      // A small gap before the QR — with 0 gap the arrow's point visually fused into the QR's own
      // edge instead of reading as a separate arrowhead pointing at it.
      const arrowGap = 6;
      const arrowW = contentWidth - arrowColumnWidth - 14 - qrSize - arrowGap;
      const arrowX = MARGIN + arrowColumnWidth + 14;
      // Top-aligned with the checkbox row / QR's top edge, not centered in the whole band —
      // centered left too much empty space below and read as floating too low.
      drawScanArrow(doc, arrowX, bottomBandY, arrowW, 18);
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
    } else {
      // Neither fill-in box nor QR (showQr here would mean qrOnlyTopLayout instead, handled
      // above) — the whole bottom band is otherwise empty, so there's room for the reminder.
      drawReturnReminder(doc, contentWidth);
    }
    // showQr-only (no fill-in) is already drawn above, in the dedicated top scan band.
  }

  doc.end();
  return done;
}
