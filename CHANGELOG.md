# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-01

### Added

- `timeoutMs` client option: abort any request that exceeds the given duration.
  A timed-out attempt is retried like a network failure (up to `maxRetries`).
  A per-request `timeoutMs` (on `HttpClient` request options) overrides the
  client-level default. Requests remain untimed by default.

## [0.1.0]

### Added

- Initial release: a unified, typed client over Vapi and Retell covering agents,
  calls, and phone numbers.
- Typed error hierarchy (`AuthError`, `NotFoundError`, `ValidationError`,
  `RateLimitError`, `ProviderError`) with automatic retries and exponential
  backoff on 429 / 5xx.
- Lazy pagination via `Page<T>.iterateAll()`.
- Custom-provider registry (`registerProvider`) for bringing your own backend.
