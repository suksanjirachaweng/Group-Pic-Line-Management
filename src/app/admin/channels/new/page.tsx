import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { AdminRole } from "@/generated/prisma/enums";
import { createChannel } from "@/lib/actions/channels";

export default async function NewChannelPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== AdminRole.SUPERADMIN) {
    redirect("/admin/universities");
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#06C755]" />
        New LINE Channel
      </h1>

      <form
        action={createChannel}
        className="space-y-4 rounded-md border-t-4 border-[#06C755] border-x border-b border-gray-200 bg-white p-6"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input name="name" required placeholder="e.g. KU Bot 1" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <p className="mt-1 text-xs text-gray-400">
            Your own label for this LINE Channel — not synced with LINE, just for telling channels apart here.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">LINE Channel ID</label>
          <input name="lineChannelId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <p className="mt-1 text-xs text-gray-400">
            From LINE Developers Console → your channel → Basic settings → Channel ID.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">LIFF ID</label>
          <input name="liffId" required placeholder="e.g. 1234567890-abcdefgh" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <p className="mt-1 text-xs text-gray-400">
            From the channel&apos;s LIFF tab. After creating, the channel page can fetch this for you
            automatically from LINE.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">LINE Channel access token</label>
          <textarea name="accessToken" required rows={3} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs" />
          <p className="mt-1 text-xs text-gray-400">
            From the Messaging API tab → Channel access token (long-lived) — issue one if you haven&apos;t.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">LINE Channel secret</label>
          <input name="channelSecret" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs" />
          <p className="mt-1 text-xs text-gray-400">
            From Basic settings → Channel secret. Both are encrypted before being stored.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Monthly free quota</label>
          <input
            name="monthlyFreeQuota"
            type="number"
            defaultValue={300}
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            LINE&apos;s free-tier numbers change over time — adjust to match this channel&apos;s actual plan.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" name="allowOverage" defaultChecked />
          Allow sending to continue past the free quota (accept paid overage)
        </label>

        <button type="submit" className="rounded-md bg-[#06C755] px-3 py-2 text-sm font-medium text-white hover:bg-[#05a648]">
          Create
        </button>
      </form>
    </div>
  );
}
