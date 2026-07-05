import { RuleTrigger } from "@/generated/prisma/enums";

export function TriggerFields({
  trigger,
  relativeToField,
  offsetMinutes,
}: {
  trigger?: RuleTrigger;
  relativeToField?: string;
  offsetMinutes?: number;
}) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700">Trigger</label>
        <select
          name="trigger"
          defaultValue={trigger ?? RuleTrigger.ON_REGISTRATION}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value={RuleTrigger.ON_REGISTRATION}>On registration (fires once, immediately)</option>
          <option value={RuleTrigger.SCHEDULED_TICK}>Scheduled (fires relative to a date field)</option>
        </select>
      </div>

      <div className="rounded-md border border-dashed border-gray-300 p-3">
        <p className="mb-2 text-xs text-gray-400">
          Only used when trigger is &quot;Scheduled&quot; — ignored otherwise.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-700">Date field key</label>
            <input
              name="relativeToField"
              defaultValue={relativeToField ?? ""}
              placeholder="e.g. photo_slot_at"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Offset (minutes)</label>
            <input
              name="offsetMinutes"
              type="number"
              defaultValue={offsetMinutes ?? -1440}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
            <p className="mt-1 text-xs text-gray-400">e.g. -1440 = 1 day before</p>
          </div>
        </div>
      </div>
    </>
  );
}
