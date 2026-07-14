import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, PageOrientation, Paragraph, TextRun } from "docx";
import sharp from "sharp";
import { toThaiNumeral } from "./exportFormat";

export type TagForWordExport = {
  id: string;
  name: string;
  row: number;
  order: number;
  editedViaPublicLink: boolean;
  confirmedViaPublicLink: boolean;
};

// Content area of a landscape Letter page (11in wide) at 96dpi with 0.5in margins each side:
// (11 - 1) * 96 = 960px wide. Leave a little breathing room below that, and cap the height too
// (some rare near-square photos) so the image never spills onto a second page by itself.
const MAX_DISPLAY_WIDTH_PX = 900;
const MAX_DISPLAY_HEIGHT_PX = 560;
// Longest-side cap for the actual embedded pixel data — this is what keeps the .docx file size
// reasonable, independent of how small the image is *displayed* in the doc (a 20MB+ source photo
// re-compressed to this still looks sharp at the display size above).
const MAX_EMBEDDED_DIMENSION_PX = 2000;
const MARGIN_TWIPS = 720; // 0.5in
// A name someone actually verified via the public link (confirmed as-is, or corrected) takes
// priority over the plain "problem" red — a human already looked at it, that's more trustworthy
// than the automatic matched/unmatched flag, even if the code still doesn't match anything.
const VERIFIED_NAME_COLOR = "006400"; // dark green

async function fetchAndCompressImage(imageUrl: string): Promise<{ buffer: Buffer; width: number; height: number }> {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`Failed to fetch photo for export (${resp.status})`);
  const original = sharp(Buffer.from(await resp.arrayBuffer()));
  const metadata = await original.metadata();
  const sourceWidth = metadata.width ?? MAX_EMBEDDED_DIMENSION_PX;
  const sourceHeight = metadata.height ?? MAX_EMBEDDED_DIMENSION_PX;

  const scale = Math.min(1, MAX_EMBEDDED_DIMENSION_PX / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const buffer = await original.resize(width, height).jpeg({ quality: 82 }).toBuffer();
  return { buffer, width, height };
}

function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Builds the "Export Word" report: title, the group photo itself, and the row-by-row name list
 * (same grouping/labels as the plain-text export) with problem-flagged names in red — landscape
 * so a wide group photo actually fits legibly on the page.
 */
export async function buildGroupPhotoWordDoc(input: {
  title: string;
  imageUrl: string;
  tags: TagForWordExport[];
  problemTagIds: Set<string>;
}): Promise<Buffer> {
  const { buffer: imageBuffer, width, height } = await fetchAndCompressImage(input.imageUrl);
  const display = fitWithin(width, height, MAX_DISPLAY_WIDTH_PX, MAX_DISPLAY_HEIGHT_PX);

  const byRow = new Map<number, TagForWordExport[]>();
  for (const t of input.tags) {
    const arr = byRow.get(t.row) ?? [];
    arr.push(t);
    byRow.set(t.row, arr);
  }
  for (const arr of byRow.values()) arr.sort((a, b) => a.order - b.order);
  const rows = [...byRow.keys()].sort((a, b) => a - b);

  const nameListParagraphs = rows.map((row) => {
    const rowTags = byRow.get(row) ?? [];
    const label = row === 0 ? "แถวหน้านั่งจากซ้าย" : `แถวยืนที่ ${toThaiNumeral(row)} จากซ้าย`;
    const runs: TextRun[] = [new TextRun({ text: `${label}\t`, bold: true })];
    rowTags.forEach((t, i) => {
      const isVerified = t.editedViaPublicLink || t.confirmedViaPublicLink;
      const isProblem = input.problemTagIds.has(t.id);
      runs.push(
        new TextRun({
          text: t.name.trim() || "(ยังไม่มีชื่อ)",
          color: isVerified ? VERIFIED_NAME_COLOR : isProblem ? "FF0000" : "000000",
        }),
      );
      if (i < rowTags.length - 1) runs.push(new TextRun({ text: ", " }));
    });
    return new Paragraph({ children: runs, spacing: { after: 120 } });
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: MARGIN_TWIPS, bottom: MARGIN_TWIPS, left: MARGIN_TWIPS, right: MARGIN_TWIPS },
          },
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({ text: input.title })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [
              new ImageRun({
                type: "jpg",
                data: imageBuffer,
                transformation: { width: display.width, height: display.height },
              }),
            ],
          }),
          ...nameListParagraphs,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
