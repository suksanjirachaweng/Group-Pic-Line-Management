import type { Condition } from "@/lib/rules/evaluate";

const OPERATORS = [
  "eq",
  "neq",
  "contains",
  "gt",
  "lt",
  "gte",
  "lte",
  "before",
  "after",
  "is_empty",
  "is_not_empty",
] as const;

const ROW_COUNT = 5;

export function ConditionRowsFields({ existing = [] }: { existing?: Condition[] }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">
        Conditions (all must match — AND)
      </label>
      <p className="mb-2 mt-1 text-xs text-gray-400">
        Field must match a form field key exactly (e.g. <code>faculty</code>). Leave a row&apos;s
        field blank to skip it.
      </p>
      <div className="space-y-2">
        {Array.from({ length: ROW_COUNT }).map((_, i) => {
          const row = existing[i];
          return (
            <div key={i} className="grid grid-cols-3 gap-2">
              <input
                name={`field_${i}`}
                defaultValue={row?.field ?? ""}
                placeholder="field key"
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
              <select
                name={`operator_${i}`}
                defaultValue={row?.operator ?? "eq"}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                {OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              <input
                name={`value_${i}`}
                defaultValue={row?.value ?? ""}
                placeholder="value"
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
