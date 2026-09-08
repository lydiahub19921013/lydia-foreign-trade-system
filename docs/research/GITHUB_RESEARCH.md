# GitHub 项目调研（2026-09-08）

本次调研目的是找可复用的工程经验，不是寻找一个可以原样改名的“万能获客系统”。所有候选均先静态审查，未执行其爬虫、自动外联或第三方 API。

## 采用或保留接口

### gtm-flywheel

- 仓库：https://github.com/kenny589/gtm-flywheel
- 许可证：MIT
- 价值：分阶段资格审查、Fit/Intent/Engagement、信号衰减和优先队列。
- Lydia 改造：用外贸询盘证据、需求清晰度、购买准备度和信任基础重写；不照搬固定权重。

### b2b-sdr-agent-template

- 仓库：https://github.com/iPythoning/b2b-sdr-agent-template
- 许可证：MIT
- 价值：出口场景的分层研究和按租户隔离。
- Lydia 改造：保留人工确认和证据状态；不采用自动定时触达、WhatsApp IP 隔离等做法。

### email-sleuth

- 仓库：https://github.com/buyukakyuz/email-sleuth
- 许可证：MIT
- 价值：候选职业邮箱生成、DNS/SMTP/API 等多种验证路径和批处理接口。
- Lydia 改造：当前只做输出映射；端口 25、catch-all 域名和 SMTP 结果都可能不确定，因此不能把单一结果标为事实。

### Crawl4AI

- 仓库：https://github.com/unclecode/crawl4ai
- 许可证：Apache-2.0，包含额外归属要求
- 价值：将公司官网公开页面转为结构化证据。
- Lydia 改造：仅列为可选提供方，启用前单独核对许可证、robots/站点条款和数据出境风险。

## 只研究、不复制

### Prospex

- 仓库：https://github.com/asiifdev/business-leads-ai-automation
- 许可证：MIT
- 可借鉴：工作区、Campaign、Lead、Contact、Activity 的数据分离。
- 不采用：地区硬编码评分、脆弱的地图页面选择器以及把抓取器放在产品核心。

### Intro-Path-Discovery / 6ix-app

这两个关系路径项目没有可确认的开源许可证，不能复制代码。Lydia 只独立实现“关系强度、最近联系、共同经历、引荐同意”这些通用业务概念，并且只处理用户拥有或获授权的数据。

## 淘汰标准

- 无许可证、来源不清或夹带真实人员数据；
- GPL/AGPL 与 Lydia 预期的私有商业交付不匹配；
- 把付费远程 MCP 或特定 CRM 当成系统必需核心；
- 依赖社媒批量抓取、平台规避、自动群发或身份冒充；
- 使用地区、姓名等与购买意向无直接关系的属性评分。

## 结论

最值得复用的不是某个完整仓库，而是四个可替换能力：统一数据模型、证据型评分、公开信息适配器、经同意的关系路径。Lydia 自己持有核心模型和客户数据，第三方工具只能作为随时可替换的输入源。
