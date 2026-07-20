export default function TeacherLoading() {
  return (
    <main className="mx-auto max-w-6xl animate-pulse px-4 py-8">
      <div className="h-8 w-64 rounded bg-stone-200" />
      <div className="mt-3 h-5 w-96 max-w-full rounded bg-stone-200" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="h-48 rounded-lg bg-stone-200" />
        <div className="h-48 rounded-lg bg-stone-200" />
      </div>
    </main>
  );
}
