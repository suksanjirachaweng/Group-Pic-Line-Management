"use client";

import { useRef, useState, useTransition } from "react";
import { fetchLiffAppSuggestions } from "@/lib/actions/channels";

export function LiffIdField({ channelId, defaultValue }: { channelId: string; defaultValue: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFetch() {
    setError(null);
    setSuggestions(null);
    startTransition(async () => {
      const result = await fetchLiffAppSuggestions(channelId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.liffIds.length === 1) {
        if (inputRef.current) inputRef.current.value = result.liffIds[0];
      } else {
        setSuggestions(result.liffIds);
      }
    });
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">LIFF ID</label>
      <div className="mt-1 flex gap-2">
        <input
          ref={inputRef}
          name="liffId"
          defaultValue={defaultValue}
          required
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={handleFetch}
          disabled={isPending}
          className="shrink-0 rounded-md border border-[#06C755] px-3 py-2 text-xs font-medium text-[#06C755] hover:bg-[#06C755]/10 disabled:opacity-50"
        >
          {isPending ? "Fetching..." : "Fetch from LINE"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {suggestions && (
        <div className="mt-1 flex flex-wrap gap-1">
          {suggestions.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (inputRef.current) inputRef.current.value = id;
                setSuggestions(null);
              }}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              {id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
