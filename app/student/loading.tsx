import StudentProgressNav from "@/app/student/progress-nav";

function SkeletonLine({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`h-4 rounded bg-stone-200 ${className}`} />;
}

export default function StudentLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10" id="main-content">
      <StudentProgressNav />
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading this page.</span>
        <div className="max-w-lg space-y-3">
          <SkeletonLine className="h-8 w-2/3" />
          <SkeletonLine className="w-1/2" />
        </div>
        <section className="mt-7 rounded-lg border border-stone-200 bg-white p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-[8rem_1fr] sm:items-center">
            <div aria-hidden className="size-24 rounded-full bg-stone-200" />
            <div className="space-y-4">
              <SkeletonLine className="w-full" />
              <SkeletonLine className="w-4/5" />
              <SkeletonLine className="w-3/5" />
            </div>
          </div>
        </section>
        <section className="mt-5 space-y-4 rounded-lg border border-stone-200 bg-white p-5 sm:p-6">
          <SkeletonLine className="h-5 w-1/3" />
          {["w-5/6", "w-3/4", "w-4/5"].map((width) => (
            <div className="flex items-center gap-4 border-t border-stone-100 pt-4" key={width}>
              <div aria-hidden className="size-9 shrink-0 rounded-full bg-stone-200" />
              <SkeletonLine className={width} />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
