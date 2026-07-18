import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminRole, FormFieldType } from "@/generated/prisma/enums";
import {
  updateUniversity,
  setUniversityActive,
  createFormField,
  updateFormField,
  deleteFormField,
  setChannelPoolMembership,
} from "@/lib/actions/universities";
import { setSheetExportConfig, triggerSheetSync } from "@/lib/actions/sheets";
import {
  uploadUniversityHeaderImage,
  selectUniversityHeaderImage,
  removeUniversityHeaderImage,
  uploadFormFieldImage,
  selectFormFieldImage,
  removeFormFieldImage,
} from "@/lib/actions/images";
import { ImageUploadForm } from "./ImageUploadForm";
import { ImageLibraryPicker } from "./ImageLibraryPicker";
import { UniversityForm } from "./UniversityForm";

export default async function UniversityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const user = session!.user;

  if (!canAccessUniversity(user, id)) {
    notFound();
  }
  const isSuperadmin = user.role === AdminRole.SUPERADMIN;

  const university = await prisma.university.findUnique({
    where: { id },
    include: {
      formFields: { orderBy: { sortOrder: "asc" } },
      channelPool: { include: { channel: true } },
      sheetExportConfig: true,
    },
  });
  if (!university) notFound();

  const allChannels = isSuperadmin
    ? await prisma.channel.findMany({ orderBy: { name: "asc" } })
    : [];

  const poolChannelIds = new Set(
    university.channelPool.filter((p) => p.isActive).map((p) => p.channelId),
  );

  const updateUniversityWithId = updateUniversity.bind(null, university.id);
  const createFieldWithId = createFormField.bind(null, university.id);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">{university.name}</h1>
          <div className="flex gap-2">
            <Link
              href={`/admin/universities/${university.id}/preview`}
              target="_blank"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700"
            >
              Preview: Form
            </Link>
            <Link
              href={`/admin/universities/${university.id}/preview?view=list`}
              target="_blank"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700"
            >
              Preview: My registrations
            </Link>
          </div>
        </div>

        <UniversityForm action={updateUniversityWithId}>
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              name="name"
              defaultValue={university.name}
              required
              disabled={!isSuperadmin}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Slug</label>
            <input
              name="slug"
              defaultValue={university.slug}
              required
              disabled={!isSuperadmin}
              pattern="[a-z0-9-]+"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Theme color</label>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="color"
                name="themeColor"
                defaultValue={university.themeColor ?? "#4f46e5"}
                disabled={!isSuperadmin}
                className="h-10 w-14 cursor-pointer rounded-md border border-gray-300 disabled:cursor-not-allowed"
              />
              <span className="text-xs text-gray-400">
                Used for buttons and accents on this university&apos;s registration form.
              </span>
            </div>
          </div>
          {isSuperadmin && (
            <button type="submit" className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-sm font-medium text-white">
              Save
            </button>
          )}
        </UniversityForm>

        {isSuperadmin && (
          <form action={setUniversityActive.bind(null, university.id, !university.isActive)} className="mt-2">
            <button
              type="submit"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
            >
              {university.isActive ? "Deactivate" : "Activate"}
            </button>
          </form>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Header image</h2>
        <p className="mb-3 text-sm text-gray-500">
          Banner image shown at the top of the registration form, above the university name.
        </p>
        <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
          {university.headerImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={university.headerImageUrl}
              alt="Header"
              className="max-h-40 w-full rounded-md object-cover"
            />
          )}
          <div className="flex items-center gap-3">
            <ImageUploadForm
              action={uploadUniversityHeaderImage.bind(null, university.id)}
              fieldName="headerImage"
              hasImage={!!university.headerImageUrl}
            />
            <ImageLibraryPicker universityId={university.id} onSelect={selectUniversityHeaderImage.bind(null, university.id)} />
            {university.headerImageUrl && (
              <form action={removeUniversityHeaderImage.bind(null, university.id)}>
                <button type="submit" className="text-sm text-red-600 hover:underline">
                  Remove
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Registration form fields</h2>

        <div className="hidden gap-3 px-4 text-xs font-medium uppercase text-gray-500 sm:grid sm:grid-cols-6">
          <span>Key</span>
          <span>Label</span>
          <span>Type</span>
          <span>Options</span>
          <span>Order</span>
          <span>Required</span>
        </div>

        <div className="mt-1 divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
          {university.formFields.map((f) => (
            <div key={f.id} className="flex flex-col gap-2 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <UniversityForm
                action={updateFormField.bind(null, university.id, f.id)}
                className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-6 sm:items-center"
              >
                <input
                  name="key"
                  defaultValue={f.key}
                  required
                  className="col-span-2 rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs sm:col-span-1"
                />
                <input
                  name="label"
                  defaultValue={f.label}
                  required
                  className="col-span-2 rounded-md border border-gray-300 px-2 py-1.5 text-sm sm:col-span-1"
                />
                <select
                  name="fieldType"
                  defaultValue={f.fieldType}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {Object.values(FormFieldType).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  name="options"
                  defaultValue={(f.options as string[] | null)?.join(", ") ?? ""}
                  placeholder="SELECT only"
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
                <input
                  name="sortOrder"
                  type="number"
                  defaultValue={f.sortOrder}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-sm text-gray-600">
                    <input type="checkbox" name="isRequired" defaultChecked={f.isRequired} />
                    Required
                  </label>
                  <button
                    type="submit"
                    className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                  >
                    Save
                  </button>
                </div>
                <textarea
                  name="description"
                  defaultValue={f.description ?? ""}
                  placeholder="Description shown under the label on the registration form (optional)"
                  rows={2}
                  className="col-span-2 rounded-md border border-gray-300 px-2 py-1.5 text-xs sm:col-span-6"
                />
              </UniversityForm>
              <form action={deleteFormField.bind(null, university.id, f.id)}>
                <button type="submit" className="text-sm text-red-600 hover:underline">
                  Delete
                </button>
              </form>
            </div>
              <div className="flex items-center gap-3">
                {f.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.imageUrl} alt="" className="h-16 w-auto rounded-md border border-gray-200 object-cover" />
                )}
                <ImageUploadForm
                  action={uploadFormFieldImage.bind(null, university.id, f.id)}
                  fieldName="fieldImage"
                  hasImage={!!f.imageUrl}
                  size="compact"
                />
                <ImageLibraryPicker
                  universityId={university.id}
                  onSelect={selectFormFieldImage.bind(null, university.id, f.id)}
                  size="compact"
                />
                {f.imageUrl && (
                  <form action={removeFormFieldImage.bind(null, university.id, f.id)}>
                    <button type="submit" className="text-xs text-red-600 hover:underline">
                      Remove image
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
          {university.formFields.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-400">No fields yet.</p>
          )}
        </div>

        <form
          action={createFieldWithId}
          className="mt-3 grid grid-cols-2 gap-3 rounded-md border border-gray-200 bg-white p-4 sm:grid-cols-6"
        >
          <input name="key" placeholder="key (e.g. full_name)" required className="col-span-2 rounded-md border border-gray-300 px-2 py-1.5 text-sm sm:col-span-1" />
          <input name="label" placeholder="Label" required className="col-span-2 rounded-md border border-gray-300 px-2 py-1.5 text-sm sm:col-span-1" />
          <select name="fieldType" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            {Object.values(FormFieldType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            name="options"
            placeholder="Options (SELECT only), comma-separated"
            className="col-span-2 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            name="sortOrder"
            type="number"
            defaultValue={university.formFields.length}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            <input type="checkbox" name="isRequired" defaultChecked />
            Required
          </label>
          <button
            type="submit"
            className="col-span-2 rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white sm:col-span-1"
          >
            Add field
          </button>
          <textarea
            name="description"
            placeholder="Description shown under the label on the registration form (optional)"
            rows={2}
            className="col-span-2 rounded-md border border-gray-300 px-2 py-1.5 text-xs sm:col-span-6"
          />
        </form>
      </div>

      {isSuperadmin && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#06C755]" />
            LINE Channel pool
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            LINE Channels this university can route new registrants to. New registrants are routed
            to whichever active LINE Channel in this pool currently has the most free-tier headroom.
          </p>
          <ul className="divide-y divide-gray-200 rounded-md border-t-4 border-[#06C755] border-x border-b border-gray-200 bg-white">
            {allChannels.map((c) => {
              const enabled = poolChannelIds.has(c.id);
              return (
                <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>
                    {c.name} <span className="text-gray-400">({c.lineChannelId})</span>
                    {!c.isActive && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                        inactive
                      </span>
                    )}
                  </span>
                  <form action={setChannelPoolMembership.bind(null, university.id, c.id, !enabled)}>
                    <button
                      type="submit"
                      className={
                        enabled
                          ? "rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700"
                          : "rounded-md bg-[#06C755] px-3 py-1 text-xs font-medium text-white hover:bg-[#05a648]"
                      }
                    >
                      {enabled ? "Remove from pool" : "Add to pool"}
                    </button>
                  </form>
                </li>
              );
            })}
            {allChannels.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-400">
                No LINE Channels created yet — add one under LINE Channels first.
              </li>
            )}
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Google Sheet export</h2>
        <p className="mb-3 text-sm text-gray-500">
          One-way mirror: the app is the source of truth, and this sheet is overwritten on
          every sync. Edits made directly in the sheet will be lost on the next sync.
        </p>
        <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
          <form action={setSheetExportConfig.bind(null, university.id)} className="flex gap-2">
            <input
              name="googleSheetId"
              defaultValue={university.sheetExportConfig?.googleSheetId ?? ""}
              placeholder="Google Sheet ID (from its URL)"
              required
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <button type="submit" className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white">
              Save
            </button>
          </form>

          {university.sheetExportConfig && (
            <>
              <form action={triggerSheetSync.bind(null, university.id)}>
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700"
                >
                  Sync now
                </button>
              </form>
              <p className="text-xs text-gray-400">
                Last synced:{" "}
                {university.sheetExportConfig.lastSyncedAt
                  ? university.sheetExportConfig.lastSyncedAt.toLocaleString()
                  : "never"}{" "}
                {university.sheetExportConfig.lastSyncStatus && (
                  <span
                    className={
                      university.sheetExportConfig.lastSyncStatus === "SUCCESS"
                        ? "text-green-600"
                        : "text-red-600"
                    }
                  >
                    ({university.sheetExportConfig.lastSyncStatus})
                  </span>
                )}
              </p>
              {university.sheetExportConfig.lastSyncError && (
                <p className="text-xs text-red-500">{university.sheetExportConfig.lastSyncError}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
