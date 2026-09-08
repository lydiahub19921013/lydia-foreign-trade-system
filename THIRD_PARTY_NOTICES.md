# 第三方研究与许可证说明

Lydia 外贸系统没有导入任何第三方客户数据、用户资料、密钥、品牌素材或示例账号。以下项目用于架构研究、方法适配或可选接口兼容。Lydia 的实现使用自己的字段、规则、品牌和虚构样例。

| 项目 | 固定版本 | 许可证 | 本系统的处理 |
|---|---|---|---|
| [gtm-flywheel](https://github.com/kenny589/gtm-flywheel) | `ba67446418663737a00274819dc2bf68c0da2c31` | MIT | 借鉴分阶段资格审查、Fit/Intent/Engagement 的可解释思想；重新设计为外贸证据评分。 |
| [b2b-sdr-agent-template](https://github.com/iPythoning/b2b-sdr-agent-template) | `2c20788e5931f3f530023cade228ed4f74a38c84` | MIT | 借鉴分层研究和租户隔离思想；不采用自动群发、平台规避或固定市场假设。 |
| [email-sleuth](https://github.com/buyukakyuz/email-sleuth) | `273ff38b17a13156c6e2918f8a0f9b70ce6f7bd2` | MIT | 仅提供可选结果映射适配器；不捆绑、不自动运行，其结果不能单独视为已确认事实。 |
| [Prospex](https://github.com/asiifdev/business-leads-ai-automation) | `5b3e260d3291a201c61240387cbcfd84979476c1` | MIT | 仅研究工作区/客户/活动分离模型；没有复制地区硬编码评分和地图抓取器。 |
| [Crawl4AI](https://github.com/unclecode/crawl4ai) | `862f6bccb9c063f49b9d42701baa0eea17a4993f` | Apache-2.0 | 作为未来可选官网提取提供方；当前没有捆绑其代码。启用时必须遵守其许可证及 NOTICE 要求。 |
| [GLEIF LEI Data](https://www.gleif.org/en/lei-data/gleif-api) | 在线 Golden Copy | CC0 数据＋GLEIF访问条款 | 通过固定官方 API 查询企业身份；不使用其 Logo，不声称关联或背书，LEI 不作为信用保证。 |
| [codex-first-customer-finder-skill](https://github.com/Kappaemme-git/codex-first-customer-finder-skill) | `943c455bdfc40da46265b01b3c1f41e4bb386f27` | MIT | 借鉴公开需求信号、原页核查、五维排序和“无来源不得入选”的研究纪律；用 Lydia 外贸字段和本地门禁重新实现。 |
| [Dedupe](https://github.com/dedupeio/dedupe) | `3f61e79102910bd355e920a2df7e44c14c9cb247` | MIT | 研究记录匹配候选与人工标注分离；没有复制或捆绑其 Python 代码。 |
| [Splink](https://github.com/moj-analytical-services/splink) | `1af8b6bb6dc3c3ee2842ae7a5b50d6e150a65143` | MIT | 研究多字段 blocking、比较与概率候选；当前没有引入其运行时或代码。 |
| [GoldenMatch](https://github.com/benseverndev-oss/goldenmatch) | `4b8e0ae389415cd9f45e0aa6871b33c149ae44e2` | MIT | 借鉴稳定主实体、来源、追加式事件和可撤销 merge/split 原则；用 Lydia 数据结构独立实现，没有复制代码。 |
| [Atomic CRM](https://github.com/marmelab/atomic-crm) | `b1213e62ad06561c96222415ad789e0cbc2b6e43` | MIT | 借鉴任务截止时间、销售阶段与聚合活动时间线彼此分离的产品结构；没有复制 React、Supabase 或数据库代码。 |
| [Krayin CRM](https://github.com/krayin/laravel-crm) | `2c1209102a77969665b880af9dda730cf9748a04` | MIT | 借鉴 Lead、Pipeline/Stage、Activity、Quote 以及“停滞天数”分离建模；用 Lydia 的本地事件和外贸阶段独立实现。 |

MIT 许可证文本按相关项目保存在 `third_party/licenses/`。未复制代码时保留说明是为了让来源和判断过程可审查；如以后真正引入代码，必须再次核对上游版本和许可证。
