# NEX DEVPOST DRAFT

## 1. What is NEX?

NEX is a web-first platform for building specialized information systems on top of a single reusable backend. The first target domain is colleges and universities, but the core is deliberately domain-free so the same foundation can serve other types of organizations.

At its heart, NEX is a **modular monolith**. A thin, domain-free kernel handles identity, authorization, tenancy, and a Commands → Events → Audit spine. Independent modules contain the actual domain logic. Applications compose these modules. AI is treated as a future first-class *actor* that uses the same authorized and audited paths as any human user.

## 2. Why did I start building this project?

I was frustrated with how educational institutions are forced to use either bloated enterprise ERPs or fragmented point solutions that don't talk to each other. Every new requirement meant either expensive customization or yet another disconnected system.

I wanted a foundation where new functionality could be added as clean, isolated modules without turning the system into an unmaintainable mess.

## 3. What problem am I trying to solve?

Most institutional systems suffer from poor auditability, weak multi-tenancy, and no clean path for AI agents to act inside the system with proper permissions and full history. Adding AI later usually means bolting it on the outside with fragile integrations.

NEX tries to solve this by making audit, authorization, and multi-tenancy first-class concerns from day one, while designing the architecture so AI can become a native participant rather than an external caller.

## 4. Why aren't existing approaches satisfying me?

Traditional monoliths are too rigid and hard to evolve. Microservices bring massive operational complexity for what is often a single organization or small group of tenants. Most existing platforms also treat AI as an external API consumer rather than an internal actor with proper identity and audit trail.

## 5. Why is AI at the center of the architecture?

Because I believe that in 3–5 years the most powerful systems will have AI agents performing real work inside them — creating tasks, approving documents, sending notifications, etc. These agents must operate under the same rules as humans: proper authentication, authorization, and complete audit history. Designing the system this way from the beginning is much cleaner than retrofitting it later.

## 6. What already works?

- Core kernel (identity, tenancy, authorization, command/event/audit)
- Session-based authentication with httpOnly cookies
- Multi-tenant data isolation using PostgreSQL RLS
- Tasks module with full CRUD, bulk operations, and history
- Embedded migrations and sqlc-generated queries
- Structured logging and observability hooks
- ai-gateway service ready for controlled AI access

## 7. What is still a prototype?

- Several planned modules (calendar, finance, documents, notifications)
- Full AI actor integration
- Advanced rule engine for automatic task creation
- Production-grade frontend (current web/ is mostly a design reference)
- Complete RBAC matrix and advanced permission system

## 8. The most complex engineering decisions

- Building a clean Commands → Events → Audit spine that all modules must use
- Tenant isolation at the database level while keeping queries ergonomic
- Treating AI as just another authenticated actor rather than a special case
- Designing module boundaries so they remain independent yet can react to each other's events

## 9. Why is OpenAI used in this specific way?

OpenAI (via the ai-gateway) is intentionally placed **outside** the kernel but inside the actor model. The gateway handles rate limiting, prompt management, and safety, while the actual actions the AI wants to perform go through the normal authenticated API with full audit logging. This keeps the core clean and makes AI behavior observable and controllable.

## 10. What do I want to get from the OpenAI Hackathon?

I want recognition for an architecture that treats AI agents as first-class citizens with proper identity and audit, rather than just another API integration. Ideally — feedback, connections, and possibly support to continue building the platform.

## 11. Roadmap

- Q3 2026: Complete core modules (calendar, documents, notifications)
- Q4 2026: Production-ready RBAC + AI actor foundation
- 2027: First real deployments in educational institutions
- Ongoing: Expand module ecosystem while keeping the kernel stable

## 12. Demo scenario

A university administrator creates a recurring task template for "monthly scholarship report". An AI agent (authenticated via ai-gateway) detects that several students have low attendance and automatically creates tasks for tutors using the template. All actions are recorded in the audit log with the AI clearly shown as the actor. The tutor receives the task through normal channels and can see the full history of why it was created.