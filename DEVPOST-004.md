# NEX DEVPOST DRAFT — v004 (English)

> Working draft for a Devpost / project-pitch submission.
> Status: draft · Version: 004 · Language: English

---

## Tagline

**NEX** — a modular platform for real organizational systems where AI is a first-class actor, not a bolted-on chat widget.

---

## 1. What is NEX?

NEX is a web-first platform for building specialized information systems on a single reusable backend. The first product built on it targets colleges and universities — a modern campus operations console — but the core is deliberately domain-free so the same foundation can serve other organizations later (municipal services, clinics, logistics teams, and so on).

Architecturally, NEX is a **modular monolith**: a thin, domain-free **kernel** (identity, authorization, multi-tenancy, and a Commands → Events → Audit spine) hosts independent **modules** that contain the real business logic — finance, campus, tasks, files, notifications, terminal, and more. Concrete systems are applications that compose modules. Dependencies only ever point inward: applications depend on modules, modules depend on the kernel, and the kernel depends on nothing above it.

Unlike many “AI products” that paste an LLM onto a form and call it innovation, NEX treats AI as a **first-class system actor**. An assistant must walk the same authenticated, authorized, multi-tenant, audited paths as a human user. That design choice is not marketing language — it is encoded in how requests move from the React UI through `nexd` (Go) into the AI gateway, budgets, and providers.

---

## 2. Why NEX?

Most software built for schools and mid-size organizations is either:

- a pile of disconnected tools (spreadsheets, chatbots, legacy 1C-style modules, mail), or  
- a heavy enterprise suite that is expensive, rigid, and hostile to change.

Meanwhile the AI wave produced a flood of demos that answer questions but cannot *do* anything safely inside real workflows: no tenancy, no roles, no audit trail, no budget control, no shared source of truth.

We built NEX because we needed both sides at once:

1. a serious backend spine for multi-tenant operational systems, and  
2. AI that can live *inside* that spine — not beside it.

The first vertical is college/university operations: students, groups, journal, finance, tasks, notifications, and a command-center style home screen. The platform goal is larger: reuse the same kernel for the next domain without rewriting identity, authz, audit, or tenancy.

---

## 3. The problem

Colleges and similar organizations run on fragmented data and tribal knowledge:

| Pain | What it looks like in practice |
| --- | --- |
| Fragmented systems | Grades in one place, payments in another, tasks in chat, files in folders |
| No shared context | A curator cannot see attendance + grades + debt for one student in one click |
| Weak accountability | Who changed what, when, and under which role is often unclear |
| AI as a gimmick | Chatbots without tenant isolation, spend limits, or permission checks |
| Rebuild tax | Every new “information system” reimplements login, roles, and logs from zero |

NEX attacks the structural problem: one platform kernel, composable domain modules, and AI that operates under the same rules as everyone else.

---

## 4. What it does

### For a college (first application)

- **Campus** — groups, students, academic journal context  
- **Finance** — double-entry ledger style operations and reporting hooks  
- **Tasks** — assignable work with notifications  
- **Files** — attachment metadata with content-addressable blob storage  
- **Notifications** — in-app feed for system and domain events  
- **Home / command center** — day brief, shortcuts, risk signals, object drawers  
- **Terminal / admin console** — operational control surface for admins  
- **AI assist** — page-aware mini-chat and ask flows that understand *where* the user is and *which facts* are on screen  

### For the platform (what reuses)

- Multi-tenant isolation (tenant context + PostgreSQL RLS)  
- Session auth (argon2id passwords, httpOnly sessions, rate-limited login, audit)  
- RBAC enforcement on the command bus (not only in HTTP handlers)  
- Append-only audit of meaningful changes  
- OpenAPI contract, problem+json errors, idempotency patterns  
- Observability: structured logs, request IDs, Prometheus metrics  
- AI gateway with provider routing, tenant budgets, rate limits, and secret isolation  

---

## 5. How we built it

NEX is implemented as a small monorepo with clear process boundaries:

| Layer | Tech | Role |
| --- | --- | --- |
| **Backend (`nexd`)** | Go, `net/http`, pgx, sqlc, goose | Modular monolith: kernel + modules + HTTP API |
| **Database** | PostgreSQL 16/17 | Source of truth, RLS multi-tenancy, migrations embedded in binary |
| **Frontend (`web/`)** | React, TypeScript, Vite, Tailwind | Product UI / campus console prototype evolving into a full client |
| **AI gateway** | Python, FastAPI | LLM provider adapter: budgets, limits, context registry, multi-provider |
| **Infra** | Docker Compose, Caddy, GitHub Actions → GHCR | Local stack, prod-shaped deploy path, image releases by tag |

### Design rules we actually follow

1. **One write path** — domain mutations go through the command bus with authz + audit.  
2. **Dependencies point inward** — modules do not import each other; kernel imports nothing above it.  
3. **Browser never holds provider keys** — UI talks only to `nexd`; `nexd` authenticates and proxies AI; the gateway holds secrets.  
4. **Tenant identity is server-derived** — not trusted from the client body or free-form headers.  
5. **Boring tech where it matters** — SQL, explicit modules, OpenAPI, Prometheus — not a zoo of frameworks.

Learning materials (`docs/learn/`, `beta/FrankAI`, `beta/Nex-pilot`) sit next to production code so the project is both a system and a teachable stack.

---

## 6. Architecture (one picture in words)

