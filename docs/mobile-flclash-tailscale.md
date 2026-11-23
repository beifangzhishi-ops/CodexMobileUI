# 手机版推荐内网配置：FlClash 内置 Tailscale

> 实测记录：2026-11-21。手机使用 FlClash 的 Mihomo `tailscale` 出站，
> 同时保留普通代理。以下脚本已在实际手机配置中验证：普通代理可用，
> Tailscale 可访问私有网页入口 `http://100.76.74.124:4190`。
> **这不等于新版 CodexMobileUI Android APK 的 `:48889` 连接已完成验收。**

## 适用架构和地址

- **不需要额外安装独立的手机 Tailscale 客户端**：在支持 `type: tailscale` 的 FlClash/Mihomo 内核中创建一个 `Tailscale` 出站，并通过规则让 Tailnet 流量走它。手机应加入与 6v/noha 相同的 Tailnet；授权和设备准入由 Tailscale 管理。
- **手机版 CodexMobileUI** 的统一私网 Gateway 地址是 `http://100.76.74.124:48889`。这个入口用于发现并连接两台机器；不要把下面网页入口的端口填到手机 App 中。
- **网页端**的入口是 `http://100.76.74.124:4190`，可单独用浏览器测试 Tailscale 连通性。
- 这些是当前部署的**示例实际地址**，换了 Tailnet/设备后以对应机器的 Tailscale IPv4 为准。内网访问不应开启旧版 Funnel 公网入口，也不要暴露原生 App Server 端口。

## 推荐：在订阅的脚本覆写中合并规则

进入手机 FlClash 的**目标订阅**，添加/编辑 JavaScript 脚本覆写。若该订阅已经有 `main(config)`，请合并进原函数，**不要创建第二个 `main`**。下例保留现有 `Tailscale` 出站并追加 DNS 过滤：

```javascript
function main(config) {
  config.proxies = config.proxies || [];

  if (!config.proxies.some(p => p.name === "Tailscale")) {
    config.proxies.push({
      name: "Tailscale",
      type: "tailscale",
      hostname: "flclash-phone",
      ephemeral: false,
      udp: true,
      "accept-routes": false
    });
  }

  // 读取订阅原有过滤规则；只追加，不用空列表替换它们。
  config.dns = config.dns || {};
  const original = Array.isArray(config.dns["fake-ip-filter"])
    ? config.dns["fake-ip-filter"]
    : [];

  config.dns["fake-ip-filter"] = [
    ...new Set([
      ...original,
      "+.tailscale.io",
      "+.tailscale.com"
    ])
  ];

  return config;
}
```

**为什么一定要合并？** 第二份实际订阅本来带有 **79 条** `fake-ip-filter` 规则，其中包括 `+.big-fish.xyz`（代理节点域名）。如果在 FlClash 的「DNS → Fake-IP过滤」**图形覆写**中只填几条 Tailscale 域名，可能把订阅原来的整个过滤列表替换掉：当代理节点域名被解析为 `198.18.x.x` 时，普通梯子就可能连接超时。脚本合并后，订阅更新时会重新读取原列表，并自动去重；不必手工维护全部规则。

**设置要点**：

1. 把上面的完整脚本保存为该订阅的脚本覆写。`hostname` 可换为此手机专用的稳定名称；`ephemeral: false` 保留 Tailscale 身份状态。
2. **清除手机全局 DNS 页面中人为添加的「Fake-IP过滤」覆写项**，以免它在其他处理阶段重新替换脚本合并结果；不要删除订阅本身携带的过滤规则。保留订阅的 `fake-ip` 模式，过滤模式不要改为 `whitelist`。
3. 给 Tailscale 目的地址添加**路由规则**，使对应流量命中 `Tailscale` 出站。下面是当前 6v 单入口的**规则示例**（不是从手机实际规则导出的逐字副本）：

   ```yaml
   - IP-CIDR,100.76.74.124/32,Tailscale,no-resolve
   ```

   此规则应排在最终 `MATCH`/兜底规则之前。若希望所有 Tailnet 设备都走内置 Tailscale，也可按需考虑 `IP-CIDR,100.64.0.0/10,Tailscale,no-resolve`；但这可能影响其他使用 CGNAT 地址的目标，优先使用实际需要的 `/32` 地址。普通公网流量继续由订阅原本的节点和规则处理。
4. 重新加载 FlClash 配置，并按正常流程完成该内置 Tailscale 出站的设备授权。首次授权和 DNS/代理链路恢复可能需要重连；不要为了重试清空已正常工作的其他配置或 Tailscale 身份。

## 验收与故障排查

1. 先访问一个普通外网地址，确认**正常代理可用**，再测试浏览器 `http://100.76.74.124:4190`。
2. 在实际使用的新 APK 中，再独立测试手机版的 `http://100.76.74.124:48889`：确认机器列表、6v/noha 连接及真实消息；**网页 4190 通了不等于手机 48889 已通过**。
3. 若 Tailscale 注册一直超时、控制服务器 `controlplane.tailscale.com` 被解析为 `198.18.x.x`，检查 Tailscale 域名是否被原始过滤列表或合并脚本排除 Fake-IP，以及脚本和 DNS 覆写的执行顺序。`198.18.x.x` 本身只是 Fake-IP，不能单凭出现它就断言网络损坏；要结合实际拨号/超时日志。
4. 若 4190 能访问但普通梯子突然不能上网，优先排查**是否丢掉了订阅原来的 Fake-IP 过滤列表**。本次曾因全局覆写只剩少数条目，导致代理节点域名 `nxboom.big-fish.xyz` 被映射到 `198.18.x.x` 并超时；恢复订阅过滤规则、改用脚本追加后，两条链路都正常。
5. 若过滤生效、控制服务器已解析到真实地址但注册仍超时，再检查代理节点可用性、Tailscale 控制面出口及 `dialer-proxy`；不要在未经对照时直接修改 6v/noha 服务器或旧的正常梯子。

## 使用边界

- 本教程用于**客户端 FlClash 配置**，不修改项目 Gateway/App Server、6v/noha 现有 Tailscale Serve、系统代理或 Windows DNS。
- `4190` 网页和 `48889` Gateway 在 Tailnet 内可达；只授权可信设备，并保持 Tailnet ACL 与设备准入控制。它们**不应**因为本教程而开放到公网。
- 此文档记录用户实际验证的 FlClash/Tailscale 共存方案。其他手机型号、订阅或 Mihomo 内核版本可能有不同的脚本执行顺序，按最终生效配置和日志验证。
