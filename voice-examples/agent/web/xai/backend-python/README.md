# XAI Voice Web Backend (LFM-Enhanced)

**COPYRIGHT © 2025 KEITH LUTON. ALL RIGHTS RESERVED.**

This is a production-hardened FastAPI server that provides ephemeral tokens for direct client-to-XAI connections. It has been enhanced with the **Luton Field Model (LFM) V3.0 AGI Stability Lock**.

## Security Features

- **LFM Governance**: Integrated V3.0 AGI Stability Lock for cognitive consistency.
- **Production Headers**: HSTS, CSP, X-Frame-Options, and X-Content-Type-Options.
- **Robust Rate Limiting**: Strict request limits to prevent abuse.
- **Secure Containerization**: Multi-stage Dockerfile running as a non-root user.
- **Restricted CORS**: Production-ready origin filtering.

## Quick Start (Docker)

1. Set your `XAI_API_KEY` in `.env`.
2. Build and run:
   ```bash
   docker build -t xai-voice-backend .
   docker run -p 8000:8000 --env-file .env xai-voice-backend
   ```

## Development

```bash
./start.sh
```

---
*Author: Keith Luton*
*Affiliation: Luton Field Initiative*
