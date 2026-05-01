# Anoniem Chat

**Anoniem Chat** is a high-security, privacy-focused, and ephemeral group messaging platform. It is designed for users who require absolute anonymity with zero data retention and end-to-end encryption (E2EE).

![Screenshot](screenshot.png)

## Core Pillars

- **Zero Persistence:** No databases, no logs of message content, and no tracking. Everything exists only in volatile memory (RAM) and is wiped upon reload.
- **End-to-End Encryption (E2EE):** All messages are encrypted in the browser using **AES-GCM 256** before being sent to the server. The server acts as a blind relay and never has access to encryption keys or plaintext.
- **Privacy by Design:** No registration, no cookies, no analytics, and no fingerprinting.
- **Room Isolation:** Messages are scoped to 64-character Room IDs. Only users with the same Room ID and Encryption Key can communicate.

## Configuration (.env)

The application can be configured using environment variables. Create a `.env` file in the root directory to customize the following:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | The port the server listens on. | `6000` |
| `NODE_ENV` | Environment mode (`production`, `development`). | `development` |
| `LOG_LEVEL` | Logging level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`). | `info` |
| `MAX_GLOBAL_USERS` | Maximum number of concurrent users allowed on the server. | `20` |
| `MAX_USERS_PER_ROOM` | Maximum number of users allowed in a single chat room. | `20` |
| `TRUSTED_PROXY_IPS` | Comma-separated list of trusted proxy IPs for rate limiting. | `127.0.0.1, ::1` |
| `ONLINE_TOKEN` | Token required in `x-admin-token` header to see active user list via `/online`. | *None* |
| `ROOMS_TOKEN` | Token required in `x-admin-token` header for `/admin/rooms` and `/admin/messages`. | *None* |
| `ANNOUNCE_TOKEN` | Token required in `x-admin-token` header for `/admin/announce`. | *None* |

For a detailed deep-dive into the security architecture and system limits, see the [Technical Project Overview & E2EE Implementation](PROJECT_TECHNICAL_OVERVIEW.md).

## Features

- **Anonymous Identities:** No sign-up required. Choose a nickname or change it anytime.
- **Slash Commands:**
  - `/nick <newname>` — Change your display name.
  - `/who` — List active participants in the current room.
  - `/id` — Display your current username and room hash.
  - `/motd` — View the current Message of the Day.
  - `/clear` — Wipe the local chat history.
- **PWA Support:** Installable as a mobile or desktop app for a native experience.
- **Anti-Spam & Security:** Built-in rate limiting, connection throttling (IP-based), and automated strike system for abusive behavior.
- **Responsive Design:** Optimized for both mobile and desktop browsers with a clean, distraction-free UI.

## Technical Stack

- **Backend:** Node.js, Express (v5+), Socket.io.
- **Frontend:** Vanilla JS, Socket.io-client, Web Crypto API (for E2EE).
- **Logging:** Pino (structured, high-performance logging).
- **Compression:** Gzip/Brotli via Express compression middleware.

## Development & Deployment

### Prerequisites
- Node.js (Latest LTS recommended)
- `npm`

### Local Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables:
   Create a `.env` file based on the [Configuration](#configuration-env) section.
4. Start the server:
   ```bash
   # Using the start script (requires zsh)
   ./00-STARTSERVER
   
   # Or directly with node
   node server.js
   ```

### Production Notes
The server is configured to run behind a reverse proxy (like Nginx). Ensure your proxy handles SSL/TLS termination and passes the correct headers (e.g., `X-Forwarded-For`) for rate limiting to function correctly.

## License
MIT License — © 2026 mmcvuur
