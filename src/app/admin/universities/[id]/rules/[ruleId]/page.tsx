import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateRule } from "@/lib/actions/rules";
import { ConditionRowsFields } from "../ConditionRowsFields";
import { TriggerFields } from "../TriggerFields";
import { TestSendButton } from "./TestSendButton";
import type { ConditionGroup } from "@/lib/rules/evaluate";

export default async function EditRulePage({
  params,
}: {
  params: Promise<{ id: string; ruleId: string }>;
}) {
  const { id: universityId, ruleId } = await params;

  const session = await getServerSession(authOptions);
  if (!canAccessUniversity(session!.user, universityId)) notFound();

  const [rule, fields, testRecipients] = await Promise.all([
    prisma.rule.findUnique({ where: { id: ruleId, universityId } }),
    prisma.formFieldDefinition.findMany({ where: { universityId }, orderBy: { sortOrder: "asc" } }),
    // Most-recent-first and capped — the admin's own test registration (the realistic "self" to
    // send to) is almost always among the most recent rows, and a university can have thousands
    // of registrants, which would make a plain <select> unwieldy without this cap.
    prisma.registrant.findMany({
      where: { universityId, lineUserId: { not: null }, channelId: { not: null } },
      orderBy: { registeredAt: "desc" },
      take: 200,
      select: { id: true, displayName: true, lineUserId: true },
    }),
  ]);
  if (!rule) notFound();

  const updateRuleWithIds = updateRule.bind(null, universityId, ruleId);
  const conditionTree = rule.conditionTree as ConditionGroup;
  const existingConditions = conditionTree.conditions.filter(
    (c): c is Extract<typeof c, { field: string }> => "field" in c,
  );

  return (
    <div className="max-w-lg">
      <h1 className="mb-4 text-lg font-semibold text-gray-900">{rule.name}</h1>

      {fields.length > 0 && (
        <p className="mb-4 text-xs text-gray-400">
          Available field keys: {fields.map((f) => f.key).join(", ")}
        </p>
      )}

      <form action={updateRuleWithIds} className="space-y-4 rounded-md border border-gray-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input
            name="name"
            defaultValue={rule.name}
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <TriggerFields
          trigger={rule.trigger}
          relativeToField={(rule.scheduleConfig as { relativeToField?: string } | null)?.relativeToField}
          offsetMinutes={(rule.scheduleConfig as { offsetMinutes?: number } | null)?.offsetMinutes}
        />

        <ConditionRowsFields existing={existingConditions} />

        <div>
          <label className="block text-sm font-medium text-gray-700">Message template</label>
          <textarea
            name="messageTemplate"
            defaultValue={rule.messageTemplate}
            required
            rows={4}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            Use {"{{field_key}}"} to insert a value, or {"{{displayName}}"} for the LINE display name.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" name="isActive" defaultChecked={rule.isActive} />
          Active
        </label>

        <button type="submit" className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-sm font-medium text-white">
          Save
        </button>
      </form>

      <div className="mt-4">
        <TestSendButton
          universityId={universityId}
          ruleId={ruleId}
          registrants={testRecipients.map((r) => ({ id: r.id, displayName: r.displayName, lineUserId: r.lineUserId! }))}
        />
      </div>
    </div>
  );
}
