# Anoniem Chat: Technical Project Overview & E2EE Implementation

## Project Overview
Anoniem Chat is a privacy-focused, anonymous, and ephemeral group messaging platform designed for secure communication with zero data retention. The system is built on a "Privacy by Design" philosophy, ensuring that no user data, chat history, or metadata is persisted on the server.

### Key Features
- **Zero Registration:** No sign-up, email, or phone number required.
- **Ephemeral Messaging:** Chat history exists only in the browser's memory and is cleared upon page reload.
- **Anonymity:** No tracking cookies, analytics, or fingerprinting.
- **End-to-End Encryption (E2EE):** All messages are encrypted in the sender's browser and decrypted only by the intended recipients.
- **Rich Media Previews:** Secure, client-side previews for YouTube videos, PDF documents, and Twitter/X posts.
- **Direct Room Joining:** Secure URL-based room joining via client-side fragments.

---

## End-to-End Encryption (E2EE) Architecture
The E2EE implementation in Anoniem Chat follows modern cryptographic standards using the Web Crypto API to ensure that the server (and any intermediary) can never read the content of the messages.

### 1. Key Generation
Users can manually enter an encryption key or generate a cryptographically secure random key directly in the browser. 
- **Method:** `window.crypto.getRandomValues()`
- **Key Length:** 64 characters (hexadecimal).
- **Security:** The key never leaves the user's browser.

### 2. Key Derivation (PBKDF2)
The raw key provided by the user is not used directly for encryption. Instead, a strong encryption key is derived using the PBKDF2 (Password-Based Key Derivation Function 2) algorithm.
- **Algorithm:** PBKDF2
- **Hash Function:** SHA-256
- **Iterations:** 100,000 (standard for protecting against brute-force attacks)
- **Salt:** Derived from the SHA-256 hash of the key itself.
- **Resulting Key:** AES-GCM 256-bit key.

### 3. Message Encryption (AES-GCM)
Messages are encrypted using the Advanced Encryption Standard (AES) in Galois/Counter Mode (GCM).
- **Algorithm:** AES-GCM 256
- **Initialization Vector (IV):** A unique, random 12-byte IV is generated for every single message using `crypto.getRandomValues()`.
- **Authentication:** AES-GCM provides both confidentiality and integrity (authentication), ensuring that messages cannot be tampered with in transit.
- **Payload:** The IV is prepended to the ciphertext and the combined result is Base64 encoded before being sent to the server.

### 4. Message Decryption
When a client receives an encrypted message:
1. The Base64 payload is decoded.
2. The 12-byte IV is extracted.
3. The remaining ciphertext is decrypted using the local AES-GCM key and the IV.
4. If decryption fails (e.g., due to a different room key), the message is displayed as `[Decryption Failed]`.

---

## Rich Media & Link Previews
To enhance the user experience without compromising privacy, the application includes secure, client-side preview mechanisms:

- **YouTube Previews:** Automatically detects YouTube URLs and displays a thumbnail preview with a play button overlay. Links directly to the video.
- **PDF Previews:** Identifies PDF document links and displays a document preview card showing the filename and file type.
- **Twitter/X Previews:** Recognizes posts from Twitter/X and fetches live post content and author metadata via a public, privacy-preserving API (vxtwitter).
- **Security:** Previews are generated entirely in the client's browser. No URL data is sent to the Anoniem server for preview generation.

## Secure Room Joining
The platform supports a secure method for sharing room access via URLs:
- **Implementation:** Uses URL Fragments (`#`) to store room keys (e.g., `https://anoniem.chat/#key=...`).
- **Security Advantage:** Unlike query parameters (`?`), URL fragments are **never sent to the server** in the HTTP request. This prevents the room key from appearing in server logs, proxy logs, or browser history, maintaining the zero-knowledge nature of the platform.
- **Auto-Join:** If a valid key is present in the fragment and a username is already saved in the browser's local storage, the user is joined to the room automatically.

---

## Server-Side Privacy
The server acts purely as a blind relay for encrypted payloads.
- **Zero Visibility:** The server receives only the Base64-encoded ciphertext. It has no access to the encryption keys or the plaintext.
- **No Persistence:** Messages are broadcast to active participants in the room via WebSockets and are never written to a database or disk.
- **Logging:** Only high-level events (e.g., user joins, admin actions) are logged; no message content or sensitive identifiers are captured.

## System Limits & Anti-Spam
To ensure platform stability and prevent abuse, several server-side limits are enforced:
- **Global Capacity:** Maximum of 100 concurrent users across the entire platform.
- **Room Capacity:** Maximum of 10 concurrent users per chat room.
- **Room Limit:** Maximum of 10 concurrent active rooms.
- **Connection Limit:** Maximum of 3 concurrent WebSocket connections per IP address.
- **Message Constraints:** Maximum message length of 2048 characters (optimized for E2EE payloads) and a limit of 5 URLs per message.
- **Identity Management:** Usernames are limited to 15 characters, with a maximum of 5 change attempts per session to prevent identity-shifting spam.
- **Rate Limiting:** Adaptive rate limiting with a burst capacity of 6 messages and a sustained rate of 2 messages per second.
- **Spam Protection:** Heuristic analysis to detect duplicate messages, repetitive character patterns, and command flooding.
- **Temporary Muting:** Automated 30-second mute for users who exceed strike thresholds for spam or flood violations.

## Security Standards Compliance
- **Web Crypto API:** Utilizes native, high-performance cryptographic primitives provided by the browser.
- **Modern Algorithms:** Employs AES-GCM 256 and PBKDF2-HMAC-SHA256, both of which are currently considered secure and industry-standard.
- **Secure Key Generation:** Uses cryptographically secure PRNGs for all random values (Keys and IVs).

---
*Updated on May 3, 2026*
