# GLEIF 企业身份核验

Lydia 外贸系统使用 GLEIF 官方 API 查询 Legal Entity Identifier（LEI）及其法定名称、地址、登记编号和状态。接口无需 API Key；查询会把用户输入的企业名称和可选司法辖区发送给 `api.gleif.org`。

## 证据边界

- `ISSUED` 且 `FULLY_CORROBORATED` 的记录可作为“GLEIF 当前记录”的已验证证据。
- `LAPSED`、未充分核实或其他状态标记为 `inconclusive`。
- 有 LEI 不等于信用好、会付款、有采购需求或值得成交。
- 没搜到不等于公司不存在；很多中小企业没有 LEI。
- Lydia 不使用 GLEIF Logo，不声称得到 GLEIF 授权、支持或背书。

官方资料：

- API：https://www.gleif.org/en/lei-data/gleif-api
- 数据使用条款：https://www.gleif.org/en/meta/lei-data-terms-of-use
- GLEIF 数据按 CC0 提供，仍需遵守访问服务的技术限制和不得误导关联关系等条款。
