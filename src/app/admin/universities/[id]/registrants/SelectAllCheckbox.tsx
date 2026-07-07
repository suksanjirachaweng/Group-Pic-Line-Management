"use client";

export function SelectAllCheckbox({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      onChange={(e) => {
        const form = document.getElementById(formId);
        form?.querySelectorAll<HTMLInputElement>('input[name="registrantIds"]').forEach((cb) => {
          cb.checked = e.target.checked;
        });
      }}
    />
  );
}
