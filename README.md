# Aether

Aether adalah AI Assistant lokal yang dibangun untuk berjalan di server pribadi.

## Tujuan

- AI lokal dengan Ollama
- Memory jangka panjang
- Integrasi Home Assistant
- Integrasi Docker
- Integrasi PostgreSQL
- Vision
- Voice
- RAG
- Automation

## Teknologi

- Node.js
- Docker
- Ollama
- PostgreSQL
- Git
- Electron (Aether Console)

## Menjalankan

Daemon:

```bash
npm install
```

```bash
npm start
```

Aether Console (aplikasi desktop untuk monitoring & kendali):

```bash
npm run console:install
```

```bash
npm run console
```

Detail lengkap ada di [docs/console.md](docs/console.md) dan
[docs/memory.md](docs/memory.md).

## Struktur

```
src/
  ai/            AI runtime: provider, engine, tool-calling, streaming
  memory/        memori jangka panjang: entitas, recall hibrida, dokumen
  core/          fondasi: container, event, lifecycle, registry, tools, http
  plugins/       plugin & tool (calculator, filesystem, http, weather, ...)
  integrations/  konektor ke Ollama, OpenClaw, hermes-agent
  controllers/   bidang kendali HTTP
  services/      AI runtime, telemetri, perangkat, sensor
apps/
  console/       aplikasi desktop Electron
configs/
  integrations.json   alamat sistem eksternal
```

## Konfigurasi

Variabel penting di `.env`:

| Variabel | Guna |
|---|---|
| `PORT` | Port daemon (default 3000) |
| `HOST` | Alamat bind (default `0.0.0.0`) |
| `AETHER_TOKEN` | Token bidang kendali. **Wajib diset bila daemon terjangkau LAN.** |
| `AI_PROVIDER` | `ollama` atau `openrouter` |
| `AETHER_OLLAMA_URL` | Alamat daemon Ollama |
| `OLLAMA_MODEL` | Model default untuk Ollama |
| `OPENROUTER_API_KEY` | Kunci OpenRouter (opsional) |
| `OPENROUTER_MODEL` | Model default untuk OpenRouter |
| `AETHER_MEMORY_DB` | Lokasi basis data memori (default `data/memory.db`) |
| `AETHER_EMBED_MODEL` | Model embedding di Ollama (default `nomic-embed-text`) |

Alamat OpenClaw dan hermes-agent diatur di `configs/integrations.json`,
atau ditimpa lewat `AETHER_OPENCLAW_URL` / `AETHER_HERMES_URL`.

## Roadmap

| Fase | Isi | Status |
|---|---|---|
| 1 | Framework | ✅ |
| 2 | Plugin System | ✅ |
| 3 | AI Core | ✅ |
| — | Console desktop + bidang kendali | ✅ |
| 4 | Local Memory | ✅ |
| 5 | Workflow Engine | ⬜ |
| 6 | Multi-Agent | ⬜ |
| 7 | Voice + Vision | ⬜ |
| 8 | Home Automation | ⬜ |

## Status

🚧 Development
