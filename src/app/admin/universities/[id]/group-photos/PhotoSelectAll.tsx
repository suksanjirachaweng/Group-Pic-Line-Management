"use client";

export function PhotoSelectAll({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="เลือกทั้งหมด"
      onChange={(e) => {
        const form = document.getElementById(formId);
        form?.querySelectorAll<HTMLInputElement>('input[name="photoIds"]').forEach((cb) => {
          cb.checked = e.target.checked;
        });
      }}
    />
  );
}
