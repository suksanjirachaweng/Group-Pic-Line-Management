"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  searchFaceBankByUpload,
  type FaceBankSearchResult,
  type FacultyFaceProfileListItem,
} from "@/lib/actions/facultyFaceBank";
import { EditFacultyFaceProfileDialog } from "./EditFacultyFaceProfileDialog";

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

// Longest-first so "รศ.ดร." matches before the shorter "รศ."/"ดร." would. Covers the common Thai
// academic/personal honorifics seen in real faculty names plus a few English ones (some faces in
// the bank belong to international/English-named faculty) — a pragmatic list, not exhaustive.
const HONORIFIC_PREFIXES = [
  "ศาสตราจารย์เกียรติคุณ",
  "ศาสตราจารย์กิตติคุณ",
  "ศาสตราจารย์ดร.",
  "ศาสตราจารย์ ดร.",
  "รองศาสตราจารย์ดร.",
  "รองศาสตราจารย์ ดร.",
  "ผู้ช่วยศาสตราจารย์ดร.",
  "ผู้ช่วยศาสตราจารย์ ดร.",
  "รศ.ดร.",
  "ผศ.ดร.",
  "ศ.ดร.",
  "ศาสตราจารย์",
  "รองศาสตราจารย์",
  "ผู้ช่วยศาสตราจารย์",
  "นายแพทย์",
  "แพทย์หญิง",
  "อาจารย์",
  "นางสาว",
  "ศ.",
  "รศ.",
  "ผศ.",
  "นพ.",
  "พญ.",
  "ดร.",
  "อ.",
  "น.ส.",
  "นาง",
  "นาย",
  "Assoc. Prof.",
  "Asst. Prof.",
  "Prof.",
  "Dr.",
  "Mrs.",
  "Ms.",
  "Mr.",
].sort((a, b) => b.length - a.length);

function stripHonorificPrefix(name: string): string {
  const trimmed = name.trim();
  for (const prefix of HONORIFIC_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).trim();
      if (rest) return rest;
    }
  }
  return trimmed;
}

type SortBy = "name" | "university" | "faculty";
type ViewMode = "xlarge" | "icons" | "list" | "details" | "content";

const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  xlarge: "ไอคอนใหญ่พิเศษ",
  icons: "ไอคอน",
  list: "รายการ",
  details: "รายละเอียด",
  content: "เนื้อหา",
};

export function FacultyFaceBankBrowser({ profiles }: { profiles: FacultyFaceProfileListItem[] }) {
  const [nameFilter, setNameFilter] = useState("");
  const [facultyFilter, setFacultyFilter] = useState("");
  const [universityFilter, setUniversityFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [viewMode, setViewMode] = useState<ViewMode>("content");
  const [editingProfile, setEditingProfile] = useState<FacultyFaceProfileListItem | null>(null);
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

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "university") {
      arr.sort(
        (a, b) =>
          (a.universityName ?? "").localeCompare(b.universityName ?? "", "th") ||
          stripHonorificPrefix(a.name).localeCompare(stripHonorificPrefix(b.name), "th"),
      );
    } else if (sortBy === "faculty") {
      arr.sort(
        (a, b) =>
          (a.facultyName ?? "").localeCompare(b.facultyName ?? "", "th") ||
          stripHonorificPrefix(a.name).localeCompare(stripHonorificPrefix(b.name), "th"),
      );
    } else {
      arr.sort((a, b) => stripHonorificPrefix(a.name).localeCompare(stripHonorificPrefix(b.name), "th"));
    }
    return arr;
  }, [filtered, sortBy]);

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

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-400">
          {sorted.length.toLocaleString()} จาก {profiles.length.toLocaleString()} คน
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <label className="flex items-center gap-1">
            เรียงตาม:
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs"
            >
              <option value="name">ชื่อ (ไม่รวมคำนำหน้า)</option>
              <option value="university">มหาวิทยาลัย</option>
              <option value="faculty">คณะที่ถ่ายรูป</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            มุมมอง:
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs"
            >
              {(Object.keys(VIEW_MODE_LABEL) as ViewMode[]).map((v) => (
                <option key={v} value={v}>
                  {VIEW_MODE_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
          ไม่พบข้อมูลที่ตรงกับตัวกรอง
        </p>
      ) : viewMode === "list" ? (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {sorted.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setEditingProfile(p)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-sky-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.sourceCropUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
              <span className="truncate text-gray-900">{p.name}</span>
            </button>
          ))}
        </div>
      ) : viewMode === "details" ? (
        <div className="space-y-2">
          {sorted.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-white p-3 text-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.sourceCropUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
              <span className="min-w-[10rem] font-medium text-gray-900">{p.name}</span>
              <span className="min-w-[8rem] text-gray-500">{p.facultyName ?? "ไม่ทราบคณะ"}</span>
              <span className="min-w-[8rem] text-gray-500">{p.universityName ?? "—"}</span>
              <span className="text-gray-400">เจอ {p.timesMatched} ครั้ง</span>
              <span className="text-gray-400">{new Date(p.updatedAt).toLocaleDateString("th-TH")}</span>
              <button
                type="button"
                onClick={() => setEditingProfile(p)}
                className="ml-auto shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                แก้ไข
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div
          className={
            viewMode === "xlarge"
              ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
              : viewMode === "icons"
                ? "grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8"
                : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
          }
        >
          {sorted.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setEditingProfile(p)}
              className="rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-indigo-300 hover:shadow-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.sourceCropUrl} alt={p.name} className="aspect-square w-full rounded-md object-cover" />
              <div className={`mt-2 truncate font-medium text-gray-900 ${viewMode === "icons" ? "text-xs" : "text-sm"}`}>
                {p.name}
              </div>
              {viewMode === "content" && (
                <>
                  <div className="mt-0.5 truncate text-xs text-gray-500">
                    {p.facultyName ?? "ไม่ทราบคณะ"}
                    {p.universityName ? ` · ${p.universityName}` : ""}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-xs text-gray-400">
                    <span>เจอ {p.timesMatched} ครั้ง</span>
                    <span>{new Date(p.updatedAt).toLocaleDateString("th-TH")}</span>
                  </div>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {editingProfile && (
        <EditFacultyFaceProfileDialog profile={editingProfile} onClose={() => setEditingProfile(null)} />
      )}
    </div>
  );
}
