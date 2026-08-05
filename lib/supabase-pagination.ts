const PAGE_SIZE = 500;

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function loadAllSupabasePages<T>(
  loadPage: (from: number, to: number) => PromiseLike<PageResult<T>>
) {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

export function chunksOf<T>(values: T[], size = 100) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}
