import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type MembershipRow = {
  student_id: string;
  group_id: string;
};

type GroupRow = {
  id: string;
  cohort_id: string;
  active: boolean;
};

type CohortRow = {
  id: string;
  masjid_id: string;
  active: boolean;
};

type MasjidRow = {
  id: string;
  active: boolean;
};

type WeeklyPlanRow = {
  id: string;
  student_id: string;
  week_start: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
  masjid_id: string | null;
  cohort_id: string | null;
  halaqa_group_id: string | null;
};

const BUCKET = "weekly-plans";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function ensureSafeFilePath(studentId: string, weekStart: string, filePath: string) {
  const expectedPrefix = `${studentId}/${weekStart}/`;

  if (
    !filePath ||
    filePath.startsWith("/") ||
    filePath.includes("..") ||
    !filePath.startsWith(expectedPrefix)
  ) {
    throw new Error(`Unsafe weekly-plan path for ${studentId}/${weekStart}: ${filePath}`);
  }

  return filePath;
}

function resolveInside(root: string, relativePath: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Resolved path escapes backup root: ${relativePath}`);
  }

  return resolvedPath;
}

async function main() {
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const outputDir = path.resolve(required("CONSOLIDATION_STORAGE_BACKUP_ROOT"));
  const repoRoot = path.resolve(process.cwd());

  if (!path.relative(repoRoot, outputDir).startsWith("..")) {
    throw new Error("Refusing to write a storage backup inside the repository.");
  }

  const masjidId = required("CONSOLIDATION_MASJID_ID");
  const cohortId = required("CONSOLIDATION_COHORT_ID");
  const retainedGroupId = required("CONSOLIDATION_RETAINED_GROUP_ID");
  const retiredGroupId = required("CONSOLIDATION_RETIRED_GROUP_ID");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: hierarchy, error: hierarchyError } = await supabase
    .from("halaqa_groups")
    .select("id,cohort_id,active")
    .in("id", [retainedGroupId, retiredGroupId]);

  if (hierarchyError) {
    throw new Error(`Unable to verify consolidation hierarchy: ${hierarchyError.message}`);
  }

  const hierarchyRows = (hierarchy ?? []) as GroupRow[];

  const { data: cohort, error: cohortError } = await supabase
    .from("cohorts")
    .select("id,masjid_id,active")
    .eq("id", cohortId)
    .maybeSingle<CohortRow>();

  if (cohortError) {
    throw new Error(`Unable to verify consolidation cohort: ${cohortError.message}`);
  }

  const { data: masjid, error: masjidError } = await supabase
    .from("masajid")
    .select("id,active")
    .eq("id", masjidId)
    .maybeSingle<MasjidRow>();

  if (masjidError) {
    throw new Error(`Unable to verify consolidation masjid: ${masjidError.message}`);
  }

  if (
    hierarchyRows.length !== 2 ||
    hierarchyRows.some((row) => row.cohort_id !== cohortId) ||
    hierarchyRows.some((row) => !row.active) ||
    cohort?.masjid_id !== masjidId ||
    cohort?.active !== true ||
    masjid?.id !== masjidId ||
    masjid.active !== true
  ) {
    throw new Error("The supplied group, cohort, and masjid identifiers do not resolve to the expected hierarchy.");
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("student_group_memberships")
    .select("student_id,group_id")
    .in("group_id", [retainedGroupId, retiredGroupId]);

  if (membershipError) {
    throw new Error(`Unable to load affected students: ${membershipError.message}`);
  }

  const studentIds = [...new Set((memberships as MembershipRow[]).map((row) => row.student_id))];

  if (studentIds.length === 0) {
    throw new Error("No affected students resolved; refusing to create an empty backup.");
  }

  const { data: plans, error: plansError } = await supabase
    .from("weekly_plans")
    .select(
      "id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at,masjid_id,cohort_id,halaqa_group_id"
    )
    .eq("masjid_id", masjidId)
    .eq("cohort_id", cohortId)
    .in("halaqa_group_id", [retainedGroupId, retiredGroupId])
    .in("student_id", studentIds)
    .order("week_start", { ascending: true })
    .order("student_id", { ascending: true });

  if (plansError) {
    throw new Error(`Unable to load weekly-plan metadata: ${plansError.message}`);
  }

  const planRows = (plans ?? []) as WeeklyPlanRow[];
  const filesRoot = path.join(outputDir, "files");
  await mkdir(outputDir, { recursive: false, mode: 0o700 });
  await chmod(outputDir, 0o700);
  await mkdir(filesRoot, { recursive: true, mode: 0o700 });

  const manifestRows: Array<WeeklyPlanRow & { storage_sha256: string; downloaded_bytes: number }> = [];

  for (const plan of planRows) {
    const safePath = ensureSafeFilePath(plan.student_id, plan.week_start, plan.file_path);
    const { data, error } = await supabase.storage.from(BUCKET).download(safePath);

    if (error || !data) {
      throw new Error(`Unable to download ${safePath}: ${error?.message ?? "empty response"}`);
    }

    const bytes = Buffer.from(await data.arrayBuffer());
    const destination = resolveInside(filesRoot, safePath);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { mode: 0o600, flag: "wx" });
    await chmod(destination, 0o600);

    manifestRows.push({
      ...plan,
      storage_sha256: createHash("sha256").update(bytes).digest("hex"),
      downloaded_bytes: bytes.byteLength
    });
  }

  const manifest = {
    captured_at: new Date().toISOString(),
    bucket: BUCKET,
    masjid_id: masjidId,
    cohort_id: cohortId,
    retained_group_id: retainedGroupId,
    retired_group_id: retiredGroupId,
    affected_student_count: studentIds.length,
    weekly_plan_row_count: planRows.length,
    rows: manifestRows
  };

  const manifestPath = path.join(outputDir, "weekly-plan-storage-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await chmod(manifestPath, 0o600);

  console.log(`Archived ${planRows.length} weekly-plan object(s) for ${studentIds.length} affected student(s).`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
