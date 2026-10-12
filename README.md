# Beacon

<p align="center">
  <img src="public/beacon-logo.svg" alt="Beacon Logo" width="220" />
</p>

A high-performance infrastructure and uptime telemetry platform built with Next.js 16, React 19, Prisma ORM, BullMQ, Redis, and Tailwind CSS.

## Features

- **Multi-protocol Monitoring**: HTTP/HTTPS, Ping (ICMP), TCP port checks, and Keyword verification.
- **Incident Lifecycle Management**: Automatic retry / verification before declaring downtime, incident logging, and auto-resolution upon recovery.
- **Background Job Queue**: High-throughput distributed task scheduling with BullMQ and Redis.
- **Real-Time Dashboard**: Interactive status cards, response-time latency graphs, uptime percentages, and quick pause/resume/delete actions.

---

## Architecture Overview

1. **Web Dashboard & API (`src/`)**: Next.js App Router for the user interface and REST API endpoints (`/api/monitors`).
2. **Database (`prisma/schema.prisma`)**: PostgreSQL with Prisma ORM storing organizations, monitors, incidents, and ping metrics.
3. **Scheduler Service (`scripts/scheduler.ts`)**: Cron runner scheduling periodic monitor checks into Redis queues.
4. **Worker Service (`scripts/worker.ts`)**: BullMQ worker processing checks, measuring latency, recording metrics, and triggering alerts.

---

## Getting Started

### 1. Prerequisites
- **Node.js** (v18+)
- **PostgreSQL** (running locally or remotely)
- **Redis** (running locally or remotely)

### 2. Environment Variables
Copy `.env.example` to `.env` and configure your credentials:
```bash
cp .env.example .env
```

Ensure your `.env` contains:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/beacon?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Database Setup
Push the Prisma schema to your database:
```bash
npm run db:push
```

### 5. Running the Application

You can run the web interface, the background scheduler, and the worker poller concurrently:

- **Web Dashboard**:
  ```bash
  npm run dev
  ```
  Visit [http://localhost:3000](http://localhost:3000)

- **Worker Service**:
  ```bash
  npm run worker
  ```

- **Scheduler Service**:
  ```bash
  npm run scheduler
  ```

---

## Available Scripts

| Script | Command | Description |
|---|---|---|
| `npm run dev` | `next dev` | Start Next.js development server |
| `npm run build` | `next build` | Build optimized production bundle |
| `npm run start` | `next start` | Start production Next.js server |
| `npm run db:push` | `prisma db push` | Push schema changes to database |
| `npm run worker` | `tsx scripts/worker.ts` | Start BullMQ check worker |
| `npm run scheduler` | `tsx scripts/scheduler.ts` | Start periodic check scheduler |
