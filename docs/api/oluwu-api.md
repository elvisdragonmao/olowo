# oluwu HTTP API

This is the browser-facing API implemented by `apps/api`. The provider JWT never appears in these requests or responses. Examples omit ordinary headers such as `Accept: application/json`.

Base URL in local development: `http://127.0.0.1:8787`

## Session model

- Login uses an Email OTP sent by oloo staging.
- A successful verification sets `oluwu_session`, an opaque UUID cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production.
- With PostgreSQL enabled, only SHA-256 of the cookie is stored. The provider JWT is stored as an AES-256-GCM envelope using `SESSION_ENCRYPTION_KEY`.
- With PostgreSQL enabled, pending ride/reservation jobs are restored after an API restart by loading a still-valid encrypted provider session and re-registering the same job ID and trigger time.
- Without PostgreSQL, sessions and jobs are process-local and intended for development only.
- The browser must use `credentials: include`.

## Common errors

|  Status | Code              | Meaning                                                    |
| ------: | ----------------- | ---------------------------------------------------------- |
|     400 | `INVALID_REQUEST` | body, path parameter, or idempotency key failed validation |
|     401 | `AUTH_REQUIRED`   | no valid oluwu session                                     |
|     409 | `RIDE_CHANGED`    | requested ride is no longer the active ride                |
| 4xx/502 | `UPSTREAM_ERROR`  | oloo rejected the request or returned an invalid state     |
|     500 | `INTERNAL_ERROR`  | local service failure                                      |

An upstream failure is never converted to success. The client must keep the previous ride/reservation state until a subsequent read confirms the change.

## Health and fleet

### `GET /v1/health`

Returns `{ ok, service, database }`, where database is `ready` or `not_configured`.

### `GET /v1/map/scooters`

Returns a maximum of 24 nearby sanitized scooters, sorted by approximate distance from the campus origin.

```json
{
	"totalCount": 24,
	"availableCount": 9,
	"unavailableCount": 15,
	"reasons": { "lowBattery": 8, "hardware": 4, "location": 3, "reserved": 2 },
	"scooters": [
		{
			"providerId": 12,
			"id": "JZ-333",
			"batteryPercent": 84,
			"rangeKm": 18,
			"walkMinutes": 2,
			"latitude": 24.79315,
			"longitude": 120.99327,
			"availability": "available"
		}
	]
}
```

IMEI, BLE keys, ICCID, modem phone number, controller serial and raw provider errors are never returned.

### `GET /v1/map/availability-summary`

Returns `totalCount`, `availableCount`, `unavailableCount`, and the multi-label reason counts without scooter rows. `reserved` is derived from the fleet-wide reservation list after excluding the signed-in account's own current reservation.

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
		"action": "return",
		"afterRideSeconds": 89
	}
}
```

`automation` is optional. `action` is `notify`, `return`, or `return_and_reborrow`; duration is 30 seconds through six hours and is calculated from the provider-confirmed ride start. The API resolves IMEI server-side, starts the rental, reads back the new active ride, and only then creates the timer.

### `POST /v1/rides/:rideId/return`

Requires an `Idempotency-Key` header.

```json
{ "scooterId": 1512 }
```

Before sending a return command, the server reads the current provider rental and requires both ride ID and scooter ID to match. A mismatch returns `409` without sending the mutation.

The observed provider lifecycle still performs billing checkout after return. The current oluwu UI is designed for the operator's planned photo-free flow, but it does not forge or upload a placeholder image and does not claim checkout completion while staging still requires `firstImgId`.

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

### `GET /v1/reservations/scheduled`

Returns the current server-side scheduled reservation job.

### `PUT /v1/reservations/scheduled`

```json
{
	"scooterId": 1512,
	"engineLicenseNumber": "AA-001",
	"secondsFromNow": 900
}
```

The delay is 30 seconds through 24 hours. At trigger time the server stops if another reservation exists, resolves the scooter again, verifies the label still matches, then creates the reservation.

### `DELETE /v1/reservations/scheduled`

Cancels the scheduled job.

## Idempotency and scheduler durability

- Immediate mutations share an in-process promise for the same user/action/key for five minutes.
- A browser retry with the same key cannot produce a second concurrent upstream call.
- Ride and reservation schedulers are authoritative and independent of PWA timer throttling.
- With `DATABASE_URL` and `SESSION_ENCRYPTION_KEY`, every job transition is written to `scheduled_actions`. On restart, `scheduled` and interrupted `running` jobs are restored. An overdue job runs immediately but still performs all current-state checks.
- If a valid provider session cannot be restored, the job becomes `failed`; credentials are never copied into the job table.
- An interrupted `return_and_reborrow` is fail-safe: if return already completed before the crash, the active-ride check fails and the server does not issue a blind reborrow.
