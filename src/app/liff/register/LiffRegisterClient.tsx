"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { reportNotTagged } from "@/lib/actions/publicRegistrant";

type FieldDef = {
  key: string;
  label: string;
  description: string | null;
  imageUrl: string | null;
  fieldType: "TEXT" | "NUMBER" | "SELECT" | "DATE" | "DATETIME" | "PHONE" | "EMAIL";
  options: string[] | null;
  isRequired: boolean;
};

type TaggedPhoto = { groupPhotoId: string; tagId: string; photoName: string };

// A registrant's code can be tagged in more than one group photo (e.g. photographed with more
// than one faculty), so this is a list, not a single optional link.
type RegistrationSummary = {
  id: string;
  registeredAt: string;
  data: Record<string, string>;
  taggedPhotos: TaggedPhoto[];
};

type FormContext = {
  fields: FieldDef[];
  universityName: string;
  headerImageUrl: string | null;
  themeColor: string | null;
  registrations: RegistrationSummary[];
};

type Status =
  | { step: "loading" }
  | { step: "error"; message: string }
  | ({ step: "list" } & FormContext)
  | ({ step: "form" | "submitting"; editingId: string | null } & FormContext)
  | {
      step: "done";
      wasEdit: boolean;
      fields: FieldDef[];
      themeColor: string | null;
      registrations: RegistrationSummary[];
      savedId: string;
    };

type LiffProfile = { userId: string; displayName?: string };

const DEFAULT_THEME_COLOR = "#4f46e5";

