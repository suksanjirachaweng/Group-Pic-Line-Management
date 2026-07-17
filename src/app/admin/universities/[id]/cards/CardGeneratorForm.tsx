"use client";

import { useState } from "react";

const CURRENT_BE_YEAR = String(new Date().getFullYear() + 543);

export function CardGeneratorForm({ universityId }: { universityId: string }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [includeQr, setIncludeQr] = useState(true);
  const [includeFillIn, setIncludeFillIn] = useState(true);
  const [includeBrand, setIncludeBrand] = useState(true);
  const [includeEventName, setIncludeEventName] = useState(false);
  const [eventName, setEventName] = useState("");
  const [includeYear, setIncludeYear] = useState(false);
  const [year, setYear] = useState(CURRENT_BE_YEAR);
  const [error, setError] = useState<string | null>(null);

  const count = Number(end) - Number(start) + 1;
  const rangeValid = start !== "" && end !== "" && Number(start) >= 0 && count > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rangeValid) {
      setError("กรุณากรอกช่วงเบอร์ให้ถูกต้อง (เบอร์เริ่ม ต้องไม่มากกว่าเบอร์สิ้นสุด)");
      return;
    }
    if (count > 3000) {
      setError(`ช่วงเบอร์กว้างเกินไป (${count} ใบ) — สร้างได้ครั้งละไม่เกิน 3000 ใบ`);
      return;
    }
    setError(null);

    const params = new URLSearchParams({
      start,
      end,
      qr: includeQr ? "1" : "0",
      fillIn: includeFillIn ? "1" : "0",
      brand: includeBrand ? "1" : "0",
      eventName: includeEventName ? eventName.trim() : "",
      year: includeYear ? year.trim() : "",
      origin: window.location.origin,
    });
    window.location.href = `/api/admin/universities/${universityId}/cards?${params.toString()}`;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-gray-200 bg-white p-5">
      <div>
        <label className="block text-sm font-medium text-gray-700">1. ช่วงเบอร์</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="เบอร์เริ่ม เช่น 11601"
            className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <span className="text-gray-400">ถึง</span>
          <input
            type="number"
            min={0}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            placeholder="เบอร์สิ้นสุด เช่น 11800"
            className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {rangeValid && <p className="mt-1 text-xs text-gray-400">{count} ใบ</p>}
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={includeQr} onChange={(e) => setIncludeQr(e.target.checked)} />
        2. ใส่ QR code (ของ LINE) สำหรับสแกนลงทะเบียน
      </label>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={includeFillIn}
          onChange={(e) => setIncludeFillIn(e.target.checked)}
        />
        3. ใส่ที่กรอกข้อมูล (ชื่อ-นามสกุล, คณะ, เบอร์โทร, คนด้านซ้าย)
      </label>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={includeBrand} onChange={(e) => setIncludeBrand(e.target.checked)} />
        4. ใส่ logo (โลโก้ + ชื่อร้าน + เบอร์โทรร้าน)
      </label>

      <div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={includeEventName}
            onChange={(e) => setIncludeEventName(e.target.checked)}
          />
          5. ใส่ชื่องาน
        </label>
        {includeEventName && (
          <input
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="เช่น พิธีรับปริญญา มหาวิทยาลัยขอนแก่น"
            className="mt-1.5 ml-6 w-full max-w-xs rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
        )}
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={includeYear} onChange={(e) => setIncludeYear(e.target.checked)} />
          6. ใส่ปี
        </label>
        {includeYear && (
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="เช่น 2569"
            className="mt-1.5 ml-6 w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
      >
        สร้าง PDF
      </button>
    </form>
  );
}
