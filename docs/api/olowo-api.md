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
		"cost": 0,
		"engine": "running"
	}
}
```

`activeRide` is `null` when the latest rental has an end time. `engine` comes from the ride's `onOffActionsRecord`, which opens with one `off` and gains an entry on every start and park: `idle` before the first `on`, then `running` or `parked` (臨停) by the last entry.

### `POST /v1/rides/:rideId/engine`

`{ "action": "start" | "park" }` → `{ success, engine }`. Sends the official app's `POST /scooter-statuses/update-status` with `{ commandType: "unlock" | "lock", imei, parameters: "{ \"uid\": <accountId> }" }`: `unlock` powers the scooter on (啟動, and 重新啟動 after 臨停), `lock` parks it with the motor off. `409` when the ride is not the active one. oloo's on/off record can lag the command by a few seconds, so the PWA holds the confirmed state until `GET /v1/rides/current` catches up.

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

`automation` is optional. `action` is `return` or `return_and_reborrow` (the API still accepts `notify`, which the PWA no longer offers); duration is 20 seconds through six hours (the PWA offers 0:30, 0:58, 4:58 or a custom `m:ss`) and is calculated from the provider-confirmed ride start. The API resolves IMEI server-side, starts the rental, reads back the new active ride, and only then creates the timer.

### `POST /v1/rides/:rideId/return`

Requires an `Idempotency-Key` header.

```json
{ "scooterId": 1512, "latitude": 24.7876, "longitude": 120.9972 }
```

The coordinates are optional: the PWA sends the phone's location when the rider granted it, otherwise the API uses the scooter's last telemetry fix. Before sending a return command, the server reads the current provider rental and requires both ride ID and scooter ID to match; a mismatch returns `409` without sending the mutation. That check, the IMEI lookup and (when no fix is cached) a fleet refresh run in parallel, because the end time is fixed when oloo receives the bill request; each return logs `checkMs`, `billMs` and `returnMs`. Timers also warm the fleet cache eight seconds before they fire. Like the official client, it then calls oloo `bill?latitude&longitude` first, which fixes the end time and matches the return station, and only then sends `return` (which carries just the IMEI). The response is `{ success, rideId, endedAt, returnStation, locationSource: "rider" | "scooter" | "none" }`.

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

States are `scheduled`, `running`, `due`, `completed`, `failed`, and `cancelled`. A notification ends in `due`; destructive actions end in `completed` or `failed` and are not retried automatically. The timer is measured from the provider-confirmed ride start ("after 0:58 of riding"), not from when it was set. `return_and_reborrow` returns, uploads the placeholder photo, pays with the rider's first valid card (oloo coin first), and only then rents the same scooter again; any failure stops the chain.

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

Returns `{ limitPerHour, reservedLastHour, cancelledLastHour, remaining, nextSlotAt }` computed from oloo's own `/reservation/self-anhour` (the list the official app uses for 「一個小時內你還可預約 N 次」), so reservations made in the official app count too. The rules come from oloo's help centre: a reservation holds the scooter for five minutes and then cancels itself (「預約滑板車後將為您保留5分鐘，逾時則會自動取消」), and a rider may reserve at most twice within an hour (「一小時內車輛預約不能超過兩次」). Frequent cancellations are also refused; the official app's message is 「本週已達2天取消預約超過2次」, and oloo's rejection is passed through unchanged.

`expiresAt` in `current` and `POST /v1/reservations` is always an ISO time. oloo sends `expired` as epoch milliseconds; when it is missing the API uses `createdAt` + 5 minutes.

Scheduled ("reserve in N minutes") reservations are not offered.

## History and plans

### `GET /v1/rides/history`

oloo's `/rental-logs/get-rental-logs-by-account` (the latest 200 rides) as `{ rides: [{ id, label, startedAt, endedAt, durationSeconds, cost, ridingMinutes, parkedMinutes, engineOnSeconds, engineOffSeconds, paid, planName, startStation, endStation }] }`. Account, card, IMEI and invoice fields stay on the server. `engineOnSeconds`/`engineOffSeconds` come from `onOffActionsRecord`; across every ride on the test account oloo billed `normalMinutes = ⌈motor-on time⌉` and `stopMinutes = ⌈motor-off time⌉` separately, and rides returned within about 30 seconds were free.

### `GET /v1/plans?region=`

The plans oloo offers in a region (`oloo-options` → `area_contract_mapping`, `default` when the region is unknown), joined with `/contracts` and `/ride-plans`. Each plan carries oloo's own eligibility from `GET /contracts/can-purchase/:contractId` (`canPurchase`, `reasons`). `current` is the active plan from `/user-contracts/take-self-effect` with `userContractId`, remaining minutes, end date, auto-renew and top-up options (`{ id, minutes, price, tag }`).

### Buying, top-ups and renewal

The request shapes come from the official app (5.50.0); none of these has been exercised against a real charge yet.

| olowo                                                                | oloo                                                                   | body                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| `POST /v1/plans/:contractId/estimate`                                | `POST /contracts/estimate-purchase/:contractId`                        | `{ userCouponId? }`                       |
| `POST /v1/plans/:contractId/purchase` (idempotency key)              | `POST /contracts/purchase-with-creditcard/:contractId`                 | `{ userCouponId? }`                       |
| `POST /v1/plans/current/top-ups/:topUpId/estimate`                   | `POST /user-contracts/estimate-top-up/:userContractId/:topUpId`        | `{ userCouponId? }`                       |
| `POST /v1/plans/current/top-ups/:topUpId/purchase` (idempotency key) | `POST /user-contracts/top-up-with-creditcard/:userContractId/:topUpId` | `{ userCouponId? }`                       |
| `DELETE /v1/plans/current/auto-renew`                                | `POST /user-contracts/cancel-auto-renew`                               | `{ id: userContractId }`                  |
| `PUT /v1/plans/current/next` `{ contractId }`                        | `POST /user-contracts/specify-auto-renew-contract-id`                  | `{ userContractId, autoRenewContractId }` |

The card is the one selected in the rider's oloo account; the app sends `prime` and `frontendRedirectUrl` only for LINE Pay, which olowo does not offer. The plan estimate answers `{ contractId, amount, title, startsAt, endsAt }`: with a monthly plan running, a new monthly plan starts when the current one ends. Purchases and plan changes are limited to contracts listed in some region of `area_contract_mapping`. `/contracts` also holds about 50 hidden or retired contracts (campaign passes, a campus's staff or orientation plans, one-off compensation); `can-purchase` answers `true` for most of them, but the official app never lists them, so olowo refuses them with `404`.

## Coupons

### `GET /v1/coupons`

`/user-coupons/self` joined with the `/coupons` catalog: `{ coupons: [{ id, name, description, information, scope, startsAt, endsAt, usedAt, state }] }`. `scope` is read from `usableConditions` (`forContractPurchase` → `plan`, `forTopUp` → `topUp`, `forScooterRental` or `rentalCost` → `ride`, otherwise `any`); `state` is `usable`, `pending`, `used` or `expired`. The coupon's own code stays on the server.

### `POST /v1/coupons/redeem`

`{ code }` (letters, digits, `_` and `-`). Like the app, the API asks `GET /coupons/detect-code-type/:code` and then posts `coupons/acquire-by-code/:code` for a campaign code or `user-coupons/acquire-by-code/:code` for a code another rider shared. An unknown code answers `404`.

## Return and checkout

oloo bills a returned ride separately. The observed client flow is bill at the return location → return → `estimate-bill` at the fixed end time → upload a return photo → `checkout-with-creditcard`. The PWA attaches the blank placeholder photo as soon as checkout opens; a real photo is optional. Until checkout succeeds the ride stays unpaid, and an unpaid ride can block the next rental.

### `GET /v1/rides/:rideId/estimate`

Current fare for the active ride from oloo `estimate-bill`: `{ estimate: { cost, ridingMinutes, parkedMinutes, ratePerMinute, planName, … } }`.

### `GET /v1/rides/unpaid`

`{ ride: { id, scooterId, label, startedAt, endedAt, cost } | null }`: the latest ride when it has ended and `isPaid` is not true. The PWA shows a 「待結帳」 shortcut while this is non-null.

### `GET /v1/rides/:rideId/bill`

Final bill for the unpaid ride, priced with oloo `estimate-bill` at the moment of return (`lastRentalEndedAtForCalculationMillis`), exactly as the official client does after returning. It therefore stops growing when the rider presses return, not when they finish the photo. Includes `endedAt` and `returnStation`.

### `GET /v1/payment/cards`

`{ cards: [{ id, issuer, lastFour, valid }] }` from `/transaction-logs/get-card`; the provider account id is dropped.

### `POST /v1/rides/:rideId/photo`

Raw `image/jpeg`, `image/png` or `image/webp` body up to 8 MB (the PWA downsizes to 1600 px JPEG first), or `?placeholder=1` with no body to upload a built-in 1×1 white PNG. Forwarded to `/account-rental-images/upload/?type=SCOOTER&when=RETURN` as multipart; returns `{ imageId }`. The file name uses the ride id, not the IMEI.

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
