export default function LoadingPersonAccess() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="h-32 animate-pulse rounded-xl bg-stone-200" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,20rem)]">
        <div className="h-96 animate-pulse rounded-xl bg-stone-200" />
        <div className="h-80 animate-pulse rounded-xl bg-stone-200" />
      </div>
    </main>
  );
}
