import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { AdminRole } from "@/generated/prisma/enums";
import { currentYearMonth } from "@/lib/quota";
import { cheapestViablePlan } from "@/lib/linePricing";
import { getChannelQrInfo } from "@/lib/lineQr";
import { saveLineLoginChannel, issueLineLoginChannelToken } from "@/lib/actions/lineLoginChannel";
import { LineLoginChannelCard } from "./LineLoginChannelCard";

export default async function ChannelsPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== AdminRole.SUPERADMIN) {
    redirect("/admin/universities");
  }

  const yearMonth = currentYearMonth();
  const channels = await prisma.channel.findMany({
    orderBy: { name: "asc" },
    include: {
      usageCounters: { where: { yearMonth } },
      universityPool: { where: { isActive: true }, include: { university: true } },
    },
  });

  const qrInfos = await Promise.all(channels.map((c) => getChannelQrInfo(c)));

  const lineLoginChannel = await prisma.lineLoginChannel.findUnique({ where: { id: "singleton" } });
  const lineLoginHasToken = lineLoginChannel ? decryptSecret(lineLoginChannel.accessTokenEncrypted).length > 0 : false;
  const lineLoginStatusText = !lineLoginChannel
    ? "ยังไม่ได้ตั้งค่า"
    : lineLoginHasToken
      ? `มี token แล้ว — หมดอายุ ${lineLoginChannel.accessTokenExpiresAt?.toLocaleString() ?? "-"} (cron จะออกใหม่ให้ก่อนหมดอายุ)`
      : "ตั้งค่า Channel ID/Secret แล้ว แต่ยังไม่ได้ออก token";

  return (
    <div>
      <LineLoginChannelCard
        currentChannelId={lineLoginChannel?.channelId ?? ""}
        statusText={lineLoginStatusText}
        saveAction={saveLineLoginChannel}
        issueTokenAction={issueLineLoginChannelToken}
      />

      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#06C755]" />
          LINE Channels
        </h1>
        <Link
          href="/admin/channels/new"
          className="rounded-md bg-[#06C755] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#05a648]"
        >
          New LINE Channel
        </Link>
      </div>

      {channels.length === 0 ? (
        <p className="text-sm text-gray-500">No LINE Channels yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
          {channels.map((c, i) => {
            const used = c.usageCounters[0]?.messagesSent ?? 0;
            const pct = Math.min(100, Math.round((used / c.monthlyFreeQuota) * 100));
            const recommended = cheapestViablePlan(used);
            const qrInfo = qrInfos[i];
            const universities = c.universityPool.map((p) => p.university.name);
            return (
              <li key={c.id}>
                <Link href={`/admin/channels/${c.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
                  {qrInfo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrInfo.qrDataUrl} alt="" className="h-12 w-12 shrink-0 rounded border-2 border-[#06C755] p-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        {c.name} <span className="text-gray-400">({c.lineChannelId})</span>
                        {!c.isActive && (
                          <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                            inactive
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-3 text-gray-500">
                        <span className="text-xs">
                          Recommended: <span className="font-medium text-gray-700">{recommended.name}</span> (฿
                          {recommended.projectedCost}/mo)
                        </span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                          <span
                            className={pct >= 100 ? "block h-full bg-red-500" : "block h-full bg-indigo-600"}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        {used} / {c.monthlyFreeQuota} this month
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-400">
                      {universities.length > 0 ? universities.join(", ") : "Not assigned to any university"}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
