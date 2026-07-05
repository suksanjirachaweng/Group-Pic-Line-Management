import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RegistrantStatus } from "@/generated/prisma/enums";
import { updateRegistrantStatus, sendManualMessage } from "@/lib/actions/registrants";

export default async function RegistrantDetailPage({
  params,
}: {
  params: Promise<{ id: string; registrantId: string }>;
}) {
  const { id: universityId, registrantId } = await params;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const registrant = await prisma.registrant.findUnique({
    where: { id: registrantId, universityId },
    include: {
      channel: { select: { name: true } },
      university: { include: { formFields: { orderBy: { sortOrder: "asc" } } } },
      messageLogs: { orderBy: { createdAt: "desc" } },
      messageJobs: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!registrant) notFound();

  const updateStatusWithIds = updateRegistrantStatus.bind(null, universityId, registrantId);
  const sendMessageWithIds = sendManualMessage.bind(null, universityId, registrantId);
  const data = registrant.data as Record<string, string | number>;

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <Link
          href={`/admin/universities/${universityId}/registrants`}
          className="text-sm text-gray-500 hover:underline"
        >
          ← Back to registrants
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-gray-900">
          {registrant.displayName ?? "(no name)"}
        </h1>
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-400">LINE User ID</dt>
            <dd className="font-mono text-xs">{registrant.lineUserId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-400">LINE Channel</dt>
            <dd>{registrant.channel?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Friend status</dt>
            <dd>{registrant.isFriend ? "Friend" : "Not a friend (messages will fail)"}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Registered</dt>
            <dd>{registrant.registeredAt.toLocaleString()}</dd>
          </div>
          {registrant.university.formFields.map((f) => (
            <div key={f.key}>
              <dt className="text-gray-400">{f.label}</dt>
              <dd>{data[f.key] ?? "—"}</dd>
            </div>
          ))}
        </dl>

        <form action={updateStatusWithIds} className="mt-4 flex items-center gap-2">
          <select name="status" defaultValue={registrant.status} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            {Object.values(RegistrantStatus).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white">
            Update status
          </button>
        </form>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Send a message</h2>
        {registrant.channelId ? (
          <form action={sendMessageWithIds} className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
            <textarea
              name="body"
              required
              rows={3}
              placeholder="Message to send to this registrant on LINE"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white">
              Queue message
            </button>
            <p className="text-xs text-gray-400">
              Queued messages are sent by the background worker, which respects this
              registrant&apos;s channel quota.
            </p>
          </form>
        ) : (
          <p className="text-sm text-gray-400">
            This registrant hasn&apos;t completed the LIFF registration flow yet, so no channel is bound.
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Message history</h2>
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Sent</th>
                <th className="px-4 py-2">Body</th>
                <th className="px-4 py-2">LINE status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {registrant.messageLogs.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 text-gray-500">{m.createdAt.toLocaleString()}</td>
                  <td className="px-4 py-2">{m.body}</td>
                  <td className="px-4 py-2 text-gray-500">{m.lineApiResponseStatus ?? "—"}</td>
                </tr>
              ))}
              {registrant.messageLogs.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-gray-400">
                    No messages sent yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {registrant.messageJobs.some((j) => j.status === "QUEUED" || j.status === "FAILED") && (
        <div>
          <h2 className="mb-3 text-base font-semibold text-gray-900">Pending / failed jobs</h2>
          <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white text-sm">
            {registrant.messageJobs
              .filter((j) => j.status === "QUEUED" || j.status === "FAILED")
              .map((j) => (
                <li key={j.id} className="flex items-center justify-between px-4 py-2">
                  <span>{j.body}</span>
                  <span className={j.status === "FAILED" ? "text-red-600" : "text-gray-400"}>{j.status}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