```
Browser (React SPA)
    │  cookie session, same API origin (or CORS-configured)
    ▼
nexd (Go modular monolith)
    ├── kernel: identity · authz · tenancy · command/event/audit
    ├── modules: finance · campus · tasks · files · notifications · terminal
    ├── platform: httpapi · postgres/RLS · blob · cache · outbox · metrics
    └── AI proxy: /api/v1/ai/*  →  authenticated + tenant-stamped
            ▼
      ai-gateway (Python)
            ├── rate limit · tenant budget · context/system prompt
            └── providers: Gemini / OpenAI-compatible / GigaChat / YandexGPT / …
```

AI is not a special side door. It is another capability behind the same front door.

---

## 7. Why “AI as an actor” matters

If an assistant can read student data or trigger side effects, it must be subject to:

- **authentication** — who is asking  
- **authorization** — what that role may see or do  
- **tenancy** — which organization boundary applies  
- **audit** — what was requested and what changed  
- **budget / rate limits** — how much spend and load is allowed  

NEX’s current path enforces this at the boundary: the frontend never calls providers or the gateway directly; `nexd` injects the trusted tenant from the session; the gateway verifies a shared secret and applies budget/rate policy. The longer-term roadmap keeps AI on the same command/event spine so agentic actions stay reviewable and revocable.

We also explore a teaching track (`FrankAI` + `Nex-pilot`) — a tiny own-model path — so “AI inside NEX” is not only API glue, but an engineering story people can learn from.

---

## 8. Challenges we ran into

- **Prototype vs architecture** — an early visual “college IS” UI existed before the Go kernel matured; we had to keep it as design reference without letting it define the backend.  
- **Safe AI integration** — early paths that trusted client-supplied tenant headers or browser-side keys were identified and redesigned.  
- **Modular monolith discipline** — resisting both “everything in handlers” and premature microservices.  
- **Multi-tenant correctness** — RLS + tenant context must be proven with negative tests, not only happy paths.  
- **Scope control** — building a platform *and* a first vertical product without freezing either.  
- **Ops realism** — metrics, releases to GHCR, and compose stacks arrived earlier than full staging automation and backup drills.

---

## 9. Accomplishments we’re proud of

- A working **kernel spine**: identity, sessions, RBAC, tenancy, commands, events, audit  
- Real **domain modules** beyond a hello-world CRUD: finance (double-entry), campus, tasks, files, notifications, terminal  
- An **AI path** that keeps secrets and tenant identity server-side, with budgets and multi-provider routing  
- **OpenAPI + problem+json** as the public contract surface  
- **Observability basics**: structured logs, request IDs across services, Prometheus `/metrics`  
- **Docs that teach**: architecture guides, ADRs, module-writing guide, learn track  
- A **reproducible stack**: `make stack` / Compose for Postgres + nexd + web + ai-gateway  

---

## 10. What we learned

- AI features collapse without platform primitives (authz, tenancy, audit, budgets).  
- A modular monolith is a product strategy, not only a code layout: it decides how fast the next domain can ship.  
- Frontend polish without a write-path discipline creates demos, not systems.  
- Treating documentation and learning materials as part of the product makes the codebase navigable for new contributors.  
- “Provider choice” is a gateway concern; “who may ask what” is a kernel concern — mixing them is how leaks happen.

---

## 11. What’s next

Near term:

- Harden the first college vertical end-to-end (fewer mock screens, more live API surfaces)  
- Continue frontend modernization against the OpenAPI contract  
- Staging deploy automation, backups, and restore drills  
- Deeper observability (dashboards, alerts, fuller tracing)  

Platform direction:

- Additional domain modules (schedule, grading depth, admissions flows)  
- AI actions through the same command bus (agent as actor in full)  
- Optional OIDC federation, stronger search, export packs  
- Pilot with a real institution once security checklist and ops path are closed  

---

## 12. Built with

**Backend:** Go · PostgreSQL · pgx · sqlc · goose · argon2id sessions · OpenAPI  

**Frontend:** React · TypeScript · Vite · Tailwind CSS · (design system evolving toward TanStack + shadcn patterns)  

**AI:** Python FastAPI gateway · multi-provider adapters · tenant budgets · rate limits · context registry  

**Ops / quality:** Docker Compose · Caddy · Prometheus metrics · GitHub Actions · GHCR images · race-tested Go suites · Vitest  

---

## 13. Try it / links

| Resource | Notes |
| --- | --- |
| Repository | This monorepo (`betaNEX`) — backend, web, ai-gateway, docs |
| Quick start | `make stack` (Docker) or `make dev` + `make run` (from source) |
| Health | `GET /healthz` on `nexd` |
| Learn path | `docs/learn/README.md` |
| Architecture | `docs/architecture-go.md`, `docs/ai/README.md`, `docs/decision-log.md` |

*(Add live demo URL, video, and screenshots before final Devpost submit.)*

---

## 14. Elevator pitch (30 seconds)

NEX is a reusable backbone for organizational information systems. We started with colleges: one multi-tenant backend, modular domains, and a campus UI. The twist is architectural — AI is not a separate toy; it is forced through the same auth, tenancy, budgets, and audit model as every other actor. Build once on the kernel; compose the next system without redoing the hard parts.

---

## 15. Submission checklist (before publish)

- [ ] Final tagline (≤ 120 characters for Devpost)  
- [ ] 3–6 screenshots (home, student drawer, finance, tasks, AI assist)  
- [ ] Demo video (2–3 min): problem → walkthrough → architecture beat → what’s next  
- [ ] Public demo or recorded walkthrough link  
- [ ] Team roles / credits  
- [ ] License and contribution note  
- [ ] Align RU/EN versions if both are published  

---

*End of DEVPOST draft v004 (EN).*
