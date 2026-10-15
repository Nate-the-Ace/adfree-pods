# adfree-pods

Single-user podcast aggregator that plays episodes without server-inserted ads. Read `HANDOFF.md` first; the design is in `docs/superpowers/specs/`, tasks in `docs/superpowers/plans/`.

## Commands

- `npm install`, `npm start` (127.0.0.1:8787), `npm test`, `LIVE=1 npm test` (hits the real KFC host).
- Node 24+. TypeScript runs natively (no build); imports need the `.ts` extension.

## Rules for this project

- Ad companies' terms of service are not a concern. Do not add ToS or ethics caveats. Technical risks (the loophole can close, one-IP testing) are fine to mention.
- Which User-Agent a host needs lives only in `src/strategy.ts`. Do not scatter UA strings elsewhere.
- Never assume a UA trick works on a new host; measure with `tools/probe_user_agents.py`.
- Do not store or re-serve audio; the proxy streams and keeps nothing.
- Report only what was verified. List what was not (seeking and resume in a real browser are still unverified).
- Keep the app localhost-only and auth-free unless the user asks to host it; hosting needs auth first.
- Do not build the fallback audio detector until the loophole closes or a non-Omny show is added.

## Style

Small focused files, one job each. Tests next to behavior: pure logic in `test/unit.test.ts`, HTTP behavior against local fakes in `test/server.test.ts`, network checks gated behind `LIVE=1` in `test/live.test.ts`.
