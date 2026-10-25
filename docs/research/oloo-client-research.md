# oloo third-party client research

Date: 2026-10-25  
Project: olowo  
Status: evidence-backed discovery, not a production security assessment

## Executive summary

The supplied artifacts are sufficient to build a useful third-party client without guessing the core fleet model. The Android app is a React Native application using Hermes bytecode and CodePush, not Electron. The captured staging session exposes scooter inventory, per-scooter telemetry, stations, e-fences, ride plans, the current reservation, rental history, billing, return-image upload, and ride lifecycle calls.

The highest-value product opportunity is not a different coat of paint. It is combining three datasets the official app keeps apart:

1. `scooters-infos`: identity, model, station assignment, active/rental relations, and estimated range.
2. `scooter-statuses`: exact power percentage, GPS, lock state, radio quality, fault flags, and `errorMsg`.
3. station and e-fence data: where the scooter may be borrowed, ridden, slowed, parked, and returned.

The previous semester's analysis independently supports this direction. In its sampled in-station, non-rented records, 57.38% were unavailable. Of unavailable samples, 88.37% had less than 35% battery. The ten highest-risk stations were dominated by the condition "vehicles present but unavailable", rather than physically empty stations. A map that reports only station inventory therefore hides the decision users actually need to make.

## Evidence inventory

| Artifact | Observed facts | Limits |
| --- | --- | --- |
| `oloo_5.50.0_APKPure.xapk` | Package `com.looplus`, version 5.50.0 (479), min SDK 29, target SDK 36, React Native, Hermes bytecode v96, CodePush, Noto Sans TC assets | Hermes bytecode is not source code; hook and screen names are evidence of capabilities, not exact HTTP contracts |
| `filtered_domains_08-02-2026-18-20-40.har` | 628 total entries; 512 requests to the staging API; complete request/response examples for one borrow/return/checkout flow | One account, one roughly 5.5-minute capture, staging only, and no email-login transaction |
| `oloo-final-report.pdf` | May 9 to June 18, 2026 campus availability study, 72,512 station observation windows and 55,379,148 vehicle-status observations | Historical observational study; it does not prove the server's current eligibility rules |

All secrets, account identifiers, exact journey traces, BLE keys, SIM identifiers, and raw image metadata are intentionally omitted from this document.

## Application architecture findings

The APK contains:

- `assets/index.android.bundle`, identified as Hermes JavaScript bytecode version 96.
- CodePush metadata and App Center configuration.
- React Native, Expo modules, React Navigation, React Query, Reanimated, camera, geolocation, compression, and Sentry strings.
- Hooks and state names for rent, return, lock, unlock, reservations, billing, contracts, coupons, image upload, e-fences, and email verification.
- Dedicated visual assets for available, unavailable, empty, reserved, suspended, and riding scooter/station states.

The app is therefore a native React Native client that downloads large fleet snapshots and performs client-side joins and presentation. It is not an Electron shell.

## Captured traffic profile

The oloo portion of the HAR spans 2026-08-02 10:14:46Z to 10:20:16Z.

| Metric                  |                                           Observation |
| ----------------------- | ----------------------------------------------------: |
| API requests            |                                                   512 |
| Captured duration       |                                          5.51 minutes |
| Response bodies         |                                       about 20.02 MiB |
| `GET /scooter-statuses` |   10 calls, about 10.52 MiB total, median gap 29.75 s |
| `GET /scooters-infos`   |    10 calls, about 6.62 MiB total, median gap 29.75 s |
| user-position tracking  | 267 POSTs, approximately once per second while active |
| WebSocket handshakes    |                                                    10 |

The two fleet endpoints account for roughly 17.1 MiB of the 20 MiB captured response traffic. Repeatedly decoding, joining, sorting, and rendering those full arrays is a plausible contributor to memory pressure and jank, but the capture alone does not prove the cause of the reported crashes.

An olowo backend should poll once per region, normalize records, publish small deltas, and share that cache among clients. The browser should not download raw fleet snapshots every 30 seconds.

## Fleet snapshot

The final matched snapshot in the HAR contained:

| Dataset                                   | Records |
| ----------------------------------------- | ------: |
| scooter information                       |   1,027 |
| scooter telemetry/status                  |   1,258 |
| active stations                           |      81 |
| information/status records joined by IMEI |   1,017 |

The status snapshot ranged from 0% to 100% power; 303 status records were below 35%. It also contained 392 records with missing or zero GPS coordinates and 920 non-empty `errorMsg` values. `Connection: close` appeared as a transport message and must not be counted as a vehicle fault. The next most common strings in this snapshot were `illegalMovement`, `illegalDisassembly`, and `throttleAbnormal`. These counts are descriptive only because error signals overlap and the status population is larger than the scooter-information population.

## Availability model for olowo

The official server's exact final eligibility predicate was not captured. olowo should therefore expose an explainable diagnostic model and avoid labeling it as an official rejection reason.

For each scooter, join `ScooterInfo` and the latest `ScooterStatus` on normalized IMEI and retain every applicable reason. Recommended reason groups are:

| Group          | Evidence                                                                 | UI wording |
| -------------- | ------------------------------------------------------------------------ | ---------- |
| rented/in use  | an active account or ride association confirmed by the current-ride data | 使用中     |
| inactive       | `ScooterInfo.isActive === false`                                         | 暫停服務   |
| low battery    | `power < 35`                                                             | 電量不足   |
| hardware fault | `faultStatus` or a hardware-class `errorMsg`                             | 硬體異常   |
| communication  | stale status or communication-class errors                               | 通訊異常   |
| location       | invalid coordinates, poor GPS, or stale GPS timestamp                    | 定位異常   |
| reservation    | current reservation data assigns the scooter to another user             | 已被預約   |
| unknown        | upstream says unavailable but no supported diagnostic signal exists      | 原因未知   |

