import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminRole } from "@/generated/prisma/enums";
import { updateChannel, setChannelActive, refreshLineBotInfo, publishChannelRichMenu } from "@/lib/actions/channels";
import { setChannelPoolMembership } from "@/lib/actions/universities";
import { currentYearMonth } from "@/lib/quota";
import { projectCostForAllTiers } from "@/lib/linePricing";
import { getChannelQrInfo } from "@/lib/lineQr";
import { ChannelForm } from "./ChannelForm";
import { LiffIdField } from "./LiffIdField";
import { PublishRichMenuButton } from "./PublishRichMenuButton";

export default async function ChannelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (session!.user.role !== AdminRole.SUPERADMIN) {
    redirect("/admin/universities");
  }

  const yearMonth = currentYearMonth();
  const channel = await prisma.channel.findUnique({
    where: { id },
    include: {
      universityPool: { include: { university: true } },
      usageCounters: { where: { yearMonth } },
    },
  });
  if (!channel) notFound();

  const usedThisMonth = channel.usageCounters[0]?.messagesSent ?? 0;
  const tierProjections = projectCostForAllTiers(usedThisMonth);
  const qrInfo = await getChannelQrInfo(channel);

  const updateChannelWithId = updateChannel.bind(null, channel.id);
  const publishChannelRichMenuWithId = publishChannelRichMenu.bind(null, channel.id);

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">{channel.name}</h1>

      <div className="rounded-md border-t-4 border-[#06C755] border-x border-b border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <span className="inline-block h-2 w-2 rounded-full bg-[#06C755]" />
            LINE Bot info (from LINE)
          </h2>
          <form action={refreshLineBotInfo.bind(null, channel.id)}>
            <button
              type="submit"
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Refresh
            </button>
          </form>
        </div>
        {qrInfo ? (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrInfo.qrDataUrl} alt="LINE add-friend QR code" className="h-32 w-32 rounded border-2 border-[#06C755] p-1" />
            <div className="text-sm">
              <div className="mb-2 flex items-center gap-2">
                {qrInfo.pictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrInfo.pictureUrl} alt="" className="h-10 w-10 rounded-full border border-gray-200" />
                ) : (
                  <span className="h-10 w-10 rounded-full bg-gray-100" />
                )}
                <p className="font-medium text-gray-900">{qrInfo.displayName || "(no display name)"}</p>
              </div>
              <p className="text-gray-500">Bot basic ID</p>
              <p className="font-medium text-gray-900">{qrInfo.basicId}</p>
              <a
                href={qrInfo.addFriendUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs text-[#06C755] hover:underline"
              >
                {qrInfo.addFriendUrl}
              </a>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            Couldn&apos;t fetch this LINE Channel&apos;s bot info — check that the access token below is valid.
          </p>
        )}
        <p className="mt-3 text-xs text-gray-400">
          Display name and icon are pulled automatically from LINE once a valid access token is saved
          below — nothing to copy manually for those.
        </p>
      </div>

      <ChannelForm action={updateChannelWithId}>
        <div>
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input name="name" defaultValue={channel.name} required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <p className="mt-1 text-xs text-gray-400">
            Your own label for this LINE Channel — not synced with LINE, just for telling channels apart here.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">LINE Channel ID</label>
          <input name="lineChannelId" defaultValue={channel.lineChannelId} required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <p className="mt-1 text-xs text-gray-400">
            Copy from LINE Developers Console → your channel → Basic settings → Channel ID. LINE
            doesn&apos;t expose an API to look this up, so it must be pasted in manually.
          </p>
        </div>

        <LiffIdField channelId={channel.id} defaultValue={channel.liffId} />

        <div>
          <label className="block text-sm font-medium text-gray-700">LINE Channel access token</label>
          <textarea
            name="accessToken"
            rows={3}
            placeholder="Leave blank to keep the current value"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
          />
          <p className="mt-1 text-xs text-gray-400">
            From the Messaging API tab → Channel access token (long-lived) — issue one if you haven&apos;t.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">LINE Channel secret</label>
          <input
            name="channelSecret"
            placeholder="Leave blank to keep the current value"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
          />
          <p className="mt-1 text-xs text-gray-400">
            From Basic settings → Channel secret. Stored values are encrypted and never displayed
            back — leave blank unless rotating.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Monthly free quota</label>
          <input
            name="monthlyFreeQuota"
            type="number"
            defaultValue={channel.monthlyFreeQuota}
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" name="allowOverage" defaultChecked={channel.allowOverage} />
          Allow sending to continue past the free quota (accept paid overage)
        </label>

        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-md bg-[#06C755] px-3 py-2 text-sm font-medium text-white hover:bg-[#05a648]">
            Save
          </button>
          <span className="text-xs text-gray-400">Last saved: {channel.updatedAt.toLocaleString()}</span>
        </div>
      </ChannelForm>

      <form action={setChannelActive.bind(null, channel.id, !channel.isActive)}>
        <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700">
          {channel.isActive ? "Deactivate" : "Activate"}
        </button>
      </form>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Used by</h2>
        {channel.universityPool.filter((p) => p.isActive).length === 0 ? (
          <p className="text-sm text-gray-400">Not assigned to any university&apos;s pool yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
            {channel.universityPool
              .filter((p) => p.isActive)
              .map((p) => (
                <li key={p.universityId} className="flex items-center justify-between px-3 py-2 text-sm text-gray-600">
                  {p.university.name}
                  <form action={setChannelPoolMembership.bind(null, p.universityId, channel.id, false)}>
                    <button type="submit" className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Rich menu</h2>
        <p className="mb-3 text-xs text-gray-400">
          Publishes the standard 3-button rich menu (register / order photos / track status) as this
          channel&apos;s default — the &quot;register&quot; button links to the university this channel
          serves. Re-publish after changing the LIFF ID above so the link stays in sync.
        </p>
        {channel.richMenuId && (
          <p className="mb-3 text-xs text-gray-500">
            Currently published: <span className="font-mono">{channel.richMenuId}</span>
          </p>
        )}
        <PublishRichMenuButton action={publishChannelRichMenuWithId} hasExisting={!!channel.richMenuId} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">
          Cost projection ({usedThisMonth} messages this month)
        </h2>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-1.5">Plan</th>
              <th className="px-3 py-1.5">Base fee</th>
              <th className="px-3 py-1.5">Projected cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tierProjections.map((t) => (
              <tr key={t.name}>
                <td className="px-3 py-1.5">{t.name}</td>
                <td className="px-3 py-1.5">฿{t.monthlyFee}/mo</td>
                <td className="px-3 py-1.5">
                  {t.projectedCost === null ? (
                    <span className="text-gray-400">not enough quota</span>
                  ) : (
                    `฿${t.projectedCost}/mo`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-gray-400">
          Based on LINE&apos;s current published plan tiers — check manager.line.biz for this
          channel&apos;s actual current plan and pricing, which may have changed.
        </p>
      </div>
    </div>
  );
}
