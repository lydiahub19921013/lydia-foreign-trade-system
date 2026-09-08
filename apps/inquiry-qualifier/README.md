# 批量询盘分级器

它读取 Lydia 格式的 CSV 或 JSON，在本地输出客户档案、证据、A/B/C/D/HOLD 等级和下一步建议。字段可参考 `examples/inquiries.sample.csv`。

关键状态字段可使用 `candidate`、`inconclusive`、`verified`、`rejected`。例如只有当 `email_status=verified` 且保留 `source_reference` 时，邮箱才会按已验证证据计分。

等级是开发优先级建议，不是信用评级、身份结论或成交承诺。
