# UI notes
1. Routes: `/` switcher, `/dashboard`, `/work-orders/[id]`, `/m/[contractorId]`.
2. `?fixture=1` uses `/fixtures` and browser localStorage; `?fixture=0` calls PLAN.md API endpoints.
3. `components/dashboard-client.tsx`: property switcher, three stats, request modal, ledger.
4. `components/ledger-grid.tsx`: AG Grid Quartz, manual community grouping/full-width detail rows.
5. `components/new-request-dialog.tsx`: structured Dispatcher output and inline criterion edits.
6. `components/work-order-client.tsx`: chronological PM story and escalation actions.
7. `components/money-rail.tsx`, `verdict-card.tsx`, `proof-strip.tsx`: payment + evidence focus.
8. `components/mobile-client.tsx`: contractor jobs, check-in, native uploads, paid screen.
9. `lib/api.ts`: PLAN.md routes; `app/api` contains `TODO(api)` fixture stubs; localStorage sync polls 1.3s and API ledger polls every 3s.
