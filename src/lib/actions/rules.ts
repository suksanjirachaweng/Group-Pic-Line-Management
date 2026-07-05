"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import type { ConditionOperator, ConditionGroup } from "@/lib/rules/evaluate";
import { RuleTrigger } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";

const CONDITION_ROWS = 5;

const operatorSchema: z.ZodType<ConditionOperator> = z.enum([
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
]);

const ruleFormSchema = z.object({
  name: z.string().min(1).max(200),
  messageTemplate: z.string().min(1).max(2000),
  isActive: z.boolean(),
  trigger: z.nativeEnum(RuleTrigger),
});

function parseConditionsFromForm(formData: FormData): ConditionGroup {
  const conditions = [];
  for (let i = 0; i < CONDITION_ROWS; i++) {
    const field = formData.get(`field_${i}`);
    const operator = formData.get(`operator_${i}`);
    const value = formData.get(`value_${i}`);
    if (!field || typeof field !== "string" || field.trim() === "") continue;

    const parsedOperator = operatorSchema.parse(operator);
    conditions.push({
      field: field.trim(),
      operator: parsedOperator,
      ...(value && typeof value === "string" && value !== "" ? { value } : {}),
    });
  }
  return { op: "AND", conditions };
}

function parseScheduleConfig(formData: FormData, trigger: RuleTrigger) {
  if (trigger !== RuleTrigger.SCHEDULED_TICK) return undefined;

  const relativeToField = z.string().min(1).parse(formData.get("relativeToField"));
  const offsetMinutes = z.coerce.number().int().parse(formData.get("offsetMinutes"));
  return { relativeToField, offsetMinutes };
}

export async function createRule(universityId: string, formData: FormData) {
  await requireUniversityAccess(universityId);

  const parsed = ruleFormSchema.parse({
    name: formData.get("name"),
    messageTemplate: formData.get("messageTemplate"),
    isActive: formData.get("isActive") === "on",
    trigger: formData.get("trigger"),
  });
  const conditionTree = parseConditionsFromForm(formData);
  const scheduleConfig = parseScheduleConfig(formData, parsed.trigger);

  await prisma.rule.create({
    data: {
      universityId,
      name: parsed.name,
      messageTemplate: parsed.messageTemplate,
      isActive: parsed.isActive,
      trigger: parsed.trigger,
      conditionTree,
      scheduleConfig,
    },
  });

  revalidatePath(`/admin/universities/${universityId}/rules`);
  redirect(`/admin/universities/${universityId}/rules`);
}

export async function updateRule(universityId: string, ruleId: string, formData: FormData) {
  await requireUniversityAccess(universityId);

  const parsed = ruleFormSchema.parse({
    name: formData.get("name"),
    messageTemplate: formData.get("messageTemplate"),
    isActive: formData.get("isActive") === "on",
    trigger: formData.get("trigger"),
  });
  const conditionTree = parseConditionsFromForm(formData);
  const scheduleConfig = parseScheduleConfig(formData, parsed.trigger);

  await prisma.rule.update({
    where: { id: ruleId, universityId },
    data: {
      name: parsed.name,
      messageTemplate: parsed.messageTemplate,
      isActive: parsed.isActive,
      trigger: parsed.trigger,
      conditionTree,
      scheduleConfig: scheduleConfig ?? Prisma.JsonNull,
    },
  });

  revalidatePath(`/admin/universities/${universityId}/rules`);
  revalidatePath(`/admin/universities/${universityId}/rules/${ruleId}`);
}

export async function deleteRule(universityId: string, ruleId: string) {
  await requireUniversityAccess(universityId);

  await prisma.rule.delete({ where: { id: ruleId, universityId } });

  revalidatePath(`/admin/universities/${universityId}/rules`);
}
