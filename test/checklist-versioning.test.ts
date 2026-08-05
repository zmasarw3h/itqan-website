import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECKLIST_VERSION_EFFECTIVE_DATE, tasksForDate } from "@/lib/scoring";

const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260805090000_version_checklist_definition.sql", import.meta.url),
  "utf8"
);

function weekdaysForTask(taskKey: string, effectiveFrom: string) {
  if (taskKey === "new_memorization_listening") {
    return "0,1,2,3";
  }

  if (taskKey === "repeat_new_memorization_3x_listen_1x") {
    return "4";
  }

  if (taskKey === "repeat_new_memorization_5x_listen_1x") {
    return "5";
  }

  if (taskKey === "tafsir_reflection_group" || taskKey === "repeat_week_memorization_2x") {
    return "6";
  }

  if (taskKey === "tafsir" && effectiveFrom === CHECKLIST_VERSION_EFFECTIVE_DATE) {
    return "0,1,2,3";
  }

  return "0,1,2,3,4,5";
}

function sqlDefinitionRow(effectiveFrom: string, task: { key: string; label: string; weight: number }) {
  return `      (date '${effectiveFrom}', '${task.key}', '${task.label}', ${task.weight}, array[${weekdaysForTask(task.key, effectiveFrom)}]::integer[])`;
}

describe("versioned checklist definition parity", () => {
  it("contains the same legacy and effective-date task snapshots as application scoring", () => {
    const definitionCases = [
      { date: "2026-08-06", effectiveFrom: "-infinity" },
      { date: "2026-08-09", effectiveFrom: CHECKLIST_VERSION_EFFECTIVE_DATE },
      { date: "2026-08-13", effectiveFrom: CHECKLIST_VERSION_EFFECTIVE_DATE },
      { date: "2026-08-14", effectiveFrom: CHECKLIST_VERSION_EFFECTIVE_DATE },
      { date: "2026-08-15", effectiveFrom: CHECKLIST_VERSION_EFFECTIVE_DATE }
    ];

    for (const definitionCase of definitionCases) {
      for (const task of tasksForDate(definitionCase.date)) {
        expect(migrationSource).toContain(sqlDefinitionRow(definitionCase.effectiveFrom, task));
      }
    }
  });

  it("selects the latest database definition whose effective date is not after the checklist date", () => {
    expect(migrationSource).toContain("where definitions.effective_from <= input_date");
    expect(migrationSource).toContain("select max(definitions.effective_from) as effective_from");
    expect(migrationSource).toContain("date '2026-08-09'");
    expect(migrationSource).toContain(
      "(date '2026-08-09', 'repeat_new_memorization_3x_listen_1x', 'Repeat new memorization 3 times & listen one time', 30"
    );
    expect(migrationSource).toContain(
      "(date '2026-08-09', 'repeat_new_memorization_5x_listen_1x', 'Repeat new memorization 5 times & listen one time', 30"
    );
  });
});
