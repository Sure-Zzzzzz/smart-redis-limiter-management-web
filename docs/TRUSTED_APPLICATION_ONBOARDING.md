# 限流管理可信应用接入

本页面以 Portal（统一门户中的业务子页面）接入，管理宿主运行 `smart-redis-limiter-management-starter:2.0.0` 和 `smart-redis-limiter-core:2.2.0`，Web 为 1.0.0。管理宿主仍为 Spring Boot 2.7.9 / Java 8。本手册示例域名 `portal.example.test` 需替换为部署域名，不填写真实密钥到本仓。

## 注册值

在身份系统的可信应用配置页面登记应用编码 `limiter-management`、显示名“限流策略”、微前端名 `limiter-management`、入口 `https://portal.example.test/app/limiter-management/index.html`（页面入口文件形式，与既有门户子应用一致）、路由前缀 `/app/limiter-management`。门户菜单为五个平铺入口：资源限流 `/policies/resources`、IP 限流 `/policies/ips`、主体限流 `/policies/subjects`、客户限流 `/policies/customers`、自定义限流 `/policies/custom`；默认入口落在资源限流。五入口共用菜单权限 `smartLimiterPolicy:page`，不新增权限码。`deploy/iam/portal-registration.example.json` 是这些登记值的对照模板，不是身份服务器批量导入 API 请求体。

登记公共 OAuth Client（浏览器用来发起授权的客户端）`limiter-management-web-pkce`，启用授权码流程及 S256 PKCE（一次性验证码保护授权码交换），回调只登记实际地址 `https://portal.example.test/app/limiter-management/oauth-callback`，scope 为 `openid profile`。公共客户端不能设置 Secret。构建环境 `VITE_LIMITER_PKCE_CLIENT_ID` 必须使用同一客户端 ID。HTTP 部署用同一 HTTP 域名与回调，不能混用 HTTP/HTTPS 或不同端口。

## 三权登记

PAGE 是页面权限；API 是接口操作权限；DATA 是允许读写的数据范围。三者不能互相替代：

| 类型 | 登记值 |
| --- | --- |
| PAGE | `smartLimiterPolicy:page` |
| API 查询 | `smartLimiterPolicy:read` |
| API 写入 | `smartLimiterPolicy:write` |
| API 运行端快照 | `smartLimiterPolicySnapshot:read` |
| DATA | 资源 `limiter-policy`、动作 `read/write`、维度 `serviceCode`、受限运算符 `IN` |

按部门、组织或用户组等稳定关系配置应用准入，不逐个人 ID 硬编码。只读人员授 PAGE、查询 API 和 `read` 服务范围；管理员增加写 API 和 `write` 服务范围，写权限不隐含读权限。机器运行端仅授快照 API 与 DATA read，不授 PAGE。继承人员权限的用户凭据即使主体是 HUMAN（人员）也不因 API 调用额外要求 PAGE；Web 本身仍检查 PAGE。`deploy/iam/permission-catalog.json` 是权限清单，不是默认全量授权。

## 宿主和网关

管理宿主属性前缀为 `io.github.surezzzzzz.sdk.limiter.redis.smart.management`，明确配置 `enable=true`、`mode=portal`、`api.enable=true`、`ui.enable=false`，不配置旧固定策略 token。宿主显式安装公共 Resource Server（业务 API 的统一验证入口）与人员/机器两个 Provider（各自令牌验证适配），管理模块不认识具体身份或凭据服务实现。DATA 权限注解链由 `simple-data-permission-spring-mvc-starter` 提供，宿主依赖需显式包含（公共 Resource Server 不传递它）。公共资源链 enabled、`protectedPaths` 包含精确 `/api/v1/policy/**` 与 `/api/v2/policy/**`，该资源链的 `permitAllPaths` 为空。机器和人员验证配置只在宿主服务端，不能进入 Web。

浏览器公共 PKCE 客户端与宿主 Resource 的服务端验证客户端是不同用途：前者没有 Secret、只能换取人员访问令牌；后者由宿主服务端持有验证配置，不能混用客户端 ID、密钥或回调。Portal 登记的目标应用与宿主验证的目标应用、权限目录必须一致，不能用门户管理员标记绕过准入或三权。各 Provider 的验证配置以其已发布接入契约为准，本仓不虚构验证字段或默认注册值。

所属人授权反查 reader（供机器凭据服务读取用户授权的内部适配）属于凭据协作宿主内部。Management 与 Web 不新增 reader，不在浏览器请求反查，不知道所属人投影的内部 ID。

