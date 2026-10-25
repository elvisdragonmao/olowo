# Observed oloo staging API

This document records every oloo API operation observed in the supplied August 2, 2026 HAR. It is complete for that capture, not a claim that it is the provider's complete private API. Paths and schemas can change without notice.

Base origin: `https://looplus-api-staging.loopluscooter.com`  
REST prefix: `/nest/api`  
Realtime endpoint: `/wss/`

## Authentication and caching

The official client sent a bearer authorization header and duplicated the token in the `access_token` query parameter on most REST calls. The WebSocket used a `token` query parameter. The client also used `ETag`/`If-None-Match`; many configuration and account endpoints returned `304 Not Modified`.

oluwu must not expose provider tokens to browser JavaScript or URLs. Browser calls terminate at Fastify using an opaque session cookie. Fastify adds the upstream credential, strips sensitive response fields, applies timeouts, and maps upstream errors to a stable oluwu error envelope.

## Complete observed endpoint inventory

### Accounts and eligibility

| Method | Path                           | Observed purpose                                           |
| ------ | ------------------------------ | ---------------------------------------------------------- |
| GET    | `/account-apply/self-applys`   | passport, driving-licence and insurance applications       |
| GET    | `/accounts/auth/{token}`       | exchange/authenticate a token; insecure path form observed |
| GET    | `/accounts/get-one-time-token` | obtain a short-lived token                                 |
| GET    | `/accounts/get-user-profile`   | profile, verification state, ride-plan relations           |
| GET    | `/accounts/has-unpaid-bills`   | unpaid scooter, vehicle and contract bills                 |
| GET    | `/accounts/is-suspended`       | suspension state and details                               |
| POST   | `/accounts/keep-login`         | refresh/keep-login token                                   |
| GET    | `/user-meta/get-self`          | user metadata list                                         |
| POST   | `/user-meta/save-self`         | save `metaKey` and `metaValue`                             |

### Fleet, stations and telemetry

| Method | Path                                                    | Observed purpose                                               |
| ------ | ------------------------------------------------------- | -------------------------------------------------------------- |
| GET    | `/scooters-infos`                                       | scooter identity, model, relation and estimated-range snapshot |
| GET    | `/scooter-statuses`                                     | scooter GPS, battery, lock, radio and fault snapshot           |
| GET    | `/scooter-meta/get-by-scooter-id-for-users/{scooterId}` | user-visible scooter metadata                                  |
| POST   | `/scooter-statuses/update-status`                       | send `location`, `lock` or `unlock` command                    |
| GET    | `/scooter-rental-stations/active-stations`              | active station definitions                                     |
| GET    | `/rental-stations/cache/info`                           | cached station state; empty in the captured 200 response       |
| GET    | `/vehicles-infos`                                       | other vehicle inventory                                        |
| GET    | `/vehicle-statuses`                                     | other vehicle telemetry                                        |

### Locations and e-fences

| Method | Path                                                                                  | Observed purpose                                     |
| ------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| GET    | `/location/custom-nest-query?query=…`                                                 | location selection/query                             |
| GET    | `/location-meta/multi-feature-efences`                                                | geometry and properties for multiple e-fence classes |
| GET    | `/location-meta/cache/efence-display-ranges`                                          | display ranges by location                           |
| GET    | `/location-meta/find-by-location-id-and-key-for-user/{locationId}/required_insurance` | insurance rule for a location                        |

### Rent, return, image and billing

| Method | Path                                                 | Request fields observed                                                        | Response shape                          |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| GET    | `/scooters-infos/get-possible-ride-plan/{scooterId}` | path scooter ID                                                                | possible/basic/station/model ride plans |
| POST   | `/scooters-infos/new-rent`                           | `imei`, `reservationId`                                                        | `success`, scooter                      |
| POST   | `/scooters-infos/return`                             | `imei`                                                                         | `success`, scooter                      |
| GET    | `/scooters-infos/estimate-bill`                      | query `lastRentalEndedAtForCalculationMillis`                                  | detailed provisional bill               |
| GET    | `/scooters-infos/bill`                               | query `latitude`, `longitude`                                                  | detailed final bill                     |
| POST   | `/account-rental-images/upload/`                     | multipart image; query `type`, `when`                                          | `success`, uploaded resource            |
| POST   | `/scooters-infos/checkout-with-creditcard`           | `extraFee`, `firstImgId`, `selectedCard`, `useOlooCoin`, `rentalLogId`, `imei` | `success`, result                       |
| GET    | `/rental-logs/get-last-rental-log-by-account`        | none                                                                           | latest rental-log array                 |
| GET    | `/rental-logs/get-rental-logs-by-account`            | none                                                                           | rental-log history                      |

### Reservations

| Method | Path                           | Observed purpose                                         |
| ------ | ------------------------------ | -------------------------------------------------------- |
| GET    | `/reservation/current`         | current reservation object; empty object in this capture |
| GET    | `/reservation/overall-current` | scooter/vehicle reservations and expiration              |

Create and cancel operations were not captured. APK hook names suggest both exist, but their paths and schemas must not be invented.

### Plans, contracts, coupons and payments

| Method | Path                                                | Observed purpose                                          |
| ------ | --------------------------------------------------- | --------------------------------------------------------- |
| GET    | `/ride-plans`                                       | ride-plan catalog and pricing rules                       |
| GET    | `/contracts`                                        | contract catalog                                          |
| GET    | `/user-contracts/self`                              | user's contracts                                          |
| GET    | `/user-contracts/take-self-effect`                  | active/running contract and activated/next plan           |
| POST   | `/user-contracts/do-self-contract-tasks`            | perform pending contract tasks                            |
| POST   | `/user-contracts/pay-unpaid-bill-by-user`           | settle unpaid items                                       |
| GET    | `/coupons`                                          | coupon catalog                                            |
| GET    | `/user-coupons/self`                                | user's coupon instances                                   |
| GET    | `/transaction-logs/get-card`                        | tokenized card summaries                                  |
| GET    | `/transaction-logs/get-transaction-logs-by-account` | transaction history                                       |
| GET    | `/payment-records/self/null`                        | payment records; null segment and empty response observed |

