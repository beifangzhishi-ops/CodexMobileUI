# Windows 电脑内网配置：独立 Tailscale + FlClash DNS

> 实测记录：2026-11-23，6v。用户确认在 **FlClash 内配置 DNS 后**，原本经 FlClash 无法访问的 Tailnet HTTPS 入口可以正常访问。本文记录已验证的使用思路及配置示例；不要求修改 Windows 系统代理、环境变量、系统 DNS 或 Tailscale Serve。
>
> **不要直接复制手机的 `type: tailscale` 脚本到桌面版 FlClash。** 用户已实际尝试，当前桌面版提示「不支持的代理」。这是此次安装环境中的兼容性现象，不代表所有 Mihomo 版本都永久不支持此类型。

## 与手机版的根本区别

| 项目 | Windows 电脑（6v） | Android 手机 |
| --- | --- | --- |
| Tailscale 实现 | **Windows 独立 Tailscale 客户端**，已连接 Tailnet | **FlClash/Mihomo 内置 `type: tailscale` 出站**，不单独启动手机 Tailscale 客户端 |
| FlClash 的职责 | 普通公网代理 + **为 Tailnet 域名指定 DNS**；Tailnet 流量由系统 Tailscale 接管 | 普通公网代理 + **Tailscale 出站和目标 IP 分流** |
| 关键配置 | DNS `nameserver-policy` 指向 `100.100.100.100` | 订阅 JavaScript 脚本追加出站及 Fake-IP 过滤；再添加 `IP-CIDR` 路由规则 |
| 脚本可否直接复用 | **不可照搬**；实际测试桌面报「不支持的代理」 | 已在手机验证该出站类型和脚本合并方法 |

手机的完整脚本、保留原订阅 79 条 Fake-IP 过滤规则的方法及踩坑记录，见 [手机 FlClash 内置 Tailscale 配置](mobile-flclash-tailscale.md)。

## 电脑端的 DNS 方法（用户已确认成功）

1. 先保证 Windows 上原有的 **Tailscale 客户端已登录并连接正确的 Tailnet**。这里不在 FlClash 中创建第二个 Tailscale 出站，也无需移植手机脚本。
2. 在 FlClash 的 **工具 → 进阶配置 → DNS → Nameserver Policy（域名服务器策略）**（各版本显示位置可能略有不同）为 Tailnet 域名指定 Tailscale DNS `100.100.100.100`。
3. 对当前 Tailnet 的对应示例为：

   ```yaml
   dns:
     nameserver-policy:
       "+.tail7c23f0.ts.net": 100.100.100.100
   ```

   这是配置结构示例；**在 FlClash 的 DNS 设置中只添加/合并对应条目，不要用这段简化 YAML 覆盖整份订阅或已有 DNS 设置**。若其他域名已有专用 DNS 规则，全部保留。
4. 如果仍遇到 `198.18.x.x` Fake-IP 解析结果或握手异常，可再检查 **DNS → Fake-IP 过滤**，将 `+.tail7c23f0.ts.net` 作为排除项；这属于**可选排障手段**，不是此次用户单独确认的必需步骤。注意 FlClash 图形 DNS 覆写可能替换原订阅的整份过滤列表，**不可把已有过滤规则清空**。
5. 在保持 FlClash 和 Tailscale 都运行的情况下，打开当前私网入口：`https://cpa-node.tail7c23f0.ts.net:4190/`。这是 **Tailnet-only HTTPS Serve**，不是公网 Funnel；电脑版 CodexMobileUI 默认使用此网址。

### 为什么光有 `DIRECT` 规则仍可能不行？

2026-11-23 的排查中，6v FlClash 的有效规则**第一条已经是**：

```yaml
- DOMAIN-SUFFIX,tail7c23f0.ts.net,DIRECT
```

但经 FlClash HTTP 代理访问新 HTTPS 4190 时，代理 `CONNECT` 返回 200，**随后的 TLS 握手超时**；完全绕过 FlClash 的直接访问则返回 HTTP 200 且证书验证成功。Tailscale DNS `100.100.100.100` 可将 `cpa-node.tail7c23f0.ts.net` 解析为 `100.76.74.124`。用户随后反馈**改用 DNS 配置已成功**。

这说明在此次环境下，仅有域名 `DIRECT` 规则不够，需同时检查 DNS；但不能单凭超时就断言根因必然是 Fake-IP。`DIRECT` 决定出站方向，`nameserver-policy` 决定指定域名的解析服务器，两者不是一回事。

## 验收及限制

- 用 Windows 上的浏览器在 **FlClash 正常开启**时访问 `https://cpa-node.tail7c23f0.ts.net:4190/`，同时确认普通代理仍能联网；不要只靠无代理的 `curl --noproxy '*'` 成功就认定 FlClash 路径已通过。
- 如需单独验证 Tailscale DNS，可运行 `Resolve-DnsName cpa-node.tail7c23f0.ts.net -Server 100.100.100.100 -Type A`；此测试只能验证解析，不代表 HTTP/HTTPS 一定可达。
- 电脑侧使用的是**系统已有 Tailscale 网络接口**，所以把手机 `type: tailscale` 出站配置粘进桌面 FlClash 并不能替代它；目前已实测该操作报「不支持的代理」。
- 这次最终采用的是 **FlClash 内部 DNS 方案**，不采用 Windows 系统代理绕过名单、用户级 `NO_PROXY` 或系统 DNS 修改。排障中尝试过的这些系统级改动已按要求全部回退并验证。
- 手机仍要单独验证正在使用的 APK 的连接方式。旧版使用 `http://100.76.74.124:48889` 作为 Gateway 发现入口；更新源码已将 Web Coordinator 指向私有 HTTPS 4190，不能以电脑网页成功替代手机端实测。

Mihomo 官方 DNS 字段参考：<https://wiki.metacubex.one/en/config/dns/>。

## 2026-11-23 final two-PC configuration (verified 2026-11-24)

Both 6v and noha run FlClash 0.9.4+2026111907 with identical DNS-only subscription override scripts. Keep routing in the graphical rules editor (not in the script); add the following rule before MATCH: `DOMAIN-SUFFIX,tail7c23f0.ts.net,DIRECT`. Use the existing Windows Tailscale client. The script merges the DNS policy and Fake-IP exclusions without replacing existing subscription entries. Do not replace the whole DNS list in the graphical editor.

```javascript
function main(config) {
  // Merge Tailnet DNS into the subscription without replacing its DNS settings.
  const dns = config.dns && typeof config.dns === "object" && !Array.isArray(config.dns)
    ? config.dns
    : {};
  config.dns = dns;

  const policy = dns["nameserver-policy"];
  dns["nameserver-policy"] = {
    ...(policy && typeof policy === "object" && !Array.isArray(policy) ? policy : {}),
    "+.tail7c23f0.ts.net": "100.100.100.100"
  };

  const original = Array.isArray(dns["fake-ip-filter"]) ? dns["fake-ip-filter"] : [];
  dns["fake-ip-filter"] = [...new Set([
    ...original,
    "+.tailscale.io",
    "+.tailscale.com",
    "+.tail7c23f0.ts.net"
  ])];

  return config;
}
```

Both generated configs contain the Tailnet nameserver-policy and DIRECT rule; both use fake-ip / blacklist. At the read-only check on 2026-11-24, noha also contained the Tailnet domain in its effective fake-ip-filter, while 6v did not, despite matching scripts. If connectivity fails, check the active subscription override and whether another graphical DNS override replaces its merged filter; reload through the normal UI and recheck. No client configuration was changed in this documentation pass.
