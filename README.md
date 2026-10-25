# oluwu

一個把電量、定位、可借原因與騎乘成本說清楚的第三方 oloo Web/PWA client。

目前已完成研究文件與第一個清單優先的行動版 PWA 原型：

- [API 文件](docs/api/observed-api.md)
- [APK、HAR、舊報告研究](docs/research/oloo-client-research.md)
- [產品、流程與架構規格](docs/product/product-and-architecture.md)
- [視覺實作 QA](design-qa.md)

本機啟動：

```sh
pnpm install
pnpm dev
```

Web 預設為 `http://127.0.0.1:5173`，API 為 `http://127.0.0.1:8787`。前端會從 Fastify 的 `/v1/map/scooters` 讀取安全示範資料。Email 登入、借車與還車在取得並驗證上游協定以前維持停用；所有上游 token 都必須留在後端，不能放進 PWA。

PostgreSQL 初始 schema 位於 `apps/api/sql/001_initial.sql`。複製 `apps/api/.env.example` 為本機 `.env` 後再填入資料庫連線；不要提交實際帳密或 oloo token。

重新產生已遮蔽敏感值的 HAR inventory：

```sh
pnpm research:har
```

`research/` 只放本機研究素材，不會提交版本控制。請勿把 oloo token、HAR、帳密或原始回傳資料放進前端程式、文件或 commit。
