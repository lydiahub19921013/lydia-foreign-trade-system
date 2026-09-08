# Lydia 外贸系统

Lydia 自有的外贸获客工作台。它把散落的询盘、公开企业信息、联系人证据和熟人关系线索整理为可核查的客户档案，并给出分级与下一步建议。

当前可用的四条链路：

1. 批量导入阿里巴巴、中国制造网或人工整理的询盘 CSV/JSON；
2. 按证据质量、需求清晰度、购买准备度、可联系性与信任基础评分；
3. 从产品、市场和买家类型生成公开搜索计划，把未核查候选送去官网补证后加入开发队列；
4. 输出 A/B/C/D/HOLD 分级、缺失证据和下一步动作，再在 `apps/communication-extension` 中完成人工沟通。

工作台还可以：

- 主动查询 GLEIF 官方 LEI 数据，核对海外企业的法定名称、登记编号、地址与状态；
- 通过本机 agent-reach 可选调用 Exa 搜索公开商业候选，也可在浏览器本地导入 Lydia 候选 CSV/JSON；
- 主动读取一张公开或已授权的公司官网页面，或整理最多 5 张同站高价值页面，提取带来源的候选邮箱、电话、WhatsApp、地址及工厂自述；
- 逐条勾选官网候选证据后再写入询盘或开发队列；未选内容不写入，跨公司域名会被阻止，人工选择也不会把 `candidate` 升级成已验证；
- 用联系人英文名和企业域名生成有限的候选邮箱，检查域名邮件路由并阻止错配客户；
- 导入客户自己拥有或授权的通讯录/CRM 关系记录，排除拒绝路径并给出熟人引荐顺序。

## 立即使用

需要 Node.js 20 或更高版本，无需安装第三方依赖。

```bash
npm run workbench
```

然后打开终端显示的本机地址，在网页里导入询盘、查看分级、查询企业、评估信任路径并导出结果。也可以继续使用命令行：

```bash
npm run qualify -- examples/inquiries.sample.csv
npm run qualify -- examples/inquiries.sample.csv --output ./qualification-results.json
npm run check
```

所有示例均为虚构数据。询盘、候选和关系文件只在浏览器页面处理，不抓取私人资料、不发送消息。只有使用者主动确认查询时才联网：Exa 接收选中的公开搜索词；GLEIF 接收企业名称和可选司法辖区；指定官网按使用者选择读取一页，或最多 5 张同站的联系/公司/工厂/产品页；邮箱候选只查询企业域名 DNS，联系人姓名不离开浏览器。询盘正文、关系文件和其他联系人资料不会自动发送。搜索摘要、官网公开联系方式和生成邮箱全部先视为候选，也不等于营销同意。

## 系统边界

- `packages/lead-core`：统一客户、证据、分级和关系路径模型。
- `apps/lead-workbench`：只在本机运行的可视化询盘工作台。
- `apps/inquiry-qualifier`：可运行的批量询盘分级工具。
- `apps/communication-extension`：Lydia 的外贸沟通浏览器插件。
- `integrations`：可选研究/验证适配器；Exa 通过本机 agent-reach、GLEIF 通过固定官方接口；官网采集只读使用者主动确认的一页或最多 5 张同站高价值页面，其他提供方只有明确配置后才启用。
- `skills/lydia-foreign-trade-system`：供 Codex 复用的 Lydia 工作流 Skill。

沟通插件仍保留自己的独立私有仓库，并以 Git subtree 纳入本系统。需要同步其新版本时，在系统仓库执行：

```bash
git subtree pull --prefix apps/communication-extension \
  https://github.com/lydiahub19921013/foreign-trade-development-plugin.git main --squash
```

公开资料只能作为线索和证据，不能冒充已确认事实；候选邮箱不能写成“已验证邮箱”。官网结果必须逐条选择后才能进入客户档案，所选证据保留人工决定时间和具体来源。系统不按姓名、国籍、性别等敏感或无关属性判断客户质量。

## 品牌与授权

本仓库的产品代码、配置、示例和界面仅使用 Lydia 的个性化信息，不代表任何原公司或第三方。外部开源项目仅在许可证允许范围内借鉴或适配；依法需要保留的许可证和归属见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 规划

详见 [系统架构](./docs/ARCHITECTURE.md)、[客户调研](./docs/CUSTOMER_RESEARCH.md)、[公开候选](./docs/PUBLIC_PROSPECTS.md)、[官网档案](./docs/WEBSITE_DOSSIER.md)、[候选邮箱](./docs/EMAIL_CANDIDATES.md)、[关系数据导入](./docs/RELATIONSHIP_IMPORTS.md) 和 [路线图](./docs/ROADMAP.md)。
