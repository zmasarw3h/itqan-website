"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- The global fallback must keep navigation independent of the failed application shell. */

import { useEffect, useRef, useState } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [isRetrying, setIsRetrying] = useState(false);
  const retryTimeout = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(retryTimeout.current);
  }, []);

  function retry() {
    if (isRetrying) return;

    setIsRetrying(true);
    retryTimeout.current = window.setTimeout(() => setIsRetrying(false), 1500);
    reset();
  }

  return (
    <html lang="en">
      <body>
        <main aria-describedby="global-error-description" aria-labelledby="global-error-title" aria-live={error ? "assertive" : "polite"} role="alert">
          <section>
            <p>ITQAN</p>
            <h1 id="global-error-title">This page could not be loaded</h1>
            <p id="global-error-description">
              Please try again. If the problem continues, return to your dashboard.
            </p>
            <button disabled={isRetrying} onClick={retry} type="button">
              {isRetrying ? "Trying again…" : "Try again"}
            </button>
            <a href="/">Return to home</a>
          </section>
        </main>
        <style>{`
          :root { color-scheme: light; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #f8f7f2; color: #17211d; font-family: Arial, sans-serif; }
          main { display: flex; min-height: 100dvh; width: 100%; overflow-x: hidden; padding: 2rem 1rem; }
          section { width: 100%; max-width: 34rem; margin: auto; border: 1px solid #d6d3d1; border-radius: 0.75rem; background: #ffffff; padding: 1.5rem; box-shadow: 0 1px 2px rgb(0 0 0 / 8%); }
          p { margin: 0; line-height: 1.5; }
          section > p:first-child { color: #b8862d; font-size: 0.875rem; font-weight: 700; letter-spacing: 0.14em; }
          h1 { margin: 1rem 0 0; font-size: 1.5rem; line-height: 1.2; }
          #global-error-description { margin-top: 0.75rem; color: #57534e; }
          button, a { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; border-radius: 0.375rem; font: inherit; font-weight: 700; padding: 0.625rem 1.25rem; }
          button { margin-top: 1.5rem; border: 0; background: #315747; color: #ffffff; cursor: pointer; }
          button:hover { background: #17211d; }
          button:disabled { background: #78716c; cursor: not-allowed; }
          a { margin: 0.75rem 0 0 0.75rem; border: 1px solid #a8a29e; color: #17211d; text-decoration: none; }
          a:hover { background: #f5f5f4; }
          button:focus-visible, a:focus-visible { outline: 2px solid #315747; outline-offset: 3px; }
          @media (max-width: 399px) { a { margin-left: 0; } }
          @media (min-width: 640px) { main { padding: 3rem 1.5rem; } section { padding: 2rem; } h1 { font-size: 1.875rem; } }
        `}</style>
      </body>
    </html>
  );
}
