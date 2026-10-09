# Smart Redis Limiter Management Web

统一应用门户中的限流策略管理页面。管理员按服务、资源与计数维度管理限流策略：查询、创建限额窗口、整体替换、启停、删除；只读人员仅有查询与详情。页面覆盖两类规则——三元组精确策略（旧形态）与多维度类型化规则（资源/IP/主体/客户/自定义五种视图）。页面不提供独立登录，不持有机器密钥，也不替代服务器的权限校验。

## 版本映射

| Web | Management Server Starter | 策略 Core | 运行基线 |
| --- | --- | --- | --- |
| 1.0.1 | 2.0.0 | 2.2.0 | Vue 3.5；后端 Spring Boot 2.7.9 / Java 8 |
| 1.0.0 | 2.0.0 | 2.2.0 | Vue 3.5；后端 Spring Boot 2.7.9 / Java 8 |

本仓仅对应服务器 `portal` 形态。`console`（后端内嵌管理台与本地管理员会话）与本仓不同时开放。运行端通过 HTTP 快照协议消费策略，与本仓不存在制品依赖。

## 规则形态与页面

每条限流规则 = 在哪个服务（serviceCode）的哪个资源（resourceCode）上，按什么维度计数，配多少额度（1–16 个时间窗口）。两类规则并存，各走各的页面与接口：

**三元组精确策略**（`/v1/policy/**`）：标识为 `serviceCode/resourceCode/subject` 三项，创建后不变。适合已按旧契约接入的服务。

| 路径 | 内容 |
| --- | --- |
| `/policies` | 四项精确筛选（服务/资源/对象/状态）、分页与详情 |
| `/policies/new`、`/policies/:id` | 新建、查看、整体替换窗口、启停、版本删除 |

**类型化规则**（`/v2/policy/**`）：标识为七字段（服务/资源/计数维度/选择器/命名空间/自定义类型/对象），支持七种计数维度与默认额度/精确对象两级选择。五种视图平铺在门户菜单，共用同一页面组件按维度分流：

| 路径 | 视图 | 计数维度 |
| --- | --- | --- |
| `/policies/resources` | 资源限流 | RESOURCE——所选资源的共享额度 |
| `/policies/ips` | IP 限流 | IP——可信入口规范化后的来源地址 |
| `/policies/subjects` | 主体限流 | USER / SERVICE / CREDENTIAL——人员、服务主体、每对凭据三段 |
| `/policies/customers` | 客户限流 | CUSTOMER——同一客户关联人员与凭据在同一资源内汇总 |
| `/policies/custom` | 自定义限流 | CUSTOM——宿主声明的业务类型（设备、渠道等） |
| `/policies/typed/new`、`/policies/typed/:id` | 类型化编辑器 | 服务与资源只能从授权目录选择；命名空间由服务目录声明，页面只展示；资源维度固定为默认额度，其余维度可选精确对象覆盖；客户对象从目录选择，其余精确对象输入稳定 ID |

类型化服务的协议模式（三元组/类型化）由服务目录声明，页面按声明分流；目录中声明为三元组的服务不出现在类型化视图。

## 构建与挂载

使用 Node.js `^20.19.0 || ^22.13.0 || >=24` 与 pnpm 9.15.4（符合 ESLint 10 的工具链下限）。构建时注入 `VITE_LIMITER_PKCE_CLIENT_ID`（身份服务登记的公共 OAuth Client ID，授权客户端标识；公共客户端没有 Secret，值不进仓库，CI 以凭据注入）。

```sh
pnpm install --frozen-lockfile
pnpm type-check
pnpm lint
pnpm test:run
pnpm build
```

部署 `dist/` 到固定地址 `/app/limiter-management/`，门户登记入口为 `/app/limiter-management/index.html`、路由前缀 `/app/limiter-management`、网关将 `/api/limiter/` 去前缀映射到管理服务器 `/api/`（深链与刷新回退到门户壳，由壳重新挂载本应用）。qiankun（门户对子页面的挂载机制）子应用名为 `limiter-management`；门户传入 `container`、`routePrefix`、同源 `apiBase`、`currentUser/getCurrentUser` 与 `theme.current/subscribe`。身份属性仅用于清理身份切换时的页面状态，不用于授予业务权限；主题由公共主题契约 1.0.4 驱动。

## 授权与调用

页面通过 S256 PKCE（用一次性校验值保护授权码交换）获取人员访问令牌；业务 API 只发送 `Authorization: Bearer ...`，不发送浏览器 Cookie。令牌与校验值只进入当前浏览器会话的 sessionStorage，不写 localStorage、日志或错误内容。授权交换最多自动补偿一次；新令牌连续被 401 拒绝时暂停自动授权，避免反复跳转。403（无权限）与 409（并发冲突）不触发重新授权。

进入页面先调能力接口取得 `pageAllowed/canWrite`；无页面权限时不调用任何列表或详情。列表按全局可写能力展示新建入口；写操作始终由服务端实时校验 API 与 DATA 权限，门户管理员标记不能授予本应用权限。

| 权限类型 | 标识 |
| --- | --- |
| PAGE（页面） | `smartLimiterPolicy:page` |
| API（业务操作） | `smartLimiterPolicy:read`、`smartLimiterPolicy:write` |
| API（运行端快照） | `smartLimiterPolicySnapshot:read` |
| DATA（数据范围） | `limiter-policy`，动作 `read/write`，维度 `serviceCode`，受限范围运算 `IN` |

五类视图共用同一 PAGE 权限码，不因视图拆分新增权限码。完整可信应用登记与验收说明见[接入手册](docs/TRUSTED_APPLICATION_ONBOARDING.md)；HTTP 与 HTTPS 网关形态见[HTTP 手册](docs/DEPLOYMENT.HTTP.md)、[HTTPS 手册](docs/DEPLOYMENT.HTTPS.md)。这些文档只含非敏感示例。

## 契约与并发

窗口格式为 `{count, window, unit}`，单位 `SECONDS/MINUTES/HOURS/DAYS`，更新为整体替换不做部分合并，规范化秒数相同的窗口不得重复。前端只接受 JavaScript 可精确表示的正整数；超出安全精度的服务端数值不会被静默舍入后写回。

类型化规则身份字段不可原地改写，改变计数归属须新建并停用旧规则；默认额度表示每个实际对象各自采用同一套限额，精确对象只整体替换该对象的限额；停用精确对象后回退默认额度，不取消其他门禁。命名空间与自定义类型以服务目录声明为准，页面不提供自由输入扩大范围。

更新、启停、删除均携带当前 `rowVersion`；409 时保留编辑内容并提示重新读取，不自动覆盖。列表与详情的网络失败明确展示错误，不显示虚假空列表。请求、授权与页面状态在身份切换或卸载时取消，旧结果不覆盖新身份。

## 验证边界

`test:run` 覆盖授权、API 响应校验、取消、旧令牌拒绝与表单边界；`test:browser` 用本机 Chrome 渲染页面与受控 API 响应，验证写流程、409、权限、16 窗口、桌面/手机布局与删除确认交互。真实身份服务、管理服务器与机器运行端的完整联调属于部署验收，不能由受控页面测试替代。
