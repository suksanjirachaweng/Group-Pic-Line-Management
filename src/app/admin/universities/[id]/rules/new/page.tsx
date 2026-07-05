import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRule } from "@/lib/actions/rules";
import { ConditionRowsFields } from "../ConditionRowsFields";
import { TriggerFields } from "../TriggerFields";

export default async function NewRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: universityId } = await params;

  const session = await getServerSession(authOptions);
  if (!canAccessUniversity(session!.user, universityId)) notFound();

  const fields = await prisma.formFieldDefinition.findMany({
    where: { universityId },
    orderBy: { sortOrder: "asc" },
  });

  const createRuleWithId = createRule.bind(null, universityId);

  return (
    <div className="max-w-lg">
      <h1 className="mb-4 text-lg font-semibold text-gray-900">New rule</h1>

      {fields.length > 0 && (
        <p className="mb-4 text-xs text-gray-400">
          Available field keys: {fields.map((f) => f.key).join(", ")}
        </p>
      )}

      <form action={createRuleWithId} className="space-y-4 rounded-md border border-gray-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input name="name" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </div>

        <TriggerFields />

        <ConditionRowsFields />

        <div>
          <label className="block text-sm font-medium text-gray-700">Message template</label>
          <textarea
            name="messageTemplate"
            required
            rows={4}
            placeholder="e.g. Hi {{displayName}}, thanks for registering as {{faculty}}!"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            Use {"{{field_key}}"} to insert a value, or {"{{displayName}}"} for the LINE display name.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" name="isActive" defaultChecked />
          Active
        </label>

        <button type="submit" className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-sm font-medium text-white">
          Create
        </button>
      </form>
    </div>
  );
}
