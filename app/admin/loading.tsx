export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading admin dashboard" className="min-h-dvh animate-pulse bg-paper">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="space-y-2">
            <div className="h-3 w-16 rounded bg-stone-200" />
            <div className="h-3 w-28 rounded bg-stone-100" />
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <div className="h-9 w-16 rounded bg-stone-100" />
            <div className="h-9 w-20 rounded bg-stone-100" />
            <div className="h-9 w-20 rounded bg-stone-100" />
            <div className="h-9 w-20 rounded bg-stone-100" />
          </div>
          <div className="h-11 w-20 rounded border border-stone-200 bg-stone-50 md:hidden" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="h-7 w-44 rounded bg-stone-200" />
            <div className="h-4 w-64 max-w-[70vw] rounded bg-stone-100" />
          </div>
          <div className="h-10 w-28 rounded bg-stone-200" />
        </div>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <div className="h-4 w-16 rounded bg-stone-100" />
          <div className="mt-2 h-10 w-56 max-w-full rounded bg-stone-100" />
        </section>

        <section className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3 sm:grid-cols-4">
            <div className="h-4 rounded bg-stone-200 sm:col-span-2" />
            <div className="hidden h-4 rounded bg-stone-200 sm:block" />
            <div className="hidden h-4 rounded bg-stone-200 sm:block" />
          </div>
          <div className="divide-y divide-stone-100">
            {["row-1", "row-2", "row-3", "row-4"].map((row) => (
              <div className="grid gap-3 px-4 py-4 sm:grid-cols-4" key={row}>
                <div className="space-y-2 sm:col-span-2">
                  <div className="h-4 w-36 max-w-full rounded bg-stone-200" />
                  <div className="h-3 w-48 max-w-full rounded bg-stone-100" />
                </div>
                <div className="h-4 w-16 rounded bg-stone-100" />
                <div className="h-4 w-20 rounded bg-stone-100" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
