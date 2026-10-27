# Changelog 1.0.3

## 变更

- 将可信应用入口与 API 的 `targetOrigin` 统一指向 Limiter 自有 Nginx。
- 将业务 Nginx 纳入 Portal Gateway 上游网络，Management Server 端口保持内部可达。
- 将入口文件、静态资源、业务 API 和深链刷新规则更新为独立 Nginx 拓扑。
- 将接入与部署文档统一到 Management `2.2.0`、Core `2.3.0` 的版本组合。

## 兼容性

- Spring Boot `2.7.9`，Java `8`。
- 统一门户入口仍为 `/app/limiter-management/`，业务 API 公共前缀仍为 `/api/limiter/`。
