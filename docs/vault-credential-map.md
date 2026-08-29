# Vault V1 — Current Credential Map (pre-migration baseline)

Status: baseline survey taken at base `9d72965`, before Secret Vault V1.
This milestone builds the vault CORE ONLY — nothing below is migrated yet.

## Where credentials live today

| Area | Source | Storage | Leak risk today |
|---|---|---|---|
| LLM provider keys | UI → `POST /api/ai/provider`; env seed `OPENROUTER_API_KEY` | `configs/providers.json` via JsonStore (plaintext) | Masked in UI read model (`hasKey`, `keyHint`); legacy `src/providers/openRouterProvider.js` reads env directly and `console.dir`s full request payloads |
| Telegram | `configs/telegram.json`, fallback `DAMAR_TELEGRAM_TOKEN` | plaintext JSON | No masking helper on token path |
| TOTP shared secret | `DAMAR_TOTP_CONFIG` or configs default | plaintext JSON | none applied |
| WhatsApp session | Baileys `useMultiFileAuthState` | `configs/wa-auth/` creds.json + keys, plaintext | deleted on logout; otherwise unprotected |
| Home Assistant | `configs/home.json` (`url`,`token`), fallback `DAMAR_HASS_*` | plaintext JSON | masked in UI view only |
| MCP servers | `configs/mcp.json`, `DAMAR_MCP_SERVERS` env JSON | plaintext, incl. per-server `env` blocks passed verbatim to spawned processes | no masking anywhere |
| Integrations | `integrations.json` + `DAMAR_<ID>_KEY` env | committed file with apiKey fields | no masking |
| Env vars | `.env` via dotenv | process env | any error/log string containing them is forwarded unfiltered |

## Logging / redaction today

- Two loggers (`src/core/logger/Logger.js`, `src/utils/logger.js`) are pass-through;
  the latter forwards every line to telemetry → Console Logs read model.
- Only redaction utilities: `src/core/safety/auditTrail.js redact()` (tool-audit args
  only) and ad-hoc per-service `mask()` helpers (provider config, HA).
- `errorHandler` sends raw `err.message` to HTTP clients.

## Config layering

- `src/core/config/JsonStore.js`: plain JSON, tmp+rename atomic write, cache.
  No encryption, no redaction, no file-mode hardening. Persistence primitive for
  every credential store listed above.

## Authority surface (untouched by this milestone)

- `src/authority/index.js` exports canonical/model/delegation/registry/store.
- The vault imports none of it (proven structurally in `tests/vault/structural.test.js`)
  and mutates none of it at runtime (proven in `tests/vault/storm.test.js`).

## Recovery

- `src/runtime/recovery/*`: restore never reactivates authority; capsule sections
  classified AUTHORITY_SENSITIVE stay opaque evidence. The vault extends the same
  doctrine: recovery evidence restores as metadata-only `evidence` status and can
  never resurrect a revoked or rotated value.

## Extensions

- `src/plugins/pluginValidator.js` manifests carry `id/name/version/entry` only —
  no permission/access declaration exists yet. Manifest != secret access holds by
  default: nothing grants extensions vault access in this milestone.

## Migration implications (future milestones)

1. Replace raw values in `providers.json` / `telegram.json` / `home.json` /
   `mcp.json` with SecretRef strings (`secretref:v1:sec-…:<scope>`).
2. Legacy openRouterProvider console payload logging must be removed before it
   ever resolves real refs.
3. WhatsApp auth-dir material needs a store adapter decision (directory of files,
   not single JSON) — out of scope for V1 core.