Reason counts must be multi-label and disclose that totals can exceed the number of unavailable scooters. For a compact summary, apply a display precedence of rented, inactive, hardware, low battery, location, communication, unknown while retaining the complete reason set in diagnostics.

Live verification clarified the reservation scope: `/reservation/current` is account-scoped, while `/reservation/overall-current` is the fleet-wide set used to suppress vehicles reserved by other riders. Treating `overall-current` as the user's reservations would expose irrelevant entries and incorrectly block all scheduled reservations whenever anyone else had one.

## Observed ride lifecycle

The captured session shows this order:

```mermaid
flowchart LR
    A[Select or scan scooter] --> B[Get possible ride plan]
    B --> C[POST new-rent]
    C --> D[Ride and send location tracking]
    D --> E[POST return]
    E --> F[Estimate bill]
    F --> G[Capture and upload return photo]
    G --> H[Receive uploaded image id]
    H --> I[Checkout with card, ride id, scooter id, image id]
    I --> J[Show final bill]
```

The return-photo upload and final checkout are separate operations. The observed checkout includes an uploaded image ID. No test was made with a missing, blank, forged, or null image, so the evidence does not support claiming that the photo can be bypassed. A safe client can reduce a genuine image's dimensions and quality, queue retries, preserve an upload receipt, and let the user resume checkout after a crash.

## Security findings

### Critical: bearer tokens appear in URLs and telemetry

The HAR records `access_token` on nearly every API query string, a JWT path segment on an authentication route, and a `token` query parameter for WebSocket connections. One navigation analytics payload also contained a nested checkout object whose extra options included the bearer token.

URL credentials can be retained by browser history, reverse proxies, CDN logs, analytics, crash reports, and screenshots. olowo never repeats this pattern in browser traffic. October 25 staging checks found that the provider rejects header-only and `Bearer` requests and requires the raw JWT in both the `Authorization` header and `access_token` query. Fastify therefore performs that compatibility step only on its server-to-server connection and issues the browser an opaque, Secure, HttpOnly, SameSite session cookie.

The token pasted into the project conversation should be treated as exposed and rotated, even though it is a staging token. It must not be committed, copied into `.env.example`, embedded in the PWA, or used in screenshots.

### High: fleet responses include device secrets not needed by the UI

The scooter-information response includes operational identifiers such as BLE address/key material, SIM/ICCID and mobile-number fields, controller serials, and firmware versions for the fleet. olowo must explicitly allow-list its public DTO and discard these fields before caching or logging. No BLE-control functionality will be built from this data.

### High: action analytics contain excessive sensitive context

Observed action events include full navigation parameters. In the return-photo flow this included local file paths, detailed photo EXIF, device make/model, timestamps, and coordinates. Other events contained account, ride, scooter, billing, and token-bearing objects. olowo analytics should accept event names and minimal scalar context only; request bodies must pass a recursive redaction filter before logs or error reporting.

### Medium: polling and tracking are unnecessarily expensive

The official client downloaded full fleet datasets every roughly 30 seconds and posted active location approximately once per second. olowo should use region-bounded cache refresh, server-side joins, change detection, adaptive foreground intervals, WebSocket/SSE deltas, and no background location collection unless a ride is active and the user has granted it.

### Safety boundary for mutations

This research did not invoke lock, unlock, location-command, rent, return, checkout, or reservation mutations. The HAR is enough to document their observed contracts. Before enabling them, tests need an operator-approved staging account, a known staging vehicle, idempotency keys, audit logs, a kill switch, and a written cleanup procedure.

## Product conclusions

The first release should emphasize:

1. exact battery percentage on scooter markers;
2. precise scooter location with age/accuracy indicators;
3. viewport and station-level unavailable-reason statistics;
4. an honest confidence label when a reason is inferred;
5. a ride timer, live cost estimate, and user-confirmed cost guard;
6. resumable, compressed return-photo upload;
7. stable email-session handling through the backend;
8. clear e-fence, slow-zone, no-throttle, and return-zone layers.

Automatic return/reborrow is not suitable as a PWA-only timer: browsers suspend background work, and the operation changes billing and vehicle state. With explicit CEO authorization, olowo implements it as a server-side, per-ride opt-in: the UI states the next billing consequence, requires confirmation, provides cancellation, rechecks the current ride, returns first, and stops rather than retrying an ambiguous failure. Production deployment still needs durable scheduler recovery and a known-vehicle mutation drill.

## Open evidence gaps

- Email sign-in was not present in the HAR; its exact request/verification endpoints were recovered from the Hermes bundle and successfully exercised on staging. Refresh and provider-side token revocation remain unverified.
- Reservation create/cancel mutations were not in the HAR; their exact paths and payloads were recovered from the Hermes bundle. Live destructive validation still requires a named staging scooter.
- The upstream final borrow-eligibility predicate is not documented.
- Direct provider CORS is intentionally irrelevant because the PWA only calls Fastify.
- No Android runtime profiling or crash trace was provided, so traffic volume is a performance hypothesis rather than a crash root cause.
- All observed API paths are staging behavior from August 2, 2026 and may drift.
