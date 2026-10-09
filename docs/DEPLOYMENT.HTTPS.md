# HTTPS 部署

HTTPS（加密的浏览器通信）用于正式部署。TLS（连接加密协议）可在统一入口 nginx 终止，内部管理宿主仍用 HTTP；不要求每个服务单独加载证书。示例域名 `portal.example.test`，证书路径必须替换为实际受控证书，不把私钥提交仓库。

## 构建和登记

Web 1.0.0 对应 Management 2.0.0 / Core 2.1.0。设置公共客户端标识 `VITE_LIMITER_PKCE_CLIENT_ID=limiter-management-web-pkce`，执行 `pnpm install --frozen-lockfile`、`pnpm build`，把 `dist` 内容部署到 `/srv/www/app/limiter-management/`。

身份系统登记 PUBLIC（没有Secret的浏览器客户端），启用 authorization_code 授权码和 S256 PKCE（一次性校验保护授权码交换），回调精确为 `https://portal.example.test/app/limiter-management/oauth-callback`，scope 为 `openid profile`。门户入口 `https://portal.example.test/app/limiter-management/`，子应用名 `limiter-management`、路由前缀 `/app/limiter-management`、API前缀 `/api/limiter`，菜单 `/policies`。域名、端口、协议不一致会使回调或issuer（令牌签发者标识）校验失败。

## 网关示例

合并本应用规则到已有门户 nginx，不覆盖既有身份路由。身份 `/oauth2/authorize` 和 `/oauth2/token` 使用同源现有身份反代；不是业务管理接口。示例内部宿主 `limiter-management:8080`：

```nginx
server {
    listen 80;
    server_name portal.example.test;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name portal.example.test;
    ssl_certificate /etc/nginx/tls/portal.fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/portal.key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    root /srv/www;

    location /app/limiter-management/ {
        try_files $uri /app/index.html;
    }
    location /api/limiter/ {
        proxy_pass http://limiter-management:8080/api/;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

统一门户集成形态：深链与刷新回退到门户壳 `/app/index.html`（壳按当前地址重新挂载子应用，侧边栏常驻），与既有门户子应用一致；不要回退到子应用自身 index.html。

后端仅信任已配置的网关转发头，不向公网开放绕过网关的管理端口。Management属性前缀 `io.github.surezzzzzz.sdk.limiter.redis.smart.management` 设置 `enable=true`、`mode=portal`、`api.enable=true`、`ui.enable=false`，不配置旧固定token；公共资源链enabled，protectedPaths包含精确 `/api/v1/policy/**`，permitAllPaths为空，宿主安装人员与机器两个验证Provider。验证客户端密钥仅留宿主受控配置。

## 验收和故障定位

先核验证书链可信、域名匹配和同源S256可用；不以关闭证书校验作为修复。再核对人员授权回调、业务 JSON、精确权限和服务DATA（允许访问的数据范围）。API返回HTML先查 `/api/limiter/` 改写；401查issuer、audience（令牌目标）和验证客户端配置，不能反复授权掩盖验证错误；403检查PAGE/API/DATA，409检查行版本。网关日志不记录 Authorization、Cookie、授权码或完整请求体。

验收管理员完整创建/更新/启停/删除、只读和无PAGE账号、跨服务范围、机器快照条件缓存及撤权拒绝。Web受控浏览器测试只验证界面与请求契约，不代表真实身份/机器双来源验收通过。
