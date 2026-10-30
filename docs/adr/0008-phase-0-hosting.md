# Phase 0 runs on one small server plus managed services

The API, sync server, light TypeScript worker, Postgres and Redis run in Docker Compose behind Caddy on Keshav's server (1 vCPU, 3.8 GB RAM). The web app is on Vercel, files on Cloudflare R2, durable jobs on Temporal Cloud and GPU work on Modal. Every service is its own container so it can move host without code changes; server renders of large designs move to Cloudflare Containers when the server is too small. The server's address lives in deploy secrets, never in the repo.
