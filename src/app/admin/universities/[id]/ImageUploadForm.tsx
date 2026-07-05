"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ImageActionState } from "@/lib/actions/images";

function UploadButtonLabel({ hasImage }: { hasImage: boolean }) {
  const { pending } = useFormStatus();
  return <>{pending ? "Uploading..." : hasImage ? "Replace image" : "Add image"}</>;
}

export function ImageUploadForm({
  action,
  fieldName,
  hasImage,
  size = "normal",
}: {
  action: (prevState: ImageActionState, formData: FormData) => Promise<ImageActionState>;
  fieldName: string;
  hasImage: boolean;
  size?: "normal" | "compact";
}) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <form ref={formRef} action={formAction}>
        <input
          ref={inputRef}
          type="file"
          name={fieldName}
          accept="image/png,image/jpeg,image/webp,image/gif"
          required
          className="hidden"
          onChange={() => formRef.current?.requestSubmit()}
        />
        <button
          type="button"
          onClick={() => {
            if (inputRef.current) inputRef.current.value = "";
            inputRef.current?.click();
          }}
          className={
            size === "compact"
              ? "rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              : "rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          }
        >
          <UploadButtonLabel hasImage={hasImage} />
        </button>
      </form>
      {state && "error" in state && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
