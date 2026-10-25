# oluwu

一個把電量、定位、可借原因與騎乘成本說清楚的第三方 oloo Web/PWA client。

目前包含可安裝的清單優先 PWA、Fastify 安全邊界與已驗證的 staging 整合：

- [API 文件](docs/api/observed-api.md)
- [oluwu 公開 API](docs/api/oluwu-api.md)
- [APK、HAR、舊報告研究](docs/research/oloo-client-research.md)
- [產品、流程與架構規格](docs/product/product-and-architecture.md)
- [視覺實作 QA](design-qa.md)

本機啟動：

```sh
pnpm install
pnpm dev
```

Web 預設為 `http://127.0.0.1:5173`，API 為 `http://127.0.0.1:8787`。前端從 Fastify 的 `/v1/map/scooters` 取得已過濾的車輛資料；Email OTP、費率、目前騎乘、借還車、立即／定時預約與騎乘計時排程皆已接上 staging。所有上游 token 只存在 Fastify 記憶體或 PostgreSQL 的 AES-256-GCM 密文中，PWA 只持有 HttpOnly 的不透明 session cookie。

PostgreSQL migrations 位於 `apps/api/sql/`。依序套用 `001_initial.sql`、`002_persist_provider_sessions.sql`、`003_persist_scheduled_actions.sql`，複製 `apps/api/.env.example` 為本機 `.env`，並產生一組 32-byte hex `SESSION_ENCRYPTION_KEY`；不要提交實際帳密、key 或 oloo token。未設定資料庫時會使用適合本機開發的記憶體 session 與排程。

登入後，fleet adapter 會從 staging 取得車輛資訊與狀態、快取 25 秒、只保留附近 24 台的公開欄位，再提供給前端；未登入且沒有 `OLOO_ACCESS_TOKEN` 時使用 demo fleet。由於 staging 本身要求 token 同時出現在 raw `Authorization` header 與 `access_token` query，Fastify 只在 server-to-server 請求中做此相容處理，永不把 token 送到瀏覽器。

常用驗證：

```sh
pnpm run build
pnpm test
```

瀏覽器測試會攔截 API mutation，不會借到、歸還或預約真車。真實 staging mutation 必須使用明確指定的測試車輛。

重新產生已遮蔽敏感值的 HAR inventory：

```sh
pnpm research:har
```

`research/` 只放本機研究素材，不會提交版本控制。請勿把 oloo token、HAR、帳密或原始回傳資料放進前端程式、文件或 commit。
