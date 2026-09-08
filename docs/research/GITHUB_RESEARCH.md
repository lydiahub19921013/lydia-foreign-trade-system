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
- Lydia 改造：保留可选结构化结果适配器；另以 Lydia 自有代码实现更轻量的“用户指定单页”采集，只读取公开/获授权页面并将所有官网自述保留为候选证据。没有复制 Crawl4AI 代码，也不遍历整站。

### codex-first-customer-finder-skill

- 仓库：https://github.com/Kappaemme-git/codex-first-customer-finder-skill
- 固定版本：`943c455bdfc40da46265b01b3c1f41e4bb386f27`
- 许可证：MIT
- 价值：从明确需求、痛点/替代、产品匹配、近期变化和公开可联系性寻找第一批客户；要求回到原始公开页面，不能只引用搜索摘要。
- Lydia 改造：重新实现为外贸产品/市场/买家类型搜索计划，以及需求 25%、产品匹配 25%、时机 20%、公开可联系性 15%、证据质量 15% 的可解释候选分。未核查原页或缺引用信号一律封顶 49 分，不复制其品牌、样例或报告内容。

### mcp-searxng / kindly-web-search-mcp-server

- 仓库：https://github.com/ihor-sokoliuk/mcp-searxng ，固定版本 `4ada34fd4e98556743887bdbda1d152673be5481`，MIT。
- 仓库：https://github.com/Shelpuk-AI-Technology-Consulting/kindly-web-search-mcp-server ，固定版本 `c4044b1e5e35fa680b93e69732909c839a809775`，MIT。
- 价值：展示了搜索提供方适配层、输入限制、失败隔离和多提供方切换方式。
- Lydia 决定：不捆绑这些成熟 MCP 代码库，只保留小型 provider-neutral 接口。当前通过本机 agent-reach 可选调用 Exa，同时保留 JSON/CSV 导入作为无提供方退路。

## 只研究、不复制

### Prospex

- 仓库：https://github.com/asiifdev/business-leads-ai-automation
- 许可证：MIT
- 可借鉴：工作区、Campaign、Lead、Contact、Activity 的数据分离。
- 不采用：地区硬编码评分、脆弱的地图页面选择器以及把抓取器放在产品核心。

### Intro-Path-Discovery / 6ix-app

这两个关系路径项目没有可确认的开源许可证，不能复制代码。Lydia 只独立实现“关系强度、最近联系、共同经历、引荐同意”这些通用业务概念，并且只处理用户拥有或获授权的数据。

### 本轮未采用项目

- [SearXNG](https://github.com/searxng/searxng)，固定版本 `3e454637fb9829756c805dd9c02100f0bc9520fd`，AGPL-3.0：可作为使用者自行部署的外部服务研究，但不进入 Lydia 默认私有产品。
- [OpenOutreach](https://github.com/eracle/OpenOutreach)，固定版本 `b8bb2e36c0b30ff885bd5899d43b27bdad7ee3bd`，GPL-3.0：许可证与自动邮件工作流都不符合当前边界，不引入。
- [google-maps-scraper](https://github.com/omkarcloud/google-maps-scraper)，固定版本 `a8d55b64d233de65cbb03d4c9660fa831423b441`，MIT：虽许可证兼容，但依赖地图页面抓取并强调批量 lead generation，平台稳定性、访问条款与证据质量不适合作为 Lydia 核心。

## 淘汰标准

- 无许可证、来源不清或夹带真实人员数据；
- GPL/AGPL 与 Lydia 预期的私有商业交付不匹配；
- 把付费远程 MCP 或特定 CRM 当成系统必需核心；
- 依赖社媒批量抓取、平台规避、自动群发或身份冒充；
- 使用地区、姓名等与购买意向无直接关系的属性评分。

## 结论

最值得复用的不是某个完整仓库，而是五个可替换能力：统一数据模型、证据型评分、需求信号搜索计划、公开信息适配器、经同意的关系路径。Lydia 自己持有核心模型和客户数据，第三方工具只能作为随时可替换的输入源。
