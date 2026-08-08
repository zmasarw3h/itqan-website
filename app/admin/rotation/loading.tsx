export default function RotationLoading() {
  return <main aria-busy="true" aria-label="Loading weekly rotation" className="mx-auto max-w-[1440px] animate-pulse px-4 py-6 sm:px-8 lg:px-12">
    <div className="h-4 w-48 rounded bg-stone-200" /><div className="mt-3 h-9 w-72 rounded bg-stone-200" />
    <div className="mt-8 h-20 rounded-lg bg-stone-200" /><div className="mt-5 h-[32rem] rounded-lg bg-stone-100" />
  </main>;
}
