# Lydia 外贸系统

Lydia 自有的外贸获客工作台。它把散落的询盘、公开企业信息、联系人证据和熟人关系线索整理为可核查的客户档案，并给出分级与下一步建议。

当前可用的第一条完整链路：

1. 批量导入阿里巴巴、中国制造网或人工整理的询盘 CSV/JSON；
2. 按证据质量、需求清晰度、购买准备度、可联系性与信任基础评分；
3. 输出 A/B/C/D/HOLD 分级、缺失证据和下一步动作；
4. 在 `apps/communication-extension` 中继续完成邮件、WhatsApp 等场景的人工沟通。

## 立即使用

需要 Node.js 20 或更高版本，无需安装第三方依赖。

```bash
npm run qualify -- examples/inquiries.sample.csv
npm run qualify -- examples/inquiries.sample.csv --output ./qualification-results.json
npm run check
```

所有示例均为虚构数据。默认不联网、不抓取社媒、不发送消息，也不会把客户数据交给第三方服务。

## 系统边界

- `packages/lead-core`：统一客户、证据、分级和关系路径模型。
- `apps/inquiry-qualifier`：可运行的批量询盘分级工具。
- `apps/communication-extension`：Lydia 的外贸沟通浏览器插件。
- `integrations`：可选研究/验证适配器；只有明确配置后才启用。
- `skills/lydia-foreign-trade-system`：供 Codex 复用的 Lydia 工作流 Skill。

沟通插件仍保留自己的独立私有仓库，并以 Git subtree 纳入本系统。需要同步其新版本时，在系统仓库执行：

```bash
git subtree pull --prefix apps/communication-extension \
  https://github.com/lydiahub19921013/foreign-trade-development-plugin.git main --squash
```

公开资料只能作为线索和证据，不能冒充已确认事实；候选邮箱不能写成“已验证邮箱”。系统不按姓名、国籍、性别等敏感或无关属性判断客户质量。

## 品牌与授权

本仓库的产品代码、配置、示例和界面仅使用 Lydia 的个性化信息，不代表任何原公司或第三方。外部开源项目仅在许可证允许范围内借鉴或适配；依法需要保留的许可证和归属见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 规划

详见 [系统架构](./docs/ARCHITECTURE.md)、[客户调研](./docs/CUSTOMER_RESEARCH.md) 和 [路线图](./docs/ROADMAP.md)。
