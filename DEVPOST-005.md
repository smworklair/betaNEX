# NEX DEVPOST DRAFT — v005

> Working draft for the Devpost / project-pitch submission.
> Status: draft · Version: 005 · Language: English

---

## 1. What is NEX?

NEX is a web-first modular platform designed to build specialized organizational systems on top of a single, highly reusable backend. While the initial vertical targets colleges and universities—offering a modern campus operations console—the core kernel is deliberately domain-agnostic. This means the same foundation can be easily adapted to power other organizations, such as municipal services, clinics, or logistics teams.

Architecturally, NEX is structured as a **modular monolith**. A thin, domain-free **kernel** manages core concerns (identity, sessions, multi-tenancy via PostgreSQL RLS, RBAC, and a Commands → Events → Audit spine). This kernel hosts independent, pluggable business **modules**—such as Finance, Campus, Tasks, Files, Notifications, and Terminal. Applications are built by composing these modules, keeping dependencies strictly inward-pointing: applications depend on modules, modules depend on the kernel, and the kernel has zero external local dependencies.

Unlike typical "AI products" that simply slap an LLM chat widget onto a web form, NEX treats AI as a **first-class system actor**. In our architecture, an AI assistant is subject to the exact same authentication, authorization, multi-tenant isolation, and audit trail requirements as any human operator. This design principle ensures that LLM integrations are secure, predictable, and enterprise-ready.

---

## 2. Why did I start this project?

I started NEX because I was frustrated with the state of software in educational institutions and mid-size organizations. Most of the software they rely on is either a fragmented collection of disconnected tools (spreadsheets, messy group chats, legacy databases) or heavy, rigid enterprise systems that are prohibitively expensive and hostile to change.

When the generative AI wave arrived, it promised a revolution, but mostly resulted in flashy chat widgets and isolated wrappers. These "wrappers" might answer general questions, but they cannot perform real-world, secure operations within a business workflow. They lack tenant isolation, roles, auditing, and cost controls. 

I set out to build a platform that bridges this gap—combining a rigorous, secure, multi-tenant backend spine with an AI companion that lives *inside* the system, respecting all organizational boundaries rather than bypassing them.

---

## 3. What problem am I trying to solve?

NEX attacks the structural chaos found in most modern organizations:

*   **Fragmented Systems & Data Silos:** Grades, payments, task tracking, and files are scattered across different programs, forcing staff to constantly context-switch.
*   **No Unified Context:** A college curator or coordinator cannot see a student's grades, financial ledger, pending tasks, and documents in a single click.
*   **Weak Accountability:** In legacy systems, it is often impossible to tell who changed what, when, and under which role.
*   **Insecure AI Integrations:** Many AI tools ignore multi-tenancy, risk data leaks across boundaries, and lack API spend/rate controls.
*   **The "Rebuild Tax":** Developers building new organizational tools are forced to reimplement authentication, role management, tenancy, and audit logging from scratch.

---

## 4. Why do existing approaches not satisfy me?

Existing solutions fall into two unsatisfying categories:

1.  **Legacy ERPs and Enterprise Suites (e.g., 1C, heavy SAP-like systems):** These are massive, closed-source, extremely expensive, and difficult to customize. They are designed for yesterday's workflows and are highly resistant to modern developer practices and API integrations.
2.  **Point Solutions & No-Code/Low-Code Apps:** While easy to spin up, they quickly become unmaintainable. They store data in fragmented SaaS silos, lack a unified security model, and fail to scale.
3.  **Bolted-On AI Widgets:** Modern systems trying to adopt AI usually just embed a side-chat that has no deep understanding of the database context or permissions. It either does nothing useful because it has no access, or it has too much access and poses a severe security/leakage risk.

---

## 5. Why is AI at the center of the architecture?

In NEX, AI is not a separate feature; it is woven directly into the core architecture. We refer to this as **AI as a first-class actor**:

*   **Boundary Enforcement:** The frontend never communicates with LLM providers directly. All AI requests must go through the Go backend (`nexd`), which injects the authenticated user's session and verified tenant ID.
*   **The AI Gateway:** A dedicated Python FastAPI service acts as an intelligent intermediary. It holds all provider secrets (OpenAI, Gemini, etc.), routes requests, and strictly enforces tenant-specific budgets and rate limits (preventing "denial-of-wallet" attacks).
*   **Context Registry:** The UI registers what the user is currently viewing (e.g., a specific student card or invoice). When the AI assist panel is opened, the backend merges this verified context into the prompt. The AI answers queries based *only* on the data the current user is authorized to see, enforced by PostgreSQL Row-Level Security (RLS).

---

## 6. What is currently working?

NEX is already a functional, Docker-ready monorepo with the following working components:

*   **The Go Kernel (`nexd`):** Handles secure sessions (argon2id), RBAC, Postgres RLS multi-tenancy, and a robust Command Bus where all mutations are validated, executed, and recorded in an append-only audit trail.
*   **Domain Modules:**
    *   *Campus:* Student registry, academic groups, and journal context.
    *   *Finance:* A double-entry ledger-style system with accounts, entries, and transaction safety.
    *   *Tasks:* Task assignment, status tracking, and notification hooks.
    *   *Files:* Content-addressable storage metadata linked to system entities.
    *   *Terminal:* An in-app, interactive CLI for administrators.
