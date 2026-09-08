---
name: lydia-foreign-trade-system
description: 处理 Lydia 外贸获客系统的批量询盘背调分级、海外公开线索证据、联系方式验证和信任关系路径。用户要执行或设计这些获客工作流，或把外贸客户需求做成 Lydia 自有软件时使用；普通外贸文案、自动群发、无授权社媒抓取不使用。
---

# Lydia 外贸系统

## 权威位置

- 本地仓库：`/Users/macmini/Documents/ChatGPT/我的口播视频/outputs/lydia-foreign-trade-system`
- 私有仓库：`https://github.com/lydiahub19921013/lydia-foreign-trade-system`
- 外贸沟通插件：仓库内 `apps/communication-extension`

先判断任务属于哪条链路，只读取对应 reference：

1. 已有询盘背调、客户分级和开发动作：读 `references/inquiry-qualification.md`。
2. 从官网、搜索或公开页面找企业/联系人证据：读 `references/public-lead-discovery.md`。
3. 从用户自有人脉寻找引荐路径：读 `references/trust-paths.md`。
4. 涉及第三方项目、外部 API、抓取或数据导入：额外读 `references/source-policy.md`。

## 统一工作方式

1. 先定义客户要得到的业务结果，不把“抓到更多数据”当成成功。
2. 把输入转成 Lead、Evidence、Qualification 或 RelationshipPath；缺来源的信息标为候选。
3. 分开呈现已验证事实、合理推断、缺失证据和建议动作。
4. 输出只使用 Lydia 的品牌、配置和虚构样例，不带上游项目品牌、账号、客户或密钥。
5. 沟通话术交给 `apps/communication-extension`，但发送前必须人工确认。
6. 修改代码后运行 `npm run check`；涉及安装包或长期交付时，再按桌面质量 Harness 做发布验收。
7. 工作台自动保存到当前浏览器但不上传；重要批次仍导出 JSON。切换客户或使用共享电脑前，先备份并清除本机工作台数据。

## 绝对边界

- 不自动群发、冒充熟人、绕过平台限制、验证码或付费墙。
- 不把推断邮箱、catch-all 或单一搜索结果描述为已验证事实。
- 不未经同意处理私人通讯录或替关系人作出背书。
- 不按姓名、国籍、性别等敏感或无关特征评价客户。
- 不把无许可证或许可证不兼容的代码直接放入 Lydia 仓库。
- 法律要求保留的开源许可证和版权信息必须保留；这不是客户信息泄露。
