const DEFAULT_PAGE_SIZE = 1000;

export async function selectAllRows(createQuery, pageSize = DEFAULT_PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const result = await createQuery().range(from, to);
    if (result.error) return { data: rows, error: result.error };
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < pageSize) return { data: rows, error: null };
  }
}
