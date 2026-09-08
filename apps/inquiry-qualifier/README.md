# 批量询盘分级器

它读取 Lydia 格式的 CSV 或 JSON，在本地输出客户档案、证据、A/B/C/D/HOLD 等级和下一步建议。字段可参考 `examples/inquiries.sample.csv`。

阿里巴巴或中国制造网导出的表格可以选择渠道映射：

```bash
npm run qualify -- ./询盘.csv --channel alibaba --output ./分级结果.json
npm run qualify -- ./询盘.csv --channel made-in-china --output ./分级结果.json
```

映射会识别常见中英文字段名，但渠道格式可能变化，第一次导入必须抽查公司名、联系人、询盘内容和来源编号；没有实际导出样本前不宣称完全兼容。

关键状态字段可使用 `candidate`、`inconclusive`、`verified`、`rejected`。例如只有当 `email_status=verified` 且保留 `source_reference` 时，邮箱才会按已验证证据计分。

等级是开发优先级建议，不是信用评级、身份结论或成交承诺。

命令行会输出待人工处理的 `duplicateCandidates`，并保留已经在工作台完成的 `duplicateDecisions`。重复提示不能代替法定主体核验；真正的主账户关系必须在工作台人工确认。
