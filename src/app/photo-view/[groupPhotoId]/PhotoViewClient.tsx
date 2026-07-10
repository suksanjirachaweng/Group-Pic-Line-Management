"use client";

import { useState } from "react";
import { ReviewCanvas, type ReviewTag } from "@/lib/groupPhoto/ReviewCanvas";

export function PhotoViewClient({
  photoName,
  imageUrl,
  imageWidth,
  imageHeight,
  tags,
  initialTagId,
}: {
  photoName: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  tags: { id: string; code: string; name: string; row: number; order: number; x: number; y: number }[];
  initialTagId: string | null;
}) {
  const [selectedTagId, setSelectedTagId] = useState(initialTagId);
  const reviewTags: ReviewTag[] = tags.map((t) => ({ ...t, isProblem: false }));

  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-gray-900">{photoName}</h1>
        <p className="text-xs text-gray-600">
          {initialTagId ? "จุดสีเหลืองคือตำแหน่งของคุณ" : "รูปถ่ายหมู่"}
        </p>
      </div>
      <div className="flex-1">
        <ReviewCanvas
          imageUrl={imageUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          tags={reviewTags}
          selectedTagId={selectedTagId}
          onSelectTag={setSelectedTagId}
          readOnly
        />
      </div>
    </div>
  );
}
