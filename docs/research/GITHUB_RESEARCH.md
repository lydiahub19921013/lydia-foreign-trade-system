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

### Dedupe / Splink / GoldenMatch

- [Dedupe](https://github.com/dedupeio/dedupe)，固定版本 `3f61e79102910bd355e920a2df7e44c14c9cb247`，MIT：证明“先生成可能匹配的记录对，再用人工标注改进判断”比直接按名称删除更可靠。
- [Splink](https://github.com/moj-analytical-services/splink)，固定版本 `1af8b6bb6dc3c3ee2842ae7a5b50d6e150a65143`，MIT：强调多字段比较、blocking 和概率阈值，且明确单一公司名字段不足以可靠关联。
- [GoldenMatch](https://github.com/benseverndev-oss/goldenmatch)，固定版本 `4b8e0ae389415cd9f45e0aa6871b33c149ae44e2`，MIT：其稳定实体 ID、逐字段来源、追加式事件、人工 merge/split 和可撤销审计适合长期客户管理。
- Lydia 改造：现阶段数据规模只有几十到几百条，不引入 Python、DuckDB、Elasticsearch、机器学习训练或上游代码。独立实现为“确定性强/弱指纹 → 人工确认同一或不同客户 → 指定主账户 → 原始记录不删除 → 决定可撤销”的本地流程。
- 数据去向：全部在浏览器和 Lead core 中处理，不把客户记录发送给上述项目或其服务。
- 维护边界：真实回测样本达到至少 20–50 条且误报/漏报证明现有规则不足时，才评估概率模型；当前不因开源项目功能丰富而增加运行依赖。

### Atomic CRM / Krayin CRM

- [Atomic CRM](https://github.com/marmelab/atomic-crm)，固定版本 `b1213e62ad06561c96222415ad789e0cbc2b6e43`，MIT：把 Deal 阶段、Task 截止时间、Note 和聚合 Activity Log 分开；任务完成时间不等于销售阶段，活动时间线也不覆盖原记录。
- [Krayin CRM](https://github.com/krayin/laravel-crm)，固定版本 `2c1209102a77969665b880af9dda730cf9748a04`，MIT：把 Lead、Pipeline/Stage、Activity、Quote 和预计成交时间分开；活动包含类型、计划时间、完成状态，Lead 另有 won/lost 和停滞判断。
- Lydia 改造：不引入 Docker、Supabase、PostgreSQL、PHP、Laravel、多用户权限或上游界面代码。Lead schema 4 只增加本地 `development`：冻结导入时等级、追加式开发事件、可完成的下一步、阶段推导和按初始等级统计的真实转化。
- 关键修正：成熟 CRM 常显示成交概率，但 Lydia 没有足够历史样本，因此不采用固定概率。A/B/C/D 只作为导入时排序基线；回复率、报价率、样品率和成交率只由人工记录的真实后续结果计算。
- 数据去向：所有开发记录留在当前客户空间与导出 JSON；没有向 Atomic CRM、Krayin CRM 或其服务发送询盘、联系人、金额或备注。
- 代码范围：没有复制或捆绑两个上游项目的代码。MIT 文本仍存档，便于以后若真正引入代码时审查来源和义务。

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

最值得复用的不是某个完整仓库，而是六个可替换能力：统一数据模型、证据型评分、需求信号搜索计划、公开信息适配器、经同意的关系路径，以及可撤销的主账户判断。Lydia 自己持有核心模型和客户数据，第三方工具只能作为随时可替换的输入源或方法参考。
