# oluwu

一個把電量、定位、可借原因與騎乘成本說清楚的第三方 oloo Web/PWA client。

目前已完成研究階段：

- [API 文件](docs/api/observed-api.md)
- [APK、HAR、舊報告研究](docs/research/oloo-client-research.md)
- [產品、流程與架構規格](docs/product/product-and-architecture.md)

重新產生已遮蔽敏感值的 HAR inventory：

```sh
pnpm research:har
```

`research/` 只放本機研究素材，不會提交版本控制。請勿把 oloo token、HAR、帳密或原始回傳資料放進前端程式、文件或 commit。
