import type { Metadata } from "next";
import { Noto_Naskh_Arabic } from "next/font/google";
import { Diamond } from "@phosphor-icons/react/dist/ssr";
import LoginForm from "@/app/login/login-form";
import { SESSION_EXPIRED_STATUS } from "@/lib/session-recovery";

const ayahFont = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  weight: "400",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Sign in | ITQAN",
  description: "Sign in to the ITQAN halaqa system."
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-col bg-paper lg:grid lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
      <section className="flex h-[22rem] min-w-0 flex-col bg-[#23362c] px-6 py-7 text-white sm:h-[23.5rem] sm:px-10 sm:py-9 lg:h-auto lg:min-h-dvh lg:px-[clamp(3.5rem,5vw,5rem)] lg:py-[clamp(4.75rem,9vh,6rem)]">
        <p className="text-2xl font-semibold uppercase tracking-[0.16em] text-[#d2aa5f] lg:text-[2.375rem]">
          ITQAN
        </p>

        <blockquote className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center pb-2 pt-4 text-center sm:pt-5 lg:pb-10 lg:pt-10">
          <p
            className={`${ayahFont.className} text-[clamp(2.5rem,11.25vw,2.75rem)] leading-[1.55] text-white sm:text-[3.5rem] lg:text-[clamp(3rem,5vw,4rem)] lg:leading-[1.6] xl:text-[clamp(4.5rem,5.15vw,5.35rem)]`}
            dir="rtl"
            lang="ar"
          >
            وَرَتِّلِ ٱلْقُرْءَانَ تَرْتِيلًا
          </p>

          <div
            aria-hidden="true"
            className="my-4 flex w-44 items-center text-[#d2aa5f] sm:my-5 sm:w-48 lg:my-7 lg:w-full lg:max-w-[21rem]"
          >
            <span className="h-px flex-1 bg-current opacity-65" />
            <Diamond aria-hidden="true" className="mx-2.5" size={18} weight="regular" />
            <span className="h-px flex-1 bg-current opacity-65" />
          </div>

          <p className="max-w-xl text-[0.9375rem] leading-relaxed text-stone-100 sm:text-lg lg:text-[0.9375rem] xl:text-xl">
            And recite the Quran properly in a measured way.
          </p>
          <cite className="mt-3 not-italic text-sm font-medium text-[#d2aa5f] sm:mt-5 sm:text-base lg:mt-8 lg:text-lg">
            Qur’an 73:4
          </cite>
        </blockquote>
      </section>

      <section className="flex min-w-0 flex-1 items-center justify-center bg-paper px-6 pb-8 pt-10 sm:px-10 sm:pb-10 sm:pt-12 lg:min-h-dvh lg:px-[clamp(3rem,7vw,7rem)] lg:py-16">
        <div className="w-full max-w-xl">
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl lg:text-[3.5rem]">
            Sign in
          </h1>

          {status === SESSION_EXPIRED_STATUS ? (
            <p className="mt-6 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
              Your previous session expired. Sign in again to continue.
            </p>
          ) : null}

          <div className="mt-8 lg:mt-7">
            <LoginForm />
          </div>
        </div>
      </section>
    </main>
  );
}
