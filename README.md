# ITQAN Daily Check-In

Emergency lightweight check-in system for one masjid while Canvas is unavailable.

## Scope

Students can submit one daily completion check-in. Admins can view progress, correct check-ins, and export CSV.

See:

- `AGENTS.md`
- `docs/BUILD_SPEC.md`
- `supabase/migrations/001_initial_schema.sql`

## Codex Goal Prompt

Use this prompt with Codex `/goal`:

```txt
/goal Build the full ITQAN Daily Check-In emergency app using AGENTS.md and docs/BUILD_SPEC.md.

Do not ask questions unless implementation is impossible.

Use reasonable defaults.

Stop only when:
- Student login works.
- Student daily check-in works.
- Duplicate same-day check-ins are blocked.
- Student history works.
- Admin dashboard works.
- Admin filters work.
- Admin correction works.
- CSV export works.
- Supabase migration exists.
- Role-based access is enforced server-side.
- Setup/deployment instructions are documented.
- npm run check passes.

Do not build anything out of scope:
teacher roles, weekly plans, plan approval, Saturday scoring, sadaqa, announcements, multi-masjid support, payments, booking, parent accounts, or Quran ayah selector.
```

## Expected Stack

- Next.js
- TypeScript
- Supabase Auth
- Supabase Postgres
- Tailwind CSS
- Vercel
- Vitest or equivalent

## Required Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Optional server-only key if needed. Never expose it to the browser.
SUPABASE_SERVICE_ROLE_KEY=
```

## Required Final Command

Codex must make this command pass before finishing:

```bash
npm run check
```