### Content, policy, missions and notifications

| Method | Path                                    | Observed purpose                   |
| ------ | --------------------------------------- | ---------------------------------- |
| GET    | `/announcements`                        | announcements and linked resources |
| GET    | `/notifications/self-notification-list` | personal notification list         |
| GET    | `/oloo-options`                         | feature/configuration options      |
| GET    | `/oloo-options/app-config`              | app configuration                  |
| GET    | `/terms/latest`                         | latest terms                       |
| GET    | `/privacies/latest`                     | latest privacy policy              |
| GET    | `/user-flexible-mission/get-self`       | flexible missions                  |
| GET    | `/user-coupons/self`                    | user coupon state                  |

### Client activity and position

| Method | Path                                        | Request fields observed             | Notes                                                  |
| ------ | ------------------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| POST   | `/user-action/record-guest-action`          | `type`, `event`, `ts`, `deviceImei` | analytics; captured payloads can be sensitive          |
| POST   | `/user-action/record-user-action-with-auth` | `type`, `event`, `payload`, `ts`    | analytics; never forward rich route objects from oluwu |
| POST   | `/user-status-log/self/location`            | `latitude`, `longitude`, `status`   | location/status update                                 |
| POST   | `/user-status-log/self/tracking`            | `latitude`, `longitude`, `ts`       | active tracking, approximately 1 Hz in capture         |

### Realtime

| Method        | Path            | Observed purpose                                      |
| ------------- | --------------- | ----------------------------------------------------- |
| WebSocket GET | `/wss/?token=…` | realtime connection; ten 101 handshakes were captured |

## Core response models

The types below intentionally omit provider secrets and unrelated account PII. Nullability is conservative because one capture cannot establish a complete schema.

```ts
export interface ScooterInfo {
	id: number;
	imei: string;
	EngineLicenseNumber: string;
	VehicleModel: string;
	isActive: boolean;
	AvailableDistance: number | null;
	AvailableTravelTime: number | null;
	accountId: number | null;
	lastRentalStartedAt: string | null;
	lastPowerOffAt: string | null;
	scooterRentalStationId: number | null;
	scooterRentalLogId: number | null;
}

export interface ScooterStatus {
	imei: string;
	latitude: number | string | null;
	longitude: number | string | null;
	power: number;
	lockStatus: boolean | null;
	gsm: number | string | null;
	chargeStatus: boolean | null;
	errorMsg: string | null;
	warningStatus: unknown;
	faultStatus: unknown;
	speed: number | null;
	gpsNumber: number | null;
	hdop: number | null;
	timeStamp: string | number | null;
	updatedAt: string;
}

export interface Station {
	id: number;
	name: string;
	stationNumber: string;
	address: string;
	latitude: number;
	longitude: number;
	totalParkingSpace: number;
	isActive: boolean;
	isOpening: boolean;
	stationType: string;
}

export interface ReservationSummary {
	type: string;
	scootersInfoId: number | null;
	vehiclesInfoId: number | null;
	createdAt: string;
	expired: string;
}

export interface BillSummary {
	rentalCost: number;
	onCost: number;
	offCost: number;
	totalDuration: DurationParts;
	rentalDurationCeilMin: number;
	rentalStartedAt: string;
	rentalEndedAt: string;
	engineLicenseNumber: string;
	imei: string;
	initialStation: Station | null;
	returnStation: Station | null;
	returnType: string;
	scooterRentalLogId: number;
	isSpecialReturnWithoutAnyPayment: boolean;
}

export interface DurationParts {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
	milliseconds: number;
}
```

## oluwu public DTO

The browser should receive a reduced, joined record instead of raw upstream objects:

```ts
export interface PublicScooter {
	id: number;
	label: string;
	model: string;
	stationId: number | null;
	position: { latitude: number; longitude: number } | null;
	positionAgeSeconds: number | null;
	batteryPercent: number | null;
	estimatedRangeKm: number | null;
	availability: "available" | "unavailable" | "in_use" | "unknown";
	reasons: AvailabilityReason[];
	updatedAt: string;
}

export interface AvailabilityReason {
	code: "in_use" | "inactive" | "low_battery" | "hardware" | "communication" | "location" | "reserved" | "unknown";
	confidence: "upstream" | "strong" | "inferred";
}
```

Never forward IMEI, BLE address/key material, ICCID, device mobile number, controller serial, raw user account IDs, or raw error payloads to the PWA.

## Error and mutation requirements

oluwu should normalize upstream errors as:

```json
{
	"error": {
		"code": "UPSTREAM_REJECTED",
		"message": "目前無法完成操作",
		"retryable": false,
		"requestId": "opaque-id"
	}
}
```

Every state-changing route must require an authenticated session, verify ownership/current-ride state, accept an idempotency key, store a redacted audit record, time out upstream calls, and reconcile state after an ambiguous network failure. The UI must not infer success from a disconnected request.

## Reproducible inventory

Run the redacting inventory tool against the supplied HAR:

```sh
pnpm research:har
```

It emits method, normalized path, count, statuses, query names, request-field names, and response shape. JWT path segments and numeric IDs are normalized; raw values are never printed.
