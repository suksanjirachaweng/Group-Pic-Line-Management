import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function inputTypeFor(fieldType: string): string {
  switch (fieldType) {
    case "NUMBER":
      return "number";
    case "DATE":
      return "date";
    case "DATETIME":
      return "datetime-local";
    case "PHONE":
      return "tel";
    case "EMAIL":
      return "email";
    default:
      return "text";
  }
}

const fieldInputClasses =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 transition focus:bg-white focus:outline-none disabled:cursor-not-allowed";

const DEFAULT_THEME_COLOR = "#4f46e5";

/**
 * A university's theme color is only known at request time, so it can't be a Tailwind
 * class (Tailwind only generates classes it can see at build time). Instead it's passed
 * in as a CSS variable and these rules reference that variable.
 */
function ThemeStyle() {
  return (
    <style>{`
      .theme-scope input:focus,
      .theme-scope select:focus {
        border-color: var(--brand-color);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-color) 15%, transparent);
      }
      .theme-scope .brand-bg { background-color: var(--brand-color); }
      .theme-scope .brand-text { color: var(--brand-color); }
      .theme-scope .brand-border { border-color: var(--brand-color); }
    `}</style>
  );
}

const SAMPLE_NAMES = ["สมชาย ใจดี", "สมหญิง ใจงาม", "วิชัย รักเรียน"];

/** Plausible sample value for a field, so the "My registrations" preview looks like real data. */
function sampleValueFor(f: FormField, rowIndex: number): string {
  switch (f.fieldType) {
    case "NUMBER":
      return String(rowIndex + 1);
    case "PHONE":
      return `08${rowIndex}-234-567${rowIndex}`;
    case "EMAIL":
      return `student${rowIndex + 1}@example.com`;
    case "DATE":
      return `2569-07-0${rowIndex + 1}`;
    case "DATETIME":
      return `2569-07-0${rowIndex + 1} 10:00`;
    case "SELECT": {
      const options = f.options as string[] | null;
      return options && options.length > 0 ? options[rowIndex % options.length] : "ตัวเลือกที่ 1";
    }
    default:
      return SAMPLE_NAMES[rowIndex % SAMPLE_NAMES.length];
  }
}

type FormField = { id: string; label: string; description: string | null; imageUrl: string | null; fieldType: string; options: unknown; isRequired: boolean };
type University = { name: string; headerImageUrl: string | null; themeColor: string | null; formFields: FormField[] };

export default async function UniversityPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id: universityId } = await params;
  const { view } = await searchParams;

  const session = await getServerSession(authOptions);
  if (!canAccessUniversity(session!.user, universityId)) notFound();

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    include: { formFields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!university) notFound();

  const isListPreview = view === "list";
  const brandStyle = { "--brand-color": university.themeColor || DEFAULT_THEME_COLOR } as React.CSSProperties;

  return (
    <div className="theme-scope min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white" style={brandStyle}>
      <ThemeStyle />
      <div className="mx-auto max-w-md px-4 pb-12 pt-6">
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          <span aria-hidden>🔍</span>
          <p>
            <span className="font-semibold">Preview only</span> —{" "}
            {isListPreview
              ? "this is the screen returning graduates see if they've already registered before. Data shown is sample data."
              : "this is what graduates see inside LINE. Submitting here doesn't save any data (the real flow needs a LINE profile)."}
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm shadow-indigo-100/50">
          {university.headerImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={university.headerImageUrl} alt="" className="h-40 w-full object-cover" />
          )}

          <div className="p-6">
            {isListPreview ? (
              <ListPreview university={university} />
            ) : (
              <FormPreview university={university} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FormPreview({ university }: { university: University }) {
  return (
    <>
      <div className="mb-6 flex items-center gap-2.5">
        <span className="brand-bg h-8 w-1.5 shrink-0 rounded-full" />
        <h1 className="text-xl font-bold leading-tight text-gray-900">Registration</h1>
      </div>

      <form className="space-y-5">
        {university.formFields.map((f) => (
          <div key={f.id}>
            <label className="mb-1.5 flex items-baseline gap-1 text-sm font-semibold text-gray-800">
              {f.label}
              {f.isRequired && <span className="text-rose-500">*</span>}
            </label>
            {f.description && (
              <p className="mb-2 whitespace-pre-line text-xs leading-relaxed text-gray-500">{f.description}</p>
            )}
            {f.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={f.imageUrl}
                alt=""
                className="mb-2 h-32 w-auto rounded-xl border border-gray-200 object-cover shadow-sm"
              />
            )}
            {f.fieldType === "SELECT" ? (
              <select disabled className={fieldInputClasses}>
                <option>Select...</option>
                {(f.options as string[] | null)?.map((opt) => (
                  <option key={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input type={inputTypeFor(f.fieldType)} disabled className={fieldInputClasses} />
            )}
          </div>
        ))}
        {university.formFields.length === 0 && <p className="text-sm text-gray-400">No fields configured yet.</p>}
        <button
          type="submit"
          disabled
          className="brand-bg w-full rounded-xl py-3 text-sm font-semibold text-white opacity-50 shadow-md"
        >
          Submit
        </button>
      </form>
    </>
  );
}

function ListPreview({ university }: { university: University }) {
  const sampleRows = [
    { label: "รายการที่ 1", date: "1 ก.ค. 2569 · 10:15 น." },
    { label: "รายการที่ 2", date: "3 ก.ค. 2569 · 14:42 น." },
  ];

  return (
    <>
      <div className="mb-6 flex items-center gap-2.5">
        <span className="brand-bg h-8 w-1.5 shrink-0 rounded-full" />
        <h1 className="text-xl font-bold leading-tight text-gray-900">รายการที่ลงทะเบียนไว้</h1>
      </div>

      <ul className="space-y-3">
        {sampleRows.map((row, i) => (
          <li key={row.label} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-gray-400">
                {row.label} · {row.date}
              </p>
              <button
                disabled
                className="brand-border brand-text shrink-0 rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold opacity-60"
              >
                แก้ไข
              </button>
            </div>
            {university.formFields.length > 0 ? (
              <dl className="space-y-1.5">
                {university.formFields.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3">
                    <dt className="min-w-0 flex-1 truncate text-xs text-gray-500">{f.label}</dt>
                    <dd className="shrink-0 text-base font-bold text-gray-900">{sampleValueFor(f, i)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-gray-400">(ไม่มีข้อมูลสรุป)</p>
            )}
          </li>
        ))}
      </ul>

      <button
        disabled
        className="brand-bg mt-5 w-full rounded-xl py-3 text-sm font-semibold text-white opacity-50 shadow-md"
      >
        + ลงทะเบียนเพิ่ม
      </button>
    </>
  );
}
