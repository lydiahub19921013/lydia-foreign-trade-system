# 询盘渠道导入

## 使用方式

可视化工作台中先选择“自动 / Lydia 标准表”“阿里巴巴”或“中国制造网”，再选择 CSV。命令行使用：

```bash
npm run qualify -- ./询盘.csv --channel alibaba --output ./Lydia-客户分级.json
npm run qualify -- ./询盘.csv --channel made-in-china --output ./Lydia-客户分级.json
```

## 当前识别字段

系统会把常见中英文字段统一为以下 Lydia 字段：

| Lydia 字段 | 常见输入示例 |
|---|---|
| 来源编号 | Inquiry ID、RFQ ID、询盘编号、询盘链接 |
| 企业 | Company Name、Buyer Company、公司名称、买家公司 |
| 联系人 | Buyer Name、Contact Name、买家姓名、联系人 |
| 地区 | Country/Region、Market、国家/地区、市场 |
| 询盘 | Inquiry Content、Message、询盘内容、留言 |
| 产品 | Product Name、Inquiry Title、产品名称、询盘标题 |
| 数量 | Order Quantity、Purchase Quantity、采购数量 |
| 联系方式 | Email、Business Email、WhatsApp、Phone、工作邮箱、联系电话 |

## 重要边界

这些是兼容性映射，不是对两个平台当前导出格式的完整承诺。平台可能更改字段，不同账号和地区也可能不同。第一次导入真实文件时，必须抽查至少 5 行的公司名、联系人、原始询盘、产品、数量和来源编号；错列时先补映射和测试，不手工假装结果正确。

原始联系方式默认是 `candidate`。只有保留验证来源并明确标记为 `verified`，才会按已验证联系方式计分。
