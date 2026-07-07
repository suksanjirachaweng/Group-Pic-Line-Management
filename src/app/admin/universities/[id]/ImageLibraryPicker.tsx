"use client";

import { useState, useTransition } from "react";
import { listImageLibrary, type LibraryImage, type ImageActionState } from "@/lib/actions/images";

export function ImageLibraryPicker({
  universityId,
  onSelect,
  size = "normal",
}: {
  universityId: string;
  onSelect: (url: string) => Promise<ImageActionState>;
  size?: "normal" | "compact";
}) {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<LibraryImage[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleOpen() {
    setOpen(true);
    setError(null);
    if (images === null) {
      startTransition(async () => {
        setImages(await listImageLibrary(universityId));
      });
    }
  }

  function handleSelect(url: string) {
    startTransition(async () => {
      const result = await onSelect(url);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={
          size === "compact"
            ? "rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            : "rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        }
      >
        Choose from library
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Choose an already-uploaded image</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>
            {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
            {images === null ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : images.length === 0 ? (
              <p className="text-sm text-gray-400">No images uploaded yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {images.map((img) => (
                  <button
                    key={img.url}
                    type="button"
                    disabled={isPending}
                    onClick={() => handleSelect(img.url)}
                    className="group flex flex-col items-center gap-1 rounded-md border border-gray-200 p-1.5 text-left hover:border-indigo-400 disabled:opacity-50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="h-20 w-full rounded object-cover" />
                    <span className="w-full truncate text-[10px] text-gray-500 group-hover:text-indigo-600">
                      {img.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
