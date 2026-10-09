# HTTP 部署

适用于受控网络或本机测试的明文 HTTP。访问令牌会以明文在网络上传输，不用于公网、跨不可信网络或包含敏感策略的生产部署。示例使用 `portal.example.test`；身份服务、管理宿主和 Web 位于同一个浏览器访问入口。

## 固定配置

Web 1.0.0 对应 Management 2.0.0 / Core 2.1.0。构建前设置 `VITE_LIMITER_PKCE_CLIENT_ID=limiter-management-web-pkce`，执行 `pnpm install --frozen-lockfile` 与 `pnpm build`，把 `dist` 的内容放到 `/srv/www/app/limiter-management/`。不要在 Web 设置 Secret（服务端密钥）。

身份系统登记公共 S256 PKCE（一次性校验保护授权码交换）客户端，回调为 `http://portal.example.test/app/limiter-management/oauth-callback`，授权 scope 为 `openid profile`。门户子应用名 `limiter-management`，入口 `http://portal.example.test/app/limiter-management/`，routePrefix `/app/limiter-management`，apiBase `/api/limiter`，菜单 `/policies`。

浏览器使用 WebCrypto（浏览器原生安全摘要）生成 S256，普通 HTTP 域名不是安全上下文，浏览器可能禁用该能力。**本机 HTTP 仅用浏览器认可的 loopback 地址（如 `127.0.0.1`），远程 HTTP 若浏览器无 WebCrypto 则必须改为 HTTPS，不建议关闭浏览器安全限制。** 回调、授权客户端与访问地址必须同步替换为实际同一 origin（协议、域名和端口）。

## 网关示例

以下仅为本应用 location（按路径匹配的反向代理规则），合并到已有门户 nginx，不覆盖门户或身份系统其他配置。示例内部管理服务地址 `limiter-management:8080`，文件根 `/srv/www`。

```nginx
server {
    listen 80;
    server_name portal.example.test;
    root /srv/www;

    location /app/limiter-management/ {
        try_files $uri /app/index.html;
    }
    location /api/limiter/ {
        proxy_pass http://limiter-management:8080/api/;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    # /oauth2/authorize 与 /oauth2/token 沿用同源身份网关，不能落入上面的业务路径。
}
```

统一门户集成形态：深链与刷新回退到门户壳 `/app/index.html`（壳按当前地址重新挂载子应用，侧边栏常驻），与既有门户子应用一致；不要回退到子应用自身 index.html。

宿主的 `io.github.surezzzzzz.sdk.limiter.redis.smart.management` 属性设置 `enable=true`、`mode=portal`、`api.enable=true`、`ui.enable=false`，无固定token，安装公共资源链与人员/机器 Provider（令牌验证适配）。资源链保护 `/api/v1/policy/**` 且 permitAllPaths 为空。数据库、Redis与验证Secret仅置于宿主受控配置，不写到 Web、nginx静态文件或仓库。

## 验收

确认能力 API 返回 JSON 且 Cache-Control 为 no-store，非 HTML；浏览器业务请求包含 Authorization、不含 Cookie；403 不重授权，401恢复有上限。按服务范围创建、更新、启停和删除，验证409保留表单。机器快照与人员页面分别验证，不能用其中一条成功替代另一条。HTTP转HTTPS时同步修改门户入口、授权回调与身份公开issuer（令牌签发者地址），不只改nginx端口。
