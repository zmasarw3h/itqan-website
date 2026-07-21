import { describe, expect, it } from "vitest";
import {
  resolveStudentScope,
  resolveTeacherMasjidId,
  type AdminCreateUserScopeOptions
} from "@/lib/admin-user-scope";

const onlineSistersScope: AdminCreateUserScopeOptions = {
  masjids: [
    {
      id: "masjid-online",
      name: "ITQAN Online Sisters Program",
      slug: "itqan-online-sisters-program",
      membership_starts_on: "2026-07-20"
    }
  ],
  cohorts: [
    {
      id: "cohort-sisters",
      masjid_id: "masjid-online",
      kind: "sisters",
      name: "Sisters",
      sort_order: 10
    }
  ],
  groups: [{ id: "group-1", cohort_id: "cohort-sisters", name: "Group 1", sort_order: 10 }]
};

describe("admin add-user scope resolution", () => {
  it("uses the only valid student scope without rendering a choice", () => {
    expect(resolveStudentScope(onlineSistersScope)).toMatchObject({
      masjidId: "masjid-online",
      cohortId: "cohort-sisters",
      groupId: "group-1"
    });
    expect(resolveTeacherMasjidId(onlineSistersScope)).toBe("masjid-online");
  });

  it("narrows cohort and group choices after a masjid selection", () => {
    const options: AdminCreateUserScopeOptions = {
      ...onlineSistersScope,
      masjids: [
        ...onlineSistersScope.masjids,
        { id: "masjid-tic", name: "TIC", slug: "tic", membership_starts_on: "2026-01-01" }
      ],
      cohorts: [
        ...onlineSistersScope.cohorts,
        { id: "cohort-brothers", masjid_id: "masjid-tic", kind: "brothers", name: "Brothers", sort_order: 10 }
      ],
      groups: [...onlineSistersScope.groups, { id: "group-tic", cohort_id: "cohort-brothers", name: "Group 1", sort_order: 10 }]
    };

    expect(resolveStudentScope(options, { masjidId: "masjid-tic" })).toMatchObject({
      masjidId: "masjid-tic",
      cohortId: "cohort-brothers",
      groupId: "group-tic"
    });
  });

  it("requires an explicit group selection when a cohort has multiple groups", () => {
    const options: AdminCreateUserScopeOptions = {
      ...onlineSistersScope,
      groups: [
        ...onlineSistersScope.groups,
        { id: "group-2", cohort_id: "cohort-sisters", name: "Group 2", sort_order: 20 }
      ]
    };

    expect(resolveStudentScope(options)).toMatchObject({
      masjidId: "masjid-online",
      cohortId: "cohort-sisters",
      groupId: ""
    });
  });
});