*   **The AI Gateway:** Written in Python/FastAPI, supporting multi-provider routing (OpenAI, Gemini, GigaChat, YandexGPT), tenant budgets, rate limiting, and a secure context registry.
*   **React Frontend:** A modern, responsive workspace UI featuring a page-aware AI side-drawer that provides contextual help based on the active view.

---

## 7. What is currently a prototype?

While the core is solid, certain features are currently in prototype or active development:

*   **Autonomous AI Actions:** The AI can currently read, analyze, and assist with data, but autonomous execution of write commands (e.g., "AI, transfer $500 from tuition to library account") is mocked or restricted to safe sandbox environments.
*   **Advanced Analytics & Reporting:** The Finance and Campus modules have fully functional data pipelines, but high-fidelity visualization dashboards are still under construction.
*   **Deep Learning Tracks:** Sibling experimental directories (`FrankAI` and `Nex-pilot`) represent exploratory prototypes for running lightweight, local LLMs to replace external API dependencies entirely in offline scenarios.

---

## 8. Most challenging engineering decisions

*   **Postgres Row-Level Security (RLS) under a Connection Pool:** Ensuring that a single Go backend connection pool can safely serve multiple tenants without cross-talk required a rigorous design. We set the tenant context dynamically inside a transaction before running queries, backed by exhaustive integration tests.
*   **The Command/Event Spine:** Forcing all system mutations to pass through a unified Command Bus. This decoupled our HTTP layer from our business logic, ensuring that whether a command is triggered by a web user, a CLI admin, or eventually an AI agent, it goes through the exact same validation, authorization, and audit logging.
*   **Budgeting at the AI Gateway Level:** Building a low-latency budget tracking system in the FastAPI gateway using Redis to prevent runaway LLM usage by a single compromised or runaway tenant account.

---

## 9. Why OpenAI is used in this specific way?

We leverage OpenAI's powerful models through our FastAPI AI Gateway for key reasons:

*   **Abstracted Security:** The client browser never holds an OpenAI API key. The gateway manages all credentials in a secure environment.
*   **Budget Control:** By routing OpenAI calls through our gateway, we can inspect, estimate, and deduct token costs in real-time from a tenant's pre-allocated budget.
*   **System Prompt Hardening:** Instead of trusting the frontend to supply system prompts, the gateway dynamically injects the system prompt and contextual data. This protects against prompt injection attacks and ensures the AI adheres strictly to its operational boundaries.
*   **Fallback and Hybrid Routing:** OpenAI serves as our high-capability primary model, but the gateway can seamlessly fall back to other providers (or local models) if limits are breached or offline capability is required.

---

## 10. What do I want to get from the OpenAI Hackathon?

*   **Architectural Validation:** To get feedback on our "AI as a first-class actor" paradigm from OpenAI's engineers and industry veterans.
*   **Agentic Best Practices:** Learn how to safely implement structured outputs, function calling, and assistant loops to transition our AI from a "read-only helper" to a safe, command-executing system actor.
*   **Community & Scale:** Find collaborators, open-source contributors, and progressive educational institutions or organizations interested in trialing our pilot.
*   **Platform Exposure:** Showcase how a modern, structured Go + Python backend can host AI safely in an enterprise environment.

---

## 11. Roadmap

*   **Q3 2026 — Visual & API Alignment:** Complete the migration of all remaining frontend visual pages to bind directly to the Go OpenAPI backend, eliminating all static mocks.
*   **Q4 2026 — Secure Agent Loops:** Implement the "human-in-the-loop" approval queue, allowing the AI assistant to draft commands (such as creating tasks or posting financial transactions) that humans can review and execute with a single click.
*   **Q1 2027 — Enterprise Modules:** Build out class scheduling (using constraint solvers), advanced grading models, and student/parent portals.
*   **Q2 2027 — Production Pilot:** Launch a full-scale pilot deployment at an actual technical college or vocational school, followed by a security audit.

---

## 12. Demo Scenario

Our interactive demo showcases NEX's multi-tenant, context-aware architecture in action:

1.  **Strict Multi-Tenant Isolation:**
    *   We log in as *Admin A* of "Tech College" and view a list of students.
    *   We attempt to access a student's record from "Business School" (Tenant B) using their ID via the URL or API. Row-Level Security blocks the request, returning a structured `problem+json` access-denied error.
2.  **The Double-Entry Ledger:**
    *   We navigate to the **Finance** panel.
    *   We trigger a tuition payment. The system validates the entry, updates the double-entry accounts, and registers the mutation on the Command Bus, creating an immutable audit log entry.
3.  **Context-Aware AI Assistant (OpenAI-powered):**
    *   We open **Alice's** student profile.
    *   We open the side AI panel. Because the UI has registered Alice as the current context, the AI automatically knows her academic record, outstanding tasks, and financial balance.
    *   We ask: *"What is her financial standing and what does she need to do next?"*
    *   The AI, powered by OpenAI, synthesizes her ledger and pending tasks to answer: *"Alice owes $200 for tuition and has an outstanding assignment 'Math Homework' due in 2 days."*
4.  **Admin Terminal:**
    *   We pull up the in-app terminal and run `help` and `finance stats` to show how administrators can control the platform via CLI, showcasing the flexibility of our unified Go core.
