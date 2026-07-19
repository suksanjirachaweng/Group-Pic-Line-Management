"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  searchFaceBankByUpload,
  type FaceBankSearchResult,
  type FacultyFaceProfileListItem,
} from "@/lib/actions/facultyFaceBank";

function SearchByFaceSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
    >
      {pending ? "กำลังค้นหา..." : "ค้นหาจากรูปภาพ"}
    </button>
  );
}

const STATUS_MESSAGE: Record<Exclude<FaceBankSearchResult["status"], "ok">, string> = {
  not_configured: "ยังไม่ได้ตั้งค่าระบบจดจำใบหน้า (PC server)",
  no_face_detected: "ไม่พบใบหน้าที่ชัดเจนในรูปนี้",
  error: "เกิดข้อผิดพลาด",
};

export function FacultyFaceBankBrowser({ profiles }: { profiles: FacultyFaceProfileListItem[] }) {
  const [nameFilter, setNameFilter] = useState("");
  const [facultyFilter, setFacultyFilter] = useState("");
  const [universityFilter, setUniversityFilter] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchResult, searchAction] = useActionState<FaceBankSearchResult | null, FormData>(
    searchFaceBankByUpload,
    null,
  );

  const universityOptions = useMemo(
    () =>
      [...new Set(profiles.map((p) => p.universityName).filter((n): n is string => !!n))].sort((a, b) =>
        a.localeCompare(b, "th"),
      ),
    [profiles],
  );

  const filtered = useMemo(() => {
    const n = nameFilter.trim().toLowerCase();
    const f = facultyFilter.trim().toLowerCase();
    return profiles.filter(
      (p) =>
        (!n || p.name.toLowerCase().includes(n)) &&
        (!f || (p.facultyName ?? "").toLowerCase().includes(f)) &&
        (!universityFilter || p.universityName === universityFilter),
    );
  }, [profiles, nameFilter, facultyFilter, universityFilter]);

  return (
    <div>
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            ค้นหาชื่อ
            <input
              type="text"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="เช่น สมชาย"
              className="mt-1 block w-48 min-w-0 max-w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            ค้นหาคณะที่ถ่ายรูป
            <input
              type="text"
              value={facultyFilter}
              onChange={(e) => setFacultyFilter(e.target.value)}
              placeholder="เช่น วิศวกรรมศาสตร์"
              className="mt-1 block w-48 min-w-0 max-w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            มหาวิทยาลัย
            <select
              value={universityFilter}
              onChange={(e) => setUniversityFilter(e.target.value)}
              className="mt-1 block w-48 min-w-0 max-w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="">ทั้งหมด</option>
              {universityOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          {(nameFilter || facultyFilter || universityFilter) && (
            <button
              type="button"
              onClick={() => {
                setNameFilter("");
                setFacultyFilter("");
                setUniversityFilter("");
              }}
              className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>

        <div className="mt-4 border-t border-gray-100 pt-4">
          <form action={searchAction} className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              name="image"
              accept="image/png,image/jpeg,image/webp"
              required
              className="block w-full min-w-0 max-w-full text-xs text-gray-600 sm:w-auto"
            />
            <SearchByFaceSubmitButton />
          </form>
          <p className="mt-1 text-xs text-gray-400">
            อัปโหลดรูปที่เห็นใบหน้าชัดเจน ระบบจะค้นหาคนที่หน้าตาใกล้เคียงที่สุดในคลัง
          </p>

          {searchResult && searchResult.status !== "ok" && (
            <p className="mt-2 text-xs text-amber-600">{STATUS_MESSAGE[searchResult.status]}</p>
          )}
          {searchResult && searchResult.status === "ok" && (
            <div className="mt-3">
              {searchResult.candidates.length === 0 ? (
                <p className="text-xs text-gray-400">ยังไม่มีข้อมูลในคลังใบหน้าให้เปรียบเทียบ</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {searchResult.candidates.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setNameFilter(c.name)}
                      className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5 text-left hover:border-indigo-400 hover:bg-indigo-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.sourceCropUrl} alt="" className="h-10 w-10 rounded object-cover" />
                      <span>
                        <span className="block text-sm font-medium text-gray-900">{c.name}</span>
                        <span className="block text-xs text-gray-400">{(c.score * 100).toFixed(0)}% ใกล้เคียง</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="mb-2 text-xs text-gray-400">
        {filtered.length.toLocaleString()} จาก {profiles.length.toLocaleString()} คน
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
          ไม่พบข้อมูลที่ตรงกับตัวกรอง
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((p) => (
            <div key={p.id} className="rounded-lg border border-gray-200 bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.sourceCropUrl}
                alt={p.name}
                className="aspect-square w-full rounded-md object-cover"
              />
              <div className="mt-2 text-sm font-medium text-gray-900">{p.name}</div>
              <div className="mt-0.5 truncate text-xs text-gray-500">
                {p.facultyName ?? "ไม่ทราบคณะ"}
                {p.universityName ? ` · ${p.universityName}` : ""}
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-xs text-gray-400">
                <span>เจอ {p.timesMatched} ครั้ง</span>
                <span>{new Date(p.updatedAt).toLocaleDateString("th-TH")}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
