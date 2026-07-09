"use server";

import Anthropic from "@anthropic-ai/sdk";
import { requireUniversityAccess } from "@/lib/authz";

const client = new Anthropic();

const OCR_PROMPT =
  "This is a cropped photo of a small paper card someone is holding up with a printed number on it. Reply with ONLY the digits printed on the card, nothing else — no words, no punctuation. If you cannot read any digits on the card, reply with exactly: NONE";

/**
 * Runs OCR on a small cropped region around a tag click (not the whole giant group photo) using
 * Claude Haiku 4.5 vision — chosen after a Tesseract.js spike returned empty/wrong output on
 * real card crops even with heavy preprocessing.
 */
export async function ocrCardCrop(universityId: string, formData: FormData): Promise<{ code: string | null }> {
  await requireUniversityAccess(universityId);

  const file = formData.get("crop");
  if (!(file instanceof File) || file.size === 0) return { code: null };

  const buf = Buffer.from(await file.arrayBuffer());
  const mediaType = file.type === "image/png" ? "image/png" : "image/jpeg";

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 20,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } },
          { type: "text", text: OCR_PROMPT },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
  const digits = raw.replace(/\D+/g, "");
  return { code: digits || null };
}
