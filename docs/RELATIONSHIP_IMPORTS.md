# 关系路径导入

工作台接受 Lydia/客户自己拥有、主动提供或明确授权的 CSV/JSON 关系记录。文件只在当前浏览器页面解析，规范化后的候选路径会进入本机自动保存快照，但不会发送给 GLEIF 或其他外部服务。使用者可以在工作台清除本机快照，或导出后转移到受控位置。

## CSV 字段

| 字段 | 含义 | 示例 |
|---|---|---|
| `connector_id` | 关系人内部编号 | `connector-demo-01` |
| `connector_name` | 关系人显示名 | `林示例` |
| `target_id` | 目标客户内部编号 | `target-demo-01` |
| `target_name` | 目标客户显示名 | `Northstar Demo Imports` |
| `relationship_strength` | 关系强度，0–5 | `4` |
| `last_contact_at` | 最近联系时间 | `2026-08-28` |
| `known_personally` | 是否确认彼此认识 | `true` |
| `shared_company` | 是否有共同公司经历 | `false` |
| `shared_industry` | 是否有共同从业背景 | `true` |
| `shared_education` | 是否有共同教育经历 | `false` |
| `consent_status` | `unknown`、`approved` 或 `declined` | `unknown` |
| `evidence_ids` | 自有证据编号，用 `|` 分隔 | `crm-demo-01|meeting-demo-01` |

JSON 可以直接使用对象数组，也可以使用 `{ "paths": [...] }`。字段既支持上表的下划线写法，也支持 `connectorName` 等驼峰写法。

## 判断边界

- `declined` 记录不会进入候选结果。
- 没有证据编号的路径最高 49 分，只能作为待确认候选。
- “同公司、同校、同行业”不等于彼此认识，更不等于愿意背书。
- `approved` 表示系统记录了同意状态，不代表可以替关系人发送消息；介绍方式仍由关系人决定。
- 示例文件 `examples/relationships.sample.csv` 全部为虚构数据。
