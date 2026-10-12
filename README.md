# Beacon

![Beacon Logo](public/beacon-logo.svg)

A high-performance infrastructure, heartbeat, and uptime telemetry platform built with **Next.js 16** (App Router, Turbopack, Cache Components), **React 19**, **Prisma ORM**, **PostgreSQL**, **Tailwind CSS v4**, and dual execution architectures (**Serverless Cron** for zero-cost cloud deployment + **BullMQ/Redis** for distributed self-hosted clusters).

---

## Key Features

- **Multi-Protocol Telemetry**:
  - `HTTP / HTTPS`: Status codes, SSL timing, and latency measurement with redirect-safe SSRF guard.
  - `KEYWORD`: Deep payload inspection asserting required strings in response body.
  - `PING (ICMP)`: Roundtrip network reachability and packet loss verification.
  - `TCP Socket`: Direct port connectivity with strict connection deadline guards.
  - `HEARTBEAT`: Inbound push monitoring with dedicated webhook endpoints (`/api/heartbeat/:slug`).
- **Organization-Scoped Multi-Tenancy**:
  - Secure encrypted cookie sessions (`iron-session`) with Argon2/Bcrypt hashed credentials.
  - Tenant isolation preventing IDOR and cross-organization telemetry leakage.
  - Dedicated organization workspaces with role-based member associations.
- **Dual Deployment Models**:
  - **Serverless Cron (Vercel + Neon)**: Runs 24/7 with zero idle compute cost, no sleeping instances, and no Render free-tier hour burn.
  - **Self-Hosted Background Daemons (BullMQ + Redis)**: High-concurrency worker (`scripts/worker.ts`) and scheduler (`scripts/scheduler.ts`) for dedicated VM/Docker environments.
- **Enterprise Security & Reliability**:
  - Next.js 16 `proxy.ts` route protection.
  - Server-Side Request Forgery (SSRF) defense blocking private RFC1918, loopback, link-local, and cloud metadata (AWS `169.254.169.254`, GCP).
  - Rate-limiting, CSRF origin verification, and Content Security Policy (CSP) headers.
  - Automated PingResult retention window (prunes telemetry older than 7 days).

---

## Architecture Overview

```text
                                      +------------------------------------+
                                      |            Browser Client          |
                                      +-----------------+------------------+
                                                        |
                                            (proxy.ts / Session Auth)
                                                        v
                                      +------------------------------------+
                                      |        Next.js 16 App Router       |
                                      +--------+------------------+--------+
                                               |                  |
                         +---------------------+                  +--------------------+
                         v                                                             v
        +---------------------------------+                           +---------------------------------+
        |      Serverless Cron Model      |                           |    Self-Hosted Daemon Model     |
        |  (Vercel Cron /api/cron/check)  |                           |     (BullMQ Worker & Scheduler) |
        +----------------+----------------+                           +----------------+----------------+
                         |                                                             |
                         v                                                             v
        +---------------------------------+                           +---------------------------------+
        |   Neon Serverless PostgreSQL    |                           |      Redis Queue + Postgres     |
        +---------------------------------+                           +---------------------------------+
```

---

## Getting Started

### 1. Prerequisites

- **Node.js**: `>= 20.9.0` (required by Next.js 16)
- **Package Manager**: `npm` (or `pnpm`)
- **Database**: PostgreSQL (e.g., [Neon Serverless](https://neon.tech) free tier, or local Postgres)
- **Optional**: Redis (only required if running local BullMQ worker/scheduler daemons)

### 2. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set the required environment variables:

```env
# PostgreSQL connection URL
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/beacon?schema=public"

# Redis connection (optional for serverless cron; required for scripts/worker.ts)
REDIS_URL="redis://127.0.0.1:6379"

# Session encryption password (minimum 32 characters; generate via: openssl rand -base64 32)
SESSION_PASSWORD="your-secure-session-encryption-password-min-32-chars"

# Secret token protecting serverless cron endpoints
CRON_SECRET="your-secure-cron-secret-token"

# Base application URL for CSRF origin verification
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Database Setup

Push the schema to your PostgreSQL database:

```bash
npm run db:push
```

---

## Development & Deployment

### Running Locally (Next.js Dev Server)

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to create your operator account and configure monitors.

### Running Local Queue Workers (Optional)

If running self-hosted BullMQ daemons:

```bash
# Terminal 1: Check poller worker
npm run worker

# Terminal 2: Periodic interval scheduler
npm run scheduler
```

### Free 24/7 Cloud Deployment (No Screentime Burn)

To avoid Render's 15-minute sleep cycle, 750 free compute hours limitation, and 30-day PostgreSQL database deletion:

1. **Database**: Create a free PostgreSQL instance on [Neon](https://neon.tech) (0.5 GB persistent free storage, serverless connection pooling). Set `DATABASE_URL` with pooled connection.
2. **Hosting**: Deploy to [Vercel](https://vercel.com).
3. **Automated Monitoring**: The included `vercel.json` automatically schedules `/api/cron/check` every minute using Vercel Cron. Add `CRON_SECRET` and `SESSION_PASSWORD` in your Vercel Project Environment Variables.

---

## Available Scripts

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `next dev` | Start local Next.js development server with Turbopack |
| `npm run build` | `next build` | Build production Next.js application |
| `npm run start` | `next start` | Run production Next.js server |
| `npm run db:push` | `prisma db push` | Push Prisma schema directly to PostgreSQL database |
| `npm run worker` | `tsx scripts/worker.ts` | Launch BullMQ poller and alert dispatcher |
| `npm run scheduler` | `tsx scripts/scheduler.ts` | Launch interval cron check scheduler |

---

## License

MIT
