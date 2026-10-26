# olowo

一個把電量、定位、可借原因與騎乘成本說清楚的第三方 oloo Web/PWA client。

目前包含地圖優先、手機與桌機皆可用的 RWD PWA、Fastify 安全邊界與已驗證的 staging 整合：

- [API 文件](docs/api/observed-api.md)
- [olowo 公開 API](docs/api/olowo-api.md)
- [APK、HAR、舊報告研究](docs/research/oloo-client-research.md)
- [產品、流程與架構規格](docs/product/product-and-architecture.md)

## 開發

```sh
pnpm install
cp .env.example .env                           # 填 SESSION_ENCRYPTION_KEY（openssl rand -hex 32）與 Mapbox token
cp apps/api/.env.example apps/api/.env         # 同一把 SESSION_ENCRYPTION_KEY
cp apps/web/.env.example apps/web/.env.local   # Mapbox public token
docker compose up -d db                        # 本機 PostgreSQL，session 重啟 API 也不會掉
pnpm dev
```

Web 為 `http://127.0.0.1:5173`，API 為 `http://127.0.0.1:8787`。瀏覽器一律呼叫同源的 `/v1/*`（開發時由 Vite proxy，部署時由 Caddy 反向代理到 Fastify），讓 session cookie 維持 first-party。

## 部署

同一份 `compose.yaml`：

```sh
docker compose up -d --build   # db + api + web（Caddy），預設 http://localhost:8080
```

要用自己的網域時，在 `.env` 設 `SITE_ADDRESS=olowo.example.com`、`PUBLIC_ORIGIN=https://olowo.example.com`，並開放 80／443（`HTTP_PORT`、`HTTPS_PORT`），Caddy 會自動申請 HTTPS 憑證。

資料庫 schema 在 `apps/api/sql/schema.sql`，API 每次啟動都會以 `CREATE … IF NOT EXISTS` 套用；目前還沒部署過，所以沒有 migration。未設定 `DATABASE_URL` 時 API 改用記憶體（重啟即登出），只適合測試。

## 功能

前端從 `/v1/map/stations` 取得以站點分組的車況：地圖只畫站點與電子圍籬，點進車輛才標出它的定位；Email OTP、費率、目前騎乘與預估車資、借還車、還車照片與刷卡結帳、預約（保留 5 分鐘並倒數，次數依 oloo 規定一小時最多 2 次）、騎乘計時（自動歸還／歸還後重借）、騎乘紀錄與訂閱方案（列出校區可訂閱的方案與 oloo 的可否購買判斷，購買仍在官方 App）皆已接上 staging；結帳流程依 HAR 契約實作，尚未以真實付款驗證。oloo token 只存在 Fastify 記憶體或 PostgreSQL 的 AES-256-GCM 密文中，PWA 只持有 HttpOnly 的不透明 session cookie。provider token 用到一半壽命時，API 會透過 `keep-login` 自動延長；oloo 回 401 時 API 會清掉本機 session，前端回到登入畫面。

登入後，fleet adapter 會從 staging 取得車輛資訊、狀態、站點與全站預約，以全域快取共用 25 秒（同時間的多個請求只打一次上游，上游失敗時 5 分鐘內回傳上一份快照），只保留公開欄位並依站點分組後提供給前端；站點資料直接來自 oloo，所以未登入時 `/v1/map/stations` 回 `401 AUTH_REQUIRED`，前端先顯示登入；營運者若設定 `OLOO_ACCESS_TOKEN`，未登入的訪客也能看到站點（只讀）。由於 staging 本身要求 token 同時出現在 raw `Authorization` header 與 `access_token` query，Fastify 只在 server-to-server 請求中做此相容處理，永不把 token 送到瀏覽器。

常用驗證：

```sh
pnpm run build
pnpm test
```

瀏覽器測試（手機與桌機兩種 viewport）會攔截 olowo API 與 Mapbox，不會借到、歸還或預約真車。真實 staging mutation 必須使用明確指定的測試車輛。

重新產生已遮蔽敏感值的 HAR inventory：

```sh
pnpm research:har
```

`research/` 只放本機研究素材，不會提交版本控制。請勿把 oloo token、HAR、帳密或原始回傳資料放進前端程式、文件或 commit。
