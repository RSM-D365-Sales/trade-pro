# Dependency advisory notes

`npm audit` reports **2 moderate** advisories against `react-router` /
`react-router-dom` 6.30.4. They are accepted, not ignored. This note records why,
so the next person does not re-litigate it.

## Why not just upgrade

There is no version of react-router that `npm audit` considers clean:

| Version | `npm audit` result |
|---|---|
| 6.30.4 (current) | 2 **moderate** — open redirect via `<Link>`/`useNavigate`, SSR hydration `deserializeErrors` |
| 7.11.0 | 2 **high** |
| 7.18.2 (latest) | 2 **high** — RSC-mode CSRF bypass |

Upgrading trades two moderates for two highs. The advisory ranges overlap every
published release, so "upgrade until clean" has no terminating state here.

## Why neither advisory is exploitable in this app

Both require conditions this application does not have:

- **Open redirect via `<Link>` / `useNavigate`.** Requires a
  navigation target derived from untrusted input. Every route target in this app
  is either a hard-coded path or an id from the local seeded dataset — see
  `src/pages/` and `src/components/AppShell.tsx`. No URL ever originates from
  user input, query strings, or a network response.
- **SSR hydration / `deserializeErrors`, and RSC-mode CSRF.** Both require a
  server. This is a static client-only SPA on GitHub Pages: no SSR, no React
  Server Components, no server actions, no backend of any kind. There is no
  request for a CSRF bypass to act on and no hydration payload to poison.

There is also no authentication, no session, and no user data in the app — the
entire dataset is generated in the browser at load time.

## What was fixed

The originally-reported **critical** and **high** advisories were in dev-only
tooling (`vitest`, `vite`, `esbuild`, `vite-node`, `@vitest/mocker`) — code that
runs on a developer machine and in CI, never in the shipped bundle. Those were
cleared by moving to `vitest@^4`.

## Re-check this if

- The app gains a backend, auth, or SSR.
- Any navigation target starts coming from user input or an API response.
- react-router publishes a release with no open advisories — then upgrade and
  delete this file.
