# Where the functions run

`vercel.json` sets `"regions": ["sin1"]`: every API route runs in Singapore. Before
T-0249 they ran in Vercel's default, `iad1` (Washington, US).

Measured on 2026-10-09 from the owner's PC in Vietnam, with real Groq calls through
preview deployments in each region (synthetic Vietnamese voice, no real user data):

| Step | iad1 | sin1 |
|---|---|---|
| Transcribe 30 s, WAV 960 KB, whisper-large-v3 (whole round trip) | 2.6–4.4 s | 1.8–2.2 s |
| Transcribe 30 s, WAV, whisper-large-v3-turbo | 2.5–2.7 s | 1.5–1.6 s |
| Transcribe 30 s, Opus 24 kbps (71 KB), turbo | 1.3 s | 0.67–0.71 s |
| Transcribe 5 s, Opus, turbo | 0.82–0.85 s | 0.46–0.48 s |
| One Supabase read from the function | 300–880 ms | 40–140 ms |
| Cleanup, gpt-oss-120b (Groq time) | about the same | about the same |

- Groq answers **403 Forbidden** to calls from `hkg1` (Hong Kong): do not use it.
- Supabase (project `tpiycamfsagesjeciubg`) is close to Singapore, so every route
  that reads or writes the database is faster from `sin1` too.
- On the Hobby plan a per-route `preferredRegion` is ignored; the project-wide
  `regions` in `vercel.json` is what moves the functions.
