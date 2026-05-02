# Anoniem Chat

**Anoniem Chat** is a high-security, privacy-focused, and ephemeral group messaging platform. It is designed for users who require absolute anonymity with zero data retention and end-to-end encryption (E2EE).

![Screenshot](screenshot.png)

## Core Pillars

- **Zero Persistence:** No databases, no logs of message content, and no tracking. Everything exists only in volatile memory (RAM) and is wiped upon reload.
- **End-to-End Encryption (E2EE):** All messages are encrypted in the browser using **AES-GCM 256** before being sent to the server. The server acts as a blind relay and never has access to encryption keys or plaintext.
- **Privacy by Design:** No registration, no cookies, no analytics, and no fingerprinting.
- **Room Isolation:** Messages are scoped to 64-character Room IDs. Only users with the same Room ID and Encryption Key can communicate.

## How it Works

1.  **Enter a Username:** This is your temporary handle in the room.
2.  **Enter or Generate a Room Key:** This key is used to both identify the chat room (via a SHA-256 hash) and to encrypt/decrypt messages.
3.  **Share the Key:** Only users who have the exact same Room Key will land in the same room and be able to read your messages.
4.  **Chat Privately:** Your messages are encrypted with AES-GCM 256 before leaving your browser. The server only sees encrypted gibberish.

## System Limits

To ensure stability and prevent abuse, the following limits are enforced:
- **Global Capacity:** Max 20 concurrent users server-wide.
- **Room Capacity:** Max 20 concurrent users per room.
- **Connections:** Max 3 concurrent WebSocket connections per IP.
- **Messages:** Max 2048 characters per message.
- **Rate Limiting:** Adaptive throttling with an automated strike system for spam.

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
  - `/me <action>` — Perform an action (e.g., `/me is drinking coffee`).
  - `/who` — List active participants in the current room.
  - `/id` — Display your current username and room hash.
  - `/motd` — View the current Message of the Day.
  - `/help` — Display this help information (alias for `/motd`).
  - `/clear` — Wipe the local chat history.
  - `/exit` — Disconnect and return to the login screen.
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

The server is configured to run behind a reverse proxy (like Nginx). Ensure your proxy handles SSL/TLS termination and passes the correct headers for rate limiting to function correctly.

- **Proxy Trust:** Set `TRUSTED_PROXY_IPS` in your `.env` to the IP of your proxy (e.g., `127.0.0.1`).
- **Security:** Always run in `production` mode with a restrictive `LOG_LEVEL`.

## Admin API

The server provides several administrative endpoints for monitoring (requires the corresponding tokens in the `x-admin-token` header):

- `GET /online` — Get total user count (and user list if `ONLINE_TOKEN` is used).
- `GET /admin/rooms` — List active rooms and participants.
- `GET /admin/messages` — View recent system events and message metadata.
- `POST /admin/announce` — Broadcast a system message to all users.

## Contributing

Contributions are welcome! Please ensure that any changes maintain the project's focus on privacy, security, and zero data persistence.

1. Fork the repository.
2. Create a feature branch.
3. Submit a Pull Request.

## License
MIT License — © 2026 mmcvuur
