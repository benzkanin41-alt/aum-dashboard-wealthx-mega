# Use Sites D1 as the canonical dashboard store

The public Sites application owns the canonical AUM, Official AUA, refresh-job, and model-version records in D1, with source-document bytes in R2. The local dashboard reads that shared dataset and keeps an atomic last-known-good JSON cache for offline viewing; GitHub Actions only schedules the public refresh endpoint. This avoids divergent Local and Online calculations while preserving a usable local shortcut when the network is unavailable.
