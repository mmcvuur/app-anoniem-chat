# Anoniem Chat: Technical Project Overview & E2EE Implementation

## Project Overview
Anoniem Chat is a privacy-focused, anonymous, and ephemeral group messaging platform designed for secure communication with zero data retention. The system is built on a "Privacy by Design" philosophy, ensuring that no user data, chat history, or metadata is persisted on the server.

### Key Features
- **Zero Registration:** No sign-up, email, or phone number required.
- **Ephemeral Messaging:** Chat history exists only in the browser's memory and is cleared upon page reload.
- **Anonymity:** No tracking cookies, analytics, or fingerprinting.
- **End-to-End Encryption (E2EE):** All messages are encrypted in the sender's browser and decrypted only by the intended recipients.

---

## End-to-End Encryption (E2EE) Architecture
The E2EE implementation in Anoniem Chat follows modern cryptographic standards using the Web Crypto API to ensure that the server (and any intermediary) can never read the content of the messages.

### 1. Key Generation
Users can manually enter an encryption key or generate a cryptographically secure random key directly in the browser. 
- **Method:** `window.crypto.getRandomValues()`
- **Key Length:** 32 characters (alphanumeric and special symbols).
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

## Server-Side Privacy
The server acts purely as a blind relay for encrypted payloads.
- **Zero Visibility:** The server receives only the Base64-encoded ciphertext. It has no access to the encryption keys or the plaintext.
- **No Persistence:** Messages are broadcast to active participants in the room via WebSockets and are never written to a database or disk.
- **Logging:** Only high-level events (e.g., user joins, admin actions) are logged; no message content or sensitive identifiers are captured.

## Security Standards Compliance
- **Web Crypto API:** Utilizes native, high-performance cryptographic primitives provided by the browser.
- **Modern Algorithms:** Employs AES-GCM 256 and PBKDF2-HMAC-SHA256, both of which are currently considered secure and industry-standard.
- **Secure Key Generation:** Uses cryptographically secure PRNGs for all random values (Keys and IVs).

---
*Generated on April 28, 2026*
