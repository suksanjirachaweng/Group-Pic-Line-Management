/**
 * Icon+label export links shared by the admin tagging page and the public validate page — each
 * export format gets a small colored badge (green/grid = Excel, slate/lines = plain text,
 * blue/document = Word) so the row reads at a glance instead of as three identical text buttons.
 */
function ExportIconBadge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${className}`}>{children}</span>
  );
}

function GridGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="white" strokeWidth="1.4">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M2 6.5h12M2 10.5h12M6.5 2v12M10.5 2v12" />
    </svg>
  );
}

function LinesGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round">
      <path d="M3 3h10M3 6.5h10M3 10h7M3 13h5" />
    </svg>
  );
}

function DocGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="white"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9 2v3h3" />
      <path d="M5 9h6M5 11.5h6" />
    </svg>
  );
}

const linkClass =
  "flex items-center gap-1.5 rounded-md border border-gray-300 py-1 pl-1 pr-3 text-xs font-medium text-gray-700 hover:bg-gray-50";

export function ExcelExportButton({ photoId }: { photoId: string }) {
  return (
    <a href={`/api/group-photos/${photoId}/export/excel`} className={linkClass}>
      <ExportIconBadge className="bg-green-600">
        <GridGlyph />
      </ExportIconBadge>
      Excel
    </a>
  );
}

export function TextExportButton({ photoId }: { photoId: string }) {
  return (
    <a href={`/api/group-photos/${photoId}/export/text`} className={linkClass}>
      <ExportIconBadge className="bg-slate-500">
        <LinesGlyph />
      </ExportIconBadge>
      ข้อความ
    </a>
  );
}

export function WordExportButton({ photoId }: { photoId: string }) {
  return (
    <a href={`/api/group-photos/${photoId}/export/word`} className={linkClass}>
      <ExportIconBadge className="bg-blue-600">
        <DocGlyph />
      </ExportIconBadge>
      Word
    </a>
  );
}
