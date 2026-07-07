import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { AdminRole } from "@/generated/prisma/enums";
import {
  updateChannel,
  setChannelActive,
  refreshLineBotInfo,
  publishChannelRichMenu,
  issueAccessToken,
  setChannelWebhook,
  createOrRecreateLiffApp,
  syncQuotaFromLine,
} from "@/lib/actions/channels";
import { setChannelPoolMembership } from "@/lib/actions/universities";
import { currentYearMonth } from "@/lib/quota";
import { projectCostForAllTiers } from "@/lib/linePricing";
import { getChannelQrInfo } from "@/lib/lineQr";
import { getChannelLiveStatus } from "@/lib/channelStatus";
import { ChannelForm } from "./ChannelForm";
import { PublishRichMenuButton } from "./PublishRichMenuButton";
import { ChannelActionButton } from "./ChannelActionButton";

export default async function ChannelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ setup?: string }>;
}) {
  const { id } = await params;
  const { setup } = await searchParams;
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
  const hasToken = decryptSecret(channel.accessTokenEncrypted).length > 0;
  const qrInfo = hasToken ? await getChannelQrInfo(channel) : null;
  const liveStatus = hasToken ? await getChannelLiveStatus(channel.accessTokenEncrypted) : { webhook: null, quota: null };
  const expectedWebhookUrl = `${process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? ""}/api/webhook/${channel.id}`;

  const updateChannelWithId = updateChannel.bind(null, channel.id);
  const publishChannelRichMenuWithId = publishChannelRichMenu.bind(null, channel.id);
  const issueAccessTokenWithId = issueAccessToken.bind(null, channel.id);
  const setChannelWebhookWithId = setChannelWebhook.bind(null, channel.id);
  const createOrRecreateLiffAppWithId = createOrRecreateLiffApp.bind(null, channel.id);
  const syncQuotaFromLineWithId = syncQuotaFromLine.bind(null, channel.id);

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">{channel.name}</h1>

      {setup === "partial" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          สร้างแชนแนลแล้ว แต่การตั้งค่าอัตโนมัติบางขั้นตอนไม่สำเร็จ — เช็คการ์ด Access token / LIFF app /
          Webhook ด้านล่าง แล้วกดปุ่มของขั้นตอนที่ยังไม่เสร็จอีกครั้ง
        </div>
      )}
      {setup === "ok" && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-xs text-green-800">
          ตั้งค่าอัตโนมัติเสร็จเรียบร้อย (access token, webhook, LIFF app) — เหลือแค่เปิด &quot;Use webhook&quot;
          ใน LINE Developers Console เอง (ดูการ์ด Webhook ด้านล่าง)
        </div>
      )}

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

      <div className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Access token</h2>
        <p className="mb-2 text-xs text-gray-500">
          {hasToken ? (
            channel.accessTokenExpiresAt ? (
              <>ออกอัตโนมัติ — หมดอายุ {channel.accessTokenExpiresAt.toLocaleString()} (cron จะออกใหม่ให้ก่อนหมดอายุ)</>
            ) : (
              <>Token ปัจจุบันไม่ได้ออกผ่านระบบนี้ (เช่น แบบ long-lived ที่ออกเองใน Console) — ไม่มีวันหมดอายุ</>
            )
          ) : (
            <>ยังไม่มี token — กดปุ่มด้านล่างเพื่อออกอัตโนมัติจาก Channel ID + Secret</>
          )}
        </p>
        <ChannelActionButton
          action={issueAccessTokenWithId}
          idleLabel={hasToken ? "ออก token ใหม่ (reissue)" : "ออก token"}
          pendingLabel="กำลังออก..."
        />
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">LIFF app</h2>
        <p className="mb-2 text-xs text-gray-500">
          {channel.liffId ? <>LIFF ID ปัจจุบัน: <span className="font-mono">{channel.liffId}</span></> : "ยังไม่ได้สร้าง LIFF app"}
        </p>
        <ChannelActionButton
          action={createOrRecreateLiffAppWithId}
          idleLabel={channel.liffId ? "สร้าง LIFF app ใหม่แทนอันเดิม" : "สร้าง LIFF app"}
          pendingLabel="กำลังสร้าง..."
        />
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Webhook</h2>
        {liveStatus.webhook ? (
          <div className="mb-2 text-xs text-gray-500">
            <p className="break-all">
              URL: <span className="font-mono">{liveStatus.webhook.endpoint}</span>
              {liveStatus.webhook.endpoint !== expectedWebhookUrl && (
                <span className="ml-1 text-amber-600">(ไม่ตรงกับที่ควรจะเป็น — กด &quot;ตั้ง webhook URL&quot; ด้านล่าง)</span>
              )}
            </p>
            <p className="mt-1 flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${liveStatus.webhook.active ? "bg-green-500" : "bg-red-500"}`} />
              {liveStatus.webhook.active ? (
                "Use webhook: เปิดอยู่"
              ) : (
                <span className="font-medium text-red-600">
                  Use webhook: ปิดอยู่ — LINE จะไม่ส่ง event ใดๆ มาเลย ต้องเข้าไปเปิดเองใน LINE Developers
                  Console → Messaging API (ไม่มี API ให้เปิดจากที่นี่)
                </span>
              )}
            </p>
          </div>
        ) : (
          <p className="mb-2 text-xs text-gray-400">ยังดึงสถานะ webhook จาก LINE ไม่ได้ (ต้องมี access token ที่ใช้งานได้ก่อน)</p>
        )}
        <ChannelActionButton action={setChannelWebhookWithId} idleLabel="ตั้ง webhook URL ให้ตรงกับระบบนี้" pendingLabel="กำลังตั้งค่า..." />
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

        <div>
          <label className="block text-sm font-medium text-gray-700">LINE Channel secret</label>
          <input
            name="channelSecret"
            placeholder="Leave blank to keep the current value"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
          />
          <p className="mt-1 text-xs text-gray-400">
            From Basic settings → Channel secret. Stored values are encrypted and never displayed
            back — leave blank unless rotating. LINE doesn&apos;t expose this via any API, so it&apos;s the
            one secret that must always be pasted in by hand. After rotating it, click &quot;reissue&quot;
            on the Access token card above.
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
          Cost projection ({usedThisMonth} messages this month, our own counter)
        </h2>
        {liveStatus.quota && (
          <p className="mb-2 text-xs text-gray-500">
            LINE รายงานสด: {liveStatus.quota.type === "limited" ? `จำกัด ${liveStatus.quota.limit} ข้อความ/เดือน` : "ไม่จำกัด (แผนเสียเงิน)"},
            ใช้ไปแล้ว {liveStatus.quota.consumedThisMonth} ข้อความเดือนนี้
          </p>
        )}
        <div className="mb-2">
          <ChannelActionButton
            action={syncQuotaFromLineWithId}
            idleLabel="Sync monthly free quota จาก LINE"
            pendingLabel="กำลังดึงข้อมูล..."
          />
        </div>
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
