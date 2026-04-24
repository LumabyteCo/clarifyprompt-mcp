---
name: nextjs-14-best-practices
version: 1.0.0
description: Opinions for Next.js 14 App Router projects. Server-first, strict typing, minimal client JS.
scope: user
author: LumabyteCo
license: Apache-2.0
tags: [nextjs, react, typescript, app-router]
---

# Next.js 14 Best Practices

## Server-first by default
Prefer Server Components for every new component. Opt in to `"use client"` only when the component needs browser-only APIs (state, effects, event handlers, storage). The default reduces shipped JS and improves Core Web Vitals.

## Data fetching
Fetch inside Server Components with `async` + `await`. Do not use `getServerSideProps`, `getStaticProps`, or SWR for initial data in the App Router. Use React's `cache()` helper or Next's `fetch` extensions (`{ cache: 'force-cache' | 'no-store', next: { revalidate: N, tags: [...] } }`) for request-level and revalidation control. Prefer tag-based revalidation (`revalidateTag`) over time-based when possible.

## Route handlers
Prefer Server Actions over API route handlers for form mutations from within the app. Route handlers (`app/**/route.ts`) are for third-party callers, webhooks, and public JSON endpoints. Server Actions must begin with `"use server"`.

## Metadata
Always export `generateMetadata()` (not static `metadata`) for dynamic pages so Open Graph / Twitter cards reflect the actual resource. Set `metadataBase` at the root layout so relative OG image URLs resolve correctly.

## TypeScript conventions
Enable `"strict": true` and `"noUncheckedIndexedAccess": true` in `tsconfig.json`. Prefer `type` over `interface` for public shapes (structural intent); use `interface` only for libraries that need declaration merging. Always type Server Action signatures; prefer `FormData` parameters over untyped `any` arg lists.

## Client component boundaries
Push `"use client"` as deep as possible. A page with one interactive button should have one tiny client component, not a whole-page `"use client"` directive. Pass server-rendered children *through* client components via `{children}` to keep the inner subtree on the server.

## Image handling
Use `next/image` for every `<img>`. Specify `width` and `height` explicitly (no `layout="fill"` unless the container is a `position: relative` sized box). Add `priority` to above-the-fold images. Use `sizes` for responsive images so the `srcset` is meaningful.

## Styling
Tailwind CSS is the default; PostCSS is configured. Co-locate component styles; avoid global CSS except for resets + font-face. Prefer `clsx` or `cva` for variant-style composition over string concatenation.

## Forms
Use Server Actions + `useFormState` / `useFormStatus` from `react-dom`. Validate on the server with Zod; return typed error objects. Don't ship Yup + Formik for new forms.

## Error + loading boundaries
Every route segment should have `error.tsx` and `loading.tsx`. Don't leave users staring at a blank screen during navigation or a thrown error. Root `app/global-error.tsx` handles catastrophic failures.

## Authentication
Prefer a session library that stores the session server-side (NextAuth/Auth.js, Clerk, Lucia). Never leak tokens to the client in Server Components; pass only the user profile shape your UI needs. Middleware is fine for auth gating but runs on the Edge — keep it thin and stateless.

## Deployment
Next.js 14 runs natively on Vercel; for self-host, build with `next build && next start` and put it behind a reverse proxy with HTTP/2. If you use the Edge runtime, test cold starts — Node runtime is faster for warm traffic.
