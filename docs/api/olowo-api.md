# olowo HTTP API

This is the browser-facing API implemented by `apps/api`. The provider JWT never appears in these requests or responses. Examples omit ordinary headers such as `Accept: application/json`.

Base URL in local development: `http://127.0.0.1:8787`

## Session model

- Login uses an Email OTP sent by oloo staging.
- A successful verification sets `olowo_session`, an opaque UUID cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production.
- With PostgreSQL enabled, only SHA-256 of the cookie is stored. The provider JWT is stored as an AES-256-GCM envelope using `SESSION_ENCRYPTION_KEY`.
- With PostgreSQL enabled, pending ride/reservation jobs are restored after an API restart by loading a still-valid encrypted provider session and re-registering the same job ID and trigger time.
- Without PostgreSQL, sessions and jobs are process-local and intended for development only.
- Once half of the provider token lifetime (from the JWT `iat`/`exp`) has passed, the next authenticated request calls oloo `POST /accounts/keep-login`, stores the new token for every session of that user, and re-issues the cookie with the new lifetime. A failed refresh is logged, keeps the current token, and is not retried for ten minutes.
- When oloo answers `401` to any provider call, the API deletes the local session, clears the cookie and returns `401 AUTH_REQUIRED`.
- The browser calls the API on its own origin (`/v1/*` proxied by Vite or the deployment worker) and must use `credentials: include`.

## Common errors

|  Status | Code              | Meaning                                                    |
| ------: | ----------------- | ---------------------------------------------------------- |
|     400 | `INVALID_REQUEST` | body, path parameter, or idempotency key failed validation |
|     401 | `AUTH_REQUIRED`   | no valid olowo session, or oloo rejected the credential    |
|     409 | `RIDE_CHANGED`    | requested ride is no longer the active ride                |
| 4xx/502 | `UPSTREAM_ERROR`  | oloo rejected the request or returned an invalid state     |
|     500 | `INTERNAL_ERROR`  | local service failure                                      |

An upstream failure is never converted to success. The client must keep the previous ride/reservation state until a subsequent read confirms the change.

## Health and fleet

### `GET /v1/health`

Returns `{ ok, service, database }`, where database is `ready` or `not_configured`.

### `GET /v1/map/stations`

Returns every active station with the scooters docked there. Scooters are grouped by `scooterRentalStationId`; an in-service scooter whose station is unknown is assigned to the nearest station within 150 m or omitted. Scooters that are in use are not station inventory and are only counted in `inUseCount`. Distance and walking time are computed in the browser from the rider's own location, not on the server.

```json
{
	"updatedAt": "2026-10-25T12:00:00.000Z",
	"stationCount": 81,
	"totalCount": 391,
	"availableCount": 212,
	"unavailableCount": 179,
	"inUseCount": 14,
	"reasons": { "lowBattery": 120, "hardware": 31, "communication": 18, "location": 9, "reserved": 6 },
	"stations": [
		{
			"id": 7,
			"name": "浩然圖書館",
			"latitude": 24.78694,
			"longitude": 120.99749,
			"capacity": 16,
			"type": "normal",
			"availableCount": 4,
			"lowBatteryCount": 2,
			"unavailableCount": 3,
			"scooters": [
				{
					"providerId": 1512,
					"id": "JZ-333",
					"model": "c5",
					"batteryPercent": 84,
					"rangeKm": 18,
					"latitude": 24.79315,
					"longitude": 120.99327,
					"availability": "available",
					"reasons": [],
					"warnings": [],
					"fault": null,
					"updatedAt": "2026-10-25T11:59:40.000Z"
				}
			]
		}
	]
}
```

Without a session (and without an operator `OLOO_ACCESS_TOKEN`) the route returns `401 AUTH_REQUIRED`; the PWA shows sign-in first. Station names keep oloo's `校區-名稱站` form; the PWA splits the campus prefix for display. `availability` is `available`, `low_battery` (below the region's battery floor) or `unavailable` (switched off by oloo, `isActive: false`, or reserved by another rider). Only those facts are in `reasons` (`inactive`, `low_battery`, `reserved`). Each station and the fleet report `availableCount`, `lowBatteryCount` and `outOfServiceCount` (the PWA's 可借／沒電／故障). Switched-off scooters are listed only at their own active station; ones whose station is unknown are treated as in a depot and left out. Telemetry that does not stop a rental goes in `warnings`: `hardware` (the controller's last `errorMsg`, e.g. `throttleAbnormal`, also exposed as `fault`), `communication` (status older than five minutes) and `location` (no usable GPS fix). The official app does not read `errorMsg`, and oloo decides eligibility at `new-rent`, so a warning never marks a scooter unavailable. `unavailableCount` includes `low_battery` scooters. The battery floor is per operating region: the station is matched to oloo's `efence-display-ranges` polygons and uses that region's value from the `power_settings` option (e.g. `NCTU-NTHU` 20%, `THU` 50%), falling back to 35%; each station reports `region` and `lowBatteryPercent`.

