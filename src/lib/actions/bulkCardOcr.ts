"use server";

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { requireUniversityAccess } from "@/lib/authz";

const client = new Anthropic();

// Reading multiple cards per crop (instead of one crop per person, see ocr.ts) needs a very
// different prompt than the single-card case — verified empirically against a real dense sample
// photo before shipping this:
// - Asking for a 0-1000 NORMALIZED coordinate (an earlier version of this prompt) turned out to
//   be unreliable on real, dense/complex photos: checked against a real 93-person tile, 77% of
//   returned hits fell outside the instructed [0,1000] range entirely (values up to ~1550), with
//   values suspiciously close to the tile's actual uploaded pixel size — i.e. the model was
//   silently reporting real pixel coordinates instead of normalizing, for a majority of hits.
//   Switching to explicitly telling the model the image's real pixel dimensions and asking for
//   real pixel coordinates within them (below) eliminated the problem on that same tile (0/51
//   hits out of range) — grounding the request in what the model can directly observe (the
//   image it's looking at) beats asking it to silently rescale to an abstract convention.
// - Without being told explicitly, the model anchors the position to the person's FACE rather
//   than the card itself.
// - When several people stand close together, a correctly-read number can get reported at a
//   NEIGHBORING person's position — smaller crops (fewer people each) reduce this a lot; the
//   explicit warning below helps further but doesn't eliminate it entirely, so callers should
//   still treat these as suggestions a human reviews before saving, same as face-detect candidates.
function buildPrompt(width: number, height: number): string {
  return `This is a cropped section of a large group photo, showing several people. Each person is holding up a small paper card with a printed number on it, roughly at chest/shoulder height, BELOW their own face.

This image is exactly ${width}x${height} pixels. For EVERY card in this image where the digits are clearly legible, report its digits and the position of the CENTER OF THE CARD ITSELF (not the person's face, not the person's body — the small paper card) as PIXEL coordinates within THIS image, where (0,0) is the top-left corner and (${width},${height}) is the bottom-right corner.

Each card belongs to exactly one person, the one physically holding it. Double check you are not reporting a number using a neighboring person's card position.

Reply with ONLY a JSON array, no other text, no markdown fences. Format: [{"code":"1234","x":783,"y":1230}, ...]

If a card is cut off at the edge of the crop or its digits are not clearly legible, skip it entirely rather than guessing.`;
}

export type CardOcrHit = { code: string; x: number; y: number };

/**
 * Runs OCR on one tile crop of a group photo (not the whole image — see useBulkCardOcr, which
 * tiles the full photo into small overlapping crops), reading every legible card number and its
 * position within that crop at once, rather than one card per call like ocrCardCrop.
 *
 * `"use server"` wrapper only — `requireUniversityAccess` needs a real session, which the
 * background auto-tag cron job doesn't have (it's authenticated at the request level via
 * CRON_SECRET instead). The actual Claude call lives in `runCardGridOcr` below so the cron route
 * can call it directly, without going through a user-facing action.
 */
export async function ocrCardGrid(
  universityId: string,
  formData: FormData,
): Promise<{ hits: CardOcrHit[]; width: number; height: number }> {
  await requireUniversityAccess(universityId);

  const file = formData.get("crop");
  if (!(file instanceof File) || file.size === 0) return { hits: [], width: 0, height: 0 };

  const buf = Buffer.from(await file.arrayBuffer());
  const mediaType = file.type === "image/png" ? "image/png" : "image/jpeg";
  return runCardGridOcr(buf, mediaType);
}

/** Core OCR call, with no auth check — see `ocrCardGrid`'s comment for why this is separate. */
export async function runCardGridOcr(
  buf: Buffer,
  mediaType: "image/jpeg" | "image/png",
): Promise<{ hits: CardOcrHit[]; width: number; height: number }> {
  // Read the ACTUAL dimensions of what was uploaded (rather than trusting the caller to pass them
  // separately) so the prompt's stated size can never drift from the real image bytes the model sees.
  const meta = await sharp(buf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const response = await client.messages.create({
    // Verified empirically (real 93-person sample, ground-truth checked) against the previous
    // claude-haiku-4-5 config: sonnet-5 + bigger tiles is both more accurate (100% vs 97.8% recall,
    // no neighbor position mix-ups) and cheaper overall (far fewer tiles more than offsets the
    // higher per-token rate). Thinking explicitly disabled — left at its adaptive default it burns
    // extra output tokens for no accuracy benefit on this structured-extraction task.
    model: "claude-sonnet-5",
    thinking: { type: "disabled" },
    // Bigger tiles (see useBulkCardOcr.ts) mean far more cards per response than the old 600px
    // tiles — up to ~80+ hits observed in testing, each needing ~20-30 tokens, so the previous 1500
    // ceiling would truncate mid-response on a dense crowd.
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: buf.toString("base64") },
          },
          { type: "text", text: buildPrompt(width, height) },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "[]";
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```\s*$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { hits: [], width, height };
  }
  if (!Array.isArray(parsed)) return { hits: [], width, height };

  const hits: CardOcrHit[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { code, x, y } = entry as Record<string, unknown>;
    const digits = String(code ?? "").replace(/\D/g, "");
    const nx = Number(x);
    const ny = Number(y);
    if (digits.length < 3 || digits.length > 5) continue;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
    hits.push({ code: digits, x: nx, y: ny });
  }
  return { hits, width, height };
}