const fieldInputClasses =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 transition focus:bg-white focus:outline-none";

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
      .theme-scope .brand-edit-btn:hover { background-color: color-mix(in srgb, var(--brand-color) 8%, white); }
    `}</style>
  );
}

export default function LiffRegisterClient() {
  const rawSearchParams = useSearchParams();
  // LIFF wraps any query string appended after the liffId (as in our own
  // /register/[slug] redirect) into a single "liff.state" param instead of
  // passing university/liffId through directly — unwrap it here.
  const liffState = rawSearchParams.get("liff.state");
  const searchParams = liffState
    ? new URLSearchParams(liffState.startsWith("?") ? liffState.slice(1) : liffState)
    : rawSearchParams;
  const universitySlug = searchParams.get("university");
  const liffId = searchParams.get("liffId");

  const [status, setStatus] = useState<Status>(() =>
    !universitySlug || !liffId
      ? { step: "error", message: "ลิงก์ลงทะเบียนไม่ถูกต้อง / Missing registration link parameters." }
      : { step: "loading" },
  );
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const [isFriend, setIsFriend] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!universitySlug || !liffId) {
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId: liffId! });

        if (!liff.isLoggedIn()) {
          liff.login();
          return; // liff.login() navigates away; effect resumes after redirect back
        }

        const liffProfile = await liff.getProfile();
        if (cancelled) return;
        setProfile({ userId: liffProfile.userId, displayName: liffProfile.displayName });

        let friend = false;
        try {
          const friendship = await liff.getFriendship();
          friend = friendship.friendFlag;
          if (!friend) {
            await liff.requestFriendship();
            const rechecked = await liff.getFriendship();
            friend = rechecked.friendFlag;
          }
        } catch {
          // requestFriendship isn't available on every plan/LIFF version — proceed without blocking registration.
        }
        if (cancelled) return;
        setIsFriend(friend);

        const [fieldsRes, registrationsRes] = await Promise.all([
          fetch(`/api/universities/${universitySlug}/fields`),
          fetch(
            `/api/universities/${universitySlug}/registrations?lineUserId=${encodeURIComponent(liffProfile.userId)}`,
          ),
        ]);
        if (!fieldsRes.ok)
          throw new Error("ไม่สามารถโหลดแบบฟอร์มลงทะเบียนของมหาวิทยาลัยนี้ได้ / Could not load the registration form for this university.");
        const fieldsBody = await fieldsRes.json();
        const registrations: RegistrationSummary[] = registrationsRes.ok
          ? (await registrationsRes.json()).registrations
          : [];
        if (cancelled) return;

        const context: FormContext = {
          fields: fieldsBody.fields,
          universityName: fieldsBody.university.name,
          headerImageUrl: fieldsBody.university.headerImageUrl,
          themeColor: fieldsBody.university.themeColor,
          registrations,
        };

        if (registrations.length > 0) {
          setStatus({ step: "list", ...context });
        } else {
          setFormValues({});
          setStatus({ step: "form", ...context, editingId: null });
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ step: "error", message });
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [universitySlug, liffId]);

  function startNewRegistration() {
    if (status.step !== "list" && status.step !== "form" && status.step !== "submitting") return;
    const latest = status.registrations[status.registrations.length - 1];
    // Carry forward contact info from the person's most recent registration so they don't
    // have to retype it for every additional group photo — group_photo_index etc. still blank.
    setFormValues(
      latest ? { full_name: latest.data.full_name ?? "", phone_number: latest.data.phone_number ?? "" } : {},
    );
    setStatus({ ...pickFormContext(status), step: "form", editingId: null });
  }

  function startEditingRegistration(reg: RegistrationSummary) {
    if (status.step !== "list" && status.step !== "form" && status.step !== "submitting") return;
    setFormValues(reg.data);
    setStatus({ ...pickFormContext(status), step: "form", editingId: reg.id });
  }

  function backToList() {
    if (status.step !== "form" && status.step !== "submitting") return;
    setStatus({ ...pickFormContext(status), step: "list" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status.step !== "form" || !profile) return;

    const editingId = status.editingId;
    setStatus({ ...pickFormContext(status), step: "submitting", editingId });

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universitySlug,
          liffId,
          lineUserId: profile.userId,
          displayName: profile.displayName,
          isFriend,
          data: formValues,
          registrantId: editingId ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ลงทะเบียนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง / Registration failed. Please try again.");
      }
      const body: { registrantId: string } = await res.json();

      // Refetch (rather than hand-building the saved entry) so `taggedPhotos` is accurate — a
      // freshly-submitted registration usually has none yet, but an edited one might already.
      let registrations = status.registrations;
      if (profile) {
        const registrationsRes = await fetch(
          `/api/universities/${universitySlug}/registrations?lineUserId=${encodeURIComponent(profile.userId)}`,
        );
        if (registrationsRes.ok) {
          registrations = (await registrationsRes.json()).registrations;
        }
      }
      setStatus({
        step: "done",
        wasEdit: !!editingId,
        fields: status.fields,
        themeColor: status.themeColor,
        registrations,
        savedId: body.registrantId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ step: "error", message });
    }
  }

  if (status.step === "loading") {
    return (
      <CenteredMessage>
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
        <p className="text-sm text-gray-500">กำลังโหลด... / Loading...</p>
      </CenteredMessage>
    );
  }

  if (status.step === "error") {
    return (
      <CenteredMessage>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <svg className="h-7 w-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <p className="font-semibold text-gray-900">เกิดข้อผิดพลาด / Something went wrong</p>
        <p className="mt-1 text-sm text-gray-500">{status.message}</p>
      </CenteredMessage>
    );
  }

  if (status.step === "done") {
    const brandStyle = { "--brand-color": status.themeColor || DEFAULT_THEME_COLOR } as React.CSSProperties;
    return (
      <CenteredMessage themeScope style={brandStyle}>
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-gray-900">
          {status.wasEdit ? "แก้ไขข้อมูลเรียบร้อยแล้ว / Updated successfully" : "ลงทะเบียนสำเร็จ / Registration successful"}
        </h1>
        <p className="mt-1 mb-6 text-sm text-gray-500">
          {status.wasEdit
            ? "ข้อมูลของคุณถูกอัปเดตเรียบร้อยแล้ว / Your information has been updated."
            : "ขอบคุณที่ลงทะเบียน ข้อมูลของคุณถูกบันทึกเรียบร้อยแล้ว / Thank you for registering. Your information has been saved."}
        </p>
        {status.fields.length > 0 && (
          <ul className="mb-6 space-y-2.5 text-left">
            {status.registrations.map((reg, i) => {
              const isNew = reg.id === status.savedId;
              return (
                <li
                  key={reg.id}
                  className={
                    isNew
                      ? "brand-border rounded-xl border-2 bg-white px-4 py-3 shadow-md"
                      : "rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 opacity-60"
                  }
                >
                  {isNew ? (
                    <p className="brand-text mb-1.5 text-xs font-bold uppercase tracking-wide">
                      บันทึกล่าสุด / Just saved
                    </p>
                  ) : (
                    <p className="mb-1.5 text-xs font-medium text-gray-400">
                      รายการที่ {i + 1} / Entry {i + 1} ·{" "}
                      {new Date(reg.registeredAt).toLocaleString("th-TH", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                  <dl className="space-y-1.5">
                    {status.fields.map((f) => (
                      <div key={f.key} className="flex items-center justify-between gap-3">
                        <dt className="min-w-0 flex-1 truncate text-xs text-gray-500">{f.label}</dt>
                        <dd className="shrink-0 text-base font-bold text-gray-900">{reg.data[f.key] || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  <TaggedPhotoLinks photos={reg.taggedPhotos} registrantId={reg.id} lineUserId={profile?.userId ?? ""} />
                </li>
              );
            })}
          </ul>
        )}
        <button
          className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:shadow-lg active:scale-[0.99]"
          onClick={async () => {
            const liff = (await import("@line/liff")).default;
            if (liff.isInClient()) liff.closeWindow();
          }}
        >
          ปิดหน้าต่าง / Close window
        </button>
        <p className="mt-3 text-xs text-gray-400">
          หากหน้าจอไม่ปิดอัตโนมัติ กรุณากดปุ่ม X ที่มุมขวาบน / If the screen doesn&apos;t close automatically,
          tap the X in the top-right corner.
        </p>
      </CenteredMessage>
    );
  }

  const { fields, headerImageUrl, themeColor } = status;
  const brandStyle = { "--brand-color": themeColor || DEFAULT_THEME_COLOR } as React.CSSProperties;

  if (status.step === "list") {
    return (
      <div className="theme-scope min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white" style={brandStyle}>
        <ThemeStyle />
        <div className="mx-auto max-w-md px-4 pb-12 pt-6">
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm shadow-indigo-100/50">
            {headerImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={headerImageUrl} alt="" className="h-40 w-full object-cover" />
            )}
            <div className="p-6">
              <div className="mb-6 flex items-center gap-2.5">
                <span className="brand-bg h-8 w-1.5 shrink-0 rounded-full" />
                <h1 className="text-base font-bold leading-tight text-gray-900">
                  รายการที่ลงทะเบียนไว้ / Your registrations
                </h1>
              </div>

              <ul className="space-y-3">
                {status.registrations.map((reg, i) => (
                  <li key={reg.id} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-gray-400">
                        รายการที่ {i + 1} / Entry {i + 1} ·{" "}
                        {new Date(reg.registeredAt).toLocaleString("th-TH", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <button
                        onClick={() => startEditingRegistration(reg)}
                        className="brand-border brand-text brand-edit-btn shrink-0 rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold transition"
                      >
                        แก้ไข / Edit
                      </button>
                    </div>
                    {fields.length > 0 ? (
                      <dl className="space-y-1.5">
                        {fields.map((f) => (
                          <div key={f.key} className="flex items-center justify-between gap-3">
                            <dt className="min-w-0 flex-1 truncate text-xs text-gray-500">{f.label}</dt>
                            <dd className="shrink-0 text-base font-bold text-gray-900">
                              {reg.data[f.key] || "—"}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-sm text-gray-400">(ไม่มีข้อมูลสรุป / No summary available)</p>
                    )}
                    <TaggedPhotoLinks photos={reg.taggedPhotos} registrantId={reg.id} lineUserId={profile?.userId ?? ""} />
                  </li>
                ))}
              </ul>

              <button
                onClick={startNewRegistration}
                className="brand-bg mt-5 w-full rounded-xl py-3 text-sm font-semibold text-white shadow-md transition hover:brightness-90 active:scale-[0.99] active:brightness-95"
              >
                + ลงทะเบียนเพิ่ม / Register another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="theme-scope min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white" style={brandStyle}>
      <ThemeStyle />
      <div className="mx-auto max-w-md px-4 pb-12 pt-6">
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm shadow-indigo-100/50">
          {headerImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headerImageUrl} alt="" className="h-40 w-full object-cover" />
          )}

          <div className="p-6">
            {status.registrations.length > 0 && (
              <button
                type="button"
                onClick={backToList}
                className="brand-text mb-4 flex items-center gap-1 text-xs font-medium hover:underline"
              >
                ← กลับไปยังรายการที่ลงทะเบียนไว้ / Back to your registrations
              </button>
            )}

            <div className="mb-6 flex items-center gap-2.5">
              <span className="brand-bg h-8 w-1.5 shrink-0 rounded-full" />
              <h1 className="text-xl font-bold leading-tight text-gray-900">
                {status.editingId ? "แก้ไขข้อมูล / Edit registration" : "ลงทะเบียน / Registration"}
              </h1>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {fields.map((f) => (
                <div key={f.key}>
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
                    <select
                      required={f.isRequired}
                      value={formValues[f.key] ?? ""}
                      onChange={(e) => setFormValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      className={fieldInputClasses}
                    >
                      <option value="" disabled>
                        เลือก... / Select...
                      </option>
                      {(f.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={inputTypeFor(f.fieldType)}
                      required={f.isRequired}
                      value={formValues[f.key] ?? ""}
                      onChange={(e) => setFormValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      className={fieldInputClasses}
                    />
                  )}
                </div>
              ))}
              <button
                type="submit"
                disabled={status.step === "submitting"}
                className="brand-bg w-full rounded-xl py-3 text-sm font-semibold text-white shadow-md transition hover:brightness-90 active:scale-[0.99] active:brightness-95 disabled:opacity-50"
              >
                {status.step === "submitting"
                  ? "กำลังบันทึก... / Saving..."
                  : status.editingId
                    ? "บันทึกการแก้ไข / Save changes"
                    : "ลงทะเบียน / Submit"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaggedPhotoLinks({
  photos,
  registrantId,
  lineUserId,
}: {
  photos: TaggedPhoto[];
  registrantId: string;
  lineUserId: string;
}) {
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);

  if (photos.length > 0) {
    return (
      <div className="mt-2.5 flex flex-wrap gap-2">
        {photos.map((p) => (
          <a
            key={p.tagId}
            href={`/photo-view/${p.groupPhotoId}?tag=${p.tagId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="brand-border brand-text inline-flex items-center gap-1 rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold"
          >
            ดูรูปหมู่: {p.photoName} →
          </a>
        ))}
      </div>
    );
  }

  // Not matched to any group-photo tag yet — most of the time this just means tagging hasn't
  // happened for this faculty yet, but it's also how "the OCR never picked up my code at all"
  // surfaces, so offer a way to flag it rather than leaving the graduate with no next step.
  return (
    <div className="mt-2.5">
      <button
        type="button"
        disabled={reported || reporting}
        onClick={async () => {
          setReporting(true);
          try {
            await reportNotTagged(registrantId, lineUserId);
            setReported(true);
          } catch {
            window.alert("แจ้งปัญหาไม่สำเร็จ ลองใหม่อีกครั้ง");
          } finally {
            setReporting(false);
          }
        }}
        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
      >
        {reported ? "แจ้งแล้ว จะรีบตรวจสอบให้ ✓" : reporting ? "กำลังแจ้ง..." : "ยังไม่พบรูปของฉัน — แจ้งปัญหา"}
      </button>
    </div>
  );
}

function pickFormContext(status: Extract<Status, { step: "list" | "form" | "submitting" }>): FormContext {
  const { fields, universityName, headerImageUrl, themeColor, registrations } = status;
  return { fields, universityName, headerImageUrl, themeColor, registrations };
}

function inputTypeFor(fieldType: FieldDef["fieldType"]): string {
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

function CenteredMessage({
  children,
  themeScope,
  style,
}: {
  children: React.ReactNode;
  themeScope?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-6 ${themeScope ? "theme-scope" : ""}`}
      style={style}
    >
      {themeScope && <ThemeStyle />}
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm shadow-indigo-100/50">
        {children}
      </div>
    </div>
  );
}