The fleet snapshot is cached process-wide for 25 seconds because it is identical for every rider; concurrent misses share one upstream refresh, and a snapshot up to five minutes old is served if a refresh fails. Only the rider's own reservation is applied per request.

IMEI, BLE keys, ICCID, modem phone number, controller serial and raw provider errors are never returned.

### `GET /v1/map/efences`

Returns oloo's `multi-feature-efences` as a GeoJSON `FeatureCollection` of polygons (coordinates flipped from oloo's `[latitude, longitude]` to `[longitude, latitude]`, rings closed). Each feature carries `zone` (`normalSpeedArea`, `noThrottleArea`, `canNotLockInNoThrottleArea`, …), `name`, `description`, `color` and `priority`; features are ordered so stricter zones (lower priority number) come last. Shared across riders and cached for ten minutes. Requires the same credential as `/v1/map/stations`.

The PWA draws `normalSpeedArea` as the riding boundary and fills the other zones in their oloo colour. Station counts in the panel are scoped to the campus on screen (the `校區-` prefix of the nearest station's name); the API itself returns every station.

### `GET /v1/map/availability-summary`

Returns the same top-level counts as `/v1/map/stations` without the `stations` array.

## Authentication

### `POST /v1/auth/email/start`

```json
{ "email": "rider@example.com" }
```

Requests a six-digit Email code. Success: `{ "success": true, "email": "…" }`.

### `POST /v1/auth/email/verify`

```json
{ "email": "rider@example.com", "captcha": "123456" }
```

Sets the session cookie and returns only public identity fields:

```json
{
	"authenticated": true,
	"email": "rider@example.com",
	"userId": 115827,
	"roles": ["customer"],
	"expiresAt": "2026-11-24T00:00:00.000Z"
}
```

### `GET /v1/auth/session`

Returns the public session above, or `{ "authenticated": false }`.

### `POST /v1/auth/logout`

Deletes the local session, clears the cookie, and cancels this user's in-process ride and reservation timers.

## Ride plans and current ride

### `GET /v1/scooters/lookup?code=`

Resolves a scanned QR payload or a typed plate to `{ scooterId, stationId, label }`. The official QR format was not captured, so the server accepts a plain plate (`JZ-333`, `jz333`), a URL carrying the plate or IMEI in a query value or path segment, or a bare 15-digit IMEI; matching against IMEI happens only on the server. `404 SCOOTER_NOT_FOUND` when nothing matches, `409 SCOOTER_NOT_DOCKED` when the scooter is not at a station (usually in use).

### `GET /v1/scooters/:providerScooterId/ride-plan`

Authenticated proxy for the provider's possible/basic/station plan result. This route currently preserves the provider plan shape because plan variants differ by account and station.

### `GET /v1/rides/current`

```json
{
	"activeRide": {
		"id": 3102941,
		"scooterId": 1512,
		"label": "AA-001",
		"startedAt": "2026-10-25T12:00:00.000Z",
		"cost": 0
	}
}
```

`activeRide` is `null` when the latest rental has an end time.

## Borrow and return

### `POST /v1/rides`

Requires an `Idempotency-Key` header of at least eight characters.

```json
{
	"scooterId": 1512,
	"reservationId": null,
	"automation": {
		"action": "return_and_reborrow",
		"afterRideSeconds": 88
	}
}
```

`automation` is optional. `action` is `return` or `return_and_reborrow` (the API still accepts `notify`, which the PWA no longer offers); duration is 20 seconds through six hours (the PWA offers 0:28, 1:28, 2:28 or a custom `m:ss`) and is calculated from the provider-confirmed ride start. The API resolves IMEI server-side, starts the rental, reads back the new active ride, and only then creates the timer.

### `POST /v1/rides/:rideId/return`

Requires an `Idempotency-Key` header.

```json
{ "scooterId": 1512 }
```

Before sending a return command, the server reads the current provider rental and requires both ride ID and scooter ID to match. A mismatch returns `409` without sending the mutation.

The observed provider lifecycle still performs billing checkout after return. The current olowo UI is designed for the operator's planned photo-free flow, but it does not forge or upload a placeholder image and does not claim checkout completion while staging still requires `firstImgId`.

## Ride automation

### `GET /v1/rides/:rideId/automation`

Returns `{ "automation": null }` or:

```json
{
	"automation": {
		"id": "opaque-job-id",
		"rideId": 3102941,
		"scooterId": 1512,
		"action": "return_and_reborrow",
		"triggerAt": "2026-10-25T12:01:29.000Z",
		"state": "scheduled",
		"createdAt": "2026-10-25T12:00:02.000Z",
		"updatedAt": "2026-10-25T12:00:02.000Z"
	}
}
```

States are `scheduled`, `running`, `due`, `completed`, `failed`, and `cancelled`. A notification ends in `due`; destructive actions end in `completed` or `failed` and are not retried automatically.

### `PUT /v1/rides/:rideId/automation`

```json
{ "action": "return_and_reborrow", "afterRideSeconds": 89 }
```

Replacing a timer cancels the previous timer for that user and ride. At trigger time, the server re-reads the active ride. Reborrow runs only after a successful return response; any rejection stops the job and exposes `failed`.

### `DELETE /v1/rides/:rideId/automation`

Cancels the timer. Returns `{ "success": true }` even when no timer exists.

## Reservations

### `GET /v1/reservations/current`

Reads the account-scoped `/reservation/current` result and returns normalized current reservations with `id`, `type`, `scooterId`, `vehicleId`, `label`, `createdAt`, and `expiresAt`. The fleet-wide `/reservation/overall-current` result is used only to mark other users' reserved scooters unavailable; it is not exposed as the signed-in user's reservation.

### `POST /v1/reservations`

Requires `Idempotency-Key`.

```json
{ "engineLicenseNumber": "AA-001" }
```

### `DELETE /v1/reservations/:reservationId`

Requires `Idempotency-Key`; the provider mutation is POST `/reservation/cancel` internally.

### `GET /v1/reservations/usage`

Returns `{ reservedLastHour, cancelledThisWeek }` for reservations made through olowo (persisted in `reservation_events` when PostgreSQL is configured). oloo itself limits reservations per hour and suspends reservations after frequent weekly cancellations (the official app's wording: 「這一小時內的預約次數已達上限」「你本週已達 2 天取消預約超過 2 次」); the exact quota is not exposed, so olowo shows the rider's own count and passes oloo's rejection message through. Reservations made in the official app are not counted.

Scheduled ("reserve in N minutes") reservations are not offered.

## Return and checkout

oloo bills a returned ride separately. The observed client flow is return → final bill → upload a return photo → `checkout-with-creditcard`. Until checkout succeeds the ride stays unpaid, and an unpaid ride can block the next rental.

### `GET /v1/rides/:rideId/estimate`

Current fare for the active ride from oloo `estimate-bill`: `{ estimate: { cost, ridingMinutes, parkedMinutes, ratePerMinute, planName, … } }`.

### `GET /v1/rides/unpaid`

`{ ride: { id, scooterId, label, startedAt, endedAt, cost } | null }`: the latest ride when it has ended and `isPaid` is not true. The PWA shows a 「待結帳」 shortcut while this is non-null.

### `GET /v1/rides/:rideId/bill?latitude=&longitude=`

Final bill for the unpaid ride, priced at the return location. Without coordinates the scooter's last telemetry position is used; `409 LOCATION_REQUIRED` when neither exists. A bill for a different ride id is rejected with `409`.

### `GET /v1/payment/cards`

`{ cards: [{ id, issuer, lastFour, valid }] }` from `/transaction-logs/get-card`; the provider account id is dropped.

### `POST /v1/rides/:rideId/photo`

Raw `image/jpeg`, `image/png` or `image/webp` body up to 8 MB (the PWA downsizes to 1600 px JPEG first). Forwarded to `/account-rental-images/upload/?type=SCOOTER&when=RETURN` as multipart; returns `{ imageId }`. The file name uses the ride id, not the IMEI. olowo never generates or substitutes a photo.

### `POST /v1/rides/:rideId/checkout`

Requires `Idempotency-Key`.

```json
{ "imageId": 777, "cardId": 154060, "useOlooCoin": true }
```

Re-checks that this ride is still the unpaid one, resolves the IMEI server-side and sends oloo `{ extraFee: 0, firstImgId, selectedCard, useOlooCoin, rentalLogId, imei }` (the captured client's field set). Returns `{ success, rideId, amount, pointsDeducted }`. Contract recovered from the August capture; no real payment was executed during development.

## Idempotency and scheduler durability

- Immediate mutations (`POST /v1/rides`, return, reservation create/cancel) are keyed by user, action and `Idempotency-Key`. Within one process concurrent duplicates share one promise.
- With PostgreSQL the key is claimed in `idempotency_keys` before calling oloo, so a retry that reaches another API instance replays the stored response or failure instead of mutating again; a duplicate that arrives while the first is still running gets `409`. Keys are pruned after 24 hours.
- The ride scheduler is authoritative and independent of PWA timer throttling.
- With `DATABASE_URL` and `SESSION_ENCRYPTION_KEY` (the schema in `apps/api/sql/schema.sql` is applied at startup), every job transition is written to `scheduled_actions`. On restart, `scheduled` and interrupted `running` jobs are restored. An overdue job runs immediately but still performs all current-state checks.
- Every instance restores pending jobs, so a due job first claims its row with a conditional `UPDATE … SET state = 'running'`; only the winner executes. A `running` row untouched for a minute counts as interrupted and may be claimed again.
- If a valid provider session cannot be restored, the job becomes `failed`; credentials are never copied into the job table.
- An interrupted `return_and_reborrow` is fail-safe: if return already completed before the crash, the active-ride check fails and the server does not issue a blind reborrow.