浏览器业务路径 `/api/limiter/v1/policy/**` 与 `/api/limiter/v2/policy/**` 必须被网关去前缀转为管理宿主 `/api/v1/policy/**` 与 `/api/v2/policy/**`，不能返回 SPA（单页面应用）HTML；`/app/limiter-management/` 的深链与刷新回退到门户壳，不回退子应用自身。浏览器业务请求仅使用 Bearer（HTTP头中的访问令牌），`credentials: omit` 禁止附带 Cookie。身份授权和令牌交换 `/oauth2/authorize`、`/oauth2/token` 走同源身份网关，不改写为管理路径。

## 服务目录

类型化规则（资源/IP/主体/客户/自定义五视图）的服务、资源、维度与命名空间来自宿主目录声明，最小形态在宿主配置 `management.typed.services` 中维护（服务编码、资源到维度的映射、各维度命名空间、自定义类型、静态对象目录与策略代次）。一个服务只能属于一种形态：类型化服务不出现在三元组接口，三元组服务的类型化操作返回 409。

服务清单的组织事实以身份系统为权威时，宿主可提供一个 `SmartRedisLimiterDirectoryProvider` Bean 覆盖配置式实现：以 AKP（服务型凭据）最小授权调用 IAM 的应用与目录开放读接口（`iam:open-application:read`、`iam:open-directory:read`）拉取服务清单与客户（部门根）事实，与本地静态声明按交集合并——服务清单 = IAM 准入中的应用 ∩ 本地声明；资源、维度、命名空间与策略代次仍以本地声明为准；客户与人员对象来自身份事实。目录实现须本地缓存并保留 last-known-good，IAM 不可达时降级为仅静态声明的服务，不向终端用户报错。

## 机器运行端接入

引了 limiter 组件的服务（限流运行端宿主）按以下五步接入 Management；人员走门户页面，机器走本节链路，两者互不替代。

1. **发凭据**：在凭据管理面为消费服务创建 AKP（服务型凭据），密钥经环境变量或 secret manager 注入，不进配置仓库。
2. **配授权**（在凭据管理面手工填清单）：目标应用 `limiter-management`，API 权限仅 `smartLimiterPolicySnapshot:read` 一个码，DATA 授权文档 JSON 如下（机器只读自己服务的策略快照，不给业务 read/write，不给 PAGE）：

   ```json
   {"protocol":"simple-data-permission","version":"1.0",
    "grants":[{"resource":"limiter-policy","actions":["read"],"all":true,"constraints":[]}]}
   ```

3. **引依赖**（Spring Boot 2 运行端示例）：

   ```gradle
   implementation 'io.github.sure-zzzzzz:smart-redis-limiter-starter:2.2.1'
   implementation 'io.github.sure-zzzzzz:smart-redis-limiter-management-aksk-resttemplate-client-starter:1.0.0'
   ```

   传输件复用 AKSK 底座的 `akskClientRestTemplate`（认证+连接池+超时随底座）；缺底座 Bean 时启动即失败，不静默降级。Spring Boot 3 运行端使用 jakarta 变体传输件。
4. **配置**（凭据经环境变量注入）：

   ```yaml
   io.github.surezzzzzz.sdk.limiter.management.client:
     enable: true
     policy-snapshot-url: https://portal.example.test/api/v1/policy/snapshot
     typed-policy-snapshot-url: https://portal.example.test/api/v2/policy/snapshot
   ```

   URL 填网关地址；服务编码默认取运行端 `smart.me`，无需重复声明。
5. **运行行为**：客户端以 AKP 换 Bearer 令牌拉取本服务快照，携带 `If-None-Match`（未变更回 304 零流量）；revision 变化后按新窗口执行；首次无快照执行本地限额兜底；拉取失败保留 last-known-good 继续使用，不用失败结果覆盖有效策略。

最小授权原则：快照读取是机器消费的全部需求；撤销 AKP 或收回 `snapshot:read` 后，快照请求即被拒绝（见验收第 5 条）。

## 完整验收

1. 人员从门户进入策略页，能力接口返回 no-store（禁止缓存）的 `pageAllowed/canWrite`，列表只出现授权服务，列表总数与范围一致。
2. 管理员创建策略、整体更新窗口、停用/启用并删除；每次写入携带当前行版本，409（版本冲突）保留编辑而不自动覆盖。
3. 只读人员无写命令且服务端拒绝直接写；无 PAGE 人员不发起列表/详情请求；范围外主键不可见，403 不触发重新授权。
4. 机器凭据读取自己服务快照，条件缓存 304（未变更）仍先经过 DATA 校验；限流运行端消费 revision（服务策略版本）后按新窗口执行。
5. 撤销人员或机器准入/权限后，等待宿主声明的授权缓存期限，人员业务 API 与机器快照都拒绝，不凭门户隐藏菜单代替服务端验收。

身份切换、子应用卸载、过期令牌、新令牌立即被拒和授权码重复使用都必须验证不会反复跳转或跨身份保留数据。受控浏览器响应测试不代表以上真实双来源链路已验收。
