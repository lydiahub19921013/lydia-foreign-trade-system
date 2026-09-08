export const SCENARIOS = [
  {
    id: "inquiry",
    label: "询盘",
    hint: "客户在了解产品、能力或基本合作条件",
    signals: [
      [/\binterested in\b/i, 4],
      [/\bmore information\b/i, 3],
      [/\bcatalog(?:ue)?\b/i, 3],
      [/\bdo you (?:have|supply|make)\b/i, 3],
      [/\bproduct (?:details|range|specifications?)\b/i, 3],
      [/\blooking for\b/i, 2]
    ]
  },
  {
    id: "quotation",
    label: "报价",
    hint: "客户询问价格、贸易条款或正式报价",
    signals: [
      [/\b(?:price|pricing|quotation|quote)\b/i, 4],
      [/\b(?:FOB|CIF|EXW|DDP)\b/i, 3],
      [/\bprice list\b/i, 4],
      [/\bbest price\b/i, 3],
      [/\bunit price\b/i, 3]
    ]
  },
  {
    id: "sample",
    label: "样品",
    hint: "客户询问样品、打样或样品运费",
    signals: [
      [/\bsamples?\b/i, 5],
      [/\bprototype\b/i, 4],
      [/\bsample (?:cost|fee|lead time|shipping)\b/i, 4],
      [/\btrial order\b/i, 2]
    ]
  },
  {
    id: "negotiation",
    label: "议价",
    hint: "客户要求降价、折扣或调整交易条件",
    signals: [
      [/\bdiscount\b/i, 5],
      [/\blower (?:the )?price\b/i, 5],
      [/\btoo expensive\b/i, 5],
      [/\btarget price\b/i, 4],
      [/\bbetter (?:price|offer|terms)\b/i, 4],
      [/\bnegotiate\b/i, 4]
    ]
  },
  {
    id: "order",
    label: "订单",
    hint: "客户准备下单、确认订单或发送采购单",
    signals: [
      [/\bpurchase order\b/i, 5],
      [/\bplace (?:an|the) order\b/i, 5],
      [/\bconfirm (?:the )?order\b/i, 4],
      [/\b\bPO\b/i, 3],
      [/\border quantity\b/i, 3]
    ]
  },
  {
    id: "payment",
    label: "付款",
    hint: "客户讨论付款方式、到账或付款凭证",
    signals: [
      [/\bpayment\b/i, 5],
      [/\bpaid\b/i, 4],
      [/\bbank (?:transfer|receipt|slip)\b/i, 4],
      [/\bdeposit\b/i, 3],
      [/\bbalance\b/i, 2],
      [/\bT\/T\b/i, 3]
    ]
  },
  {
    id: "production",
    label: "生产",
    hint: "客户询问生产进度、交期或完工时间",
    signals: [
      [/\bproduction\b/i, 5],
      [/\blead time\b/i, 4],
      [/\bready (?:date|time)\b/i, 3],
      [/\bmanufactur(?:e|ing) progress\b/i, 4],
      [/\bcompletion date\b/i, 4]
    ]
  },
  {
    id: "shipping",
    label: "运输",
    hint: "客户询问发货、物流、单据或预计到达时间",
    signals: [
      [/\bshipping\b/i, 5],
      [/\bshipment\b/i, 5],
      [/\btracking (?:number|information)\b/i, 4],
      [/\bbill of lading\b/i, 4],
      [/\bdelivery date\b/i, 3],
      [/\bETA\b/i, 3],
      [/\bfreight\b/i, 3]
    ]
  },
  {
    id: "complaint",
    label: "投诉",
    hint: "客户反馈质量、短缺、损坏或其他售后问题",
    signals: [
      [/\bcomplaint\b/i, 6],
      [/\bdefective\b/i, 6],
      [/\bdamaged\b/i, 5],
      [/\bquality (?:issue|problem)\b/i, 5],
      [/\bwrong (?:item|product|color|size)\b/i, 4],
      [/\bmissing (?:item|quantity|pieces?)\b/i, 4],
      [/\bnot satisfied\b/i, 4]
    ]
  },
  {
    id: "follow-up",
    label: "跟进",
    hint: "客户或业务员在等待回复、决定或下一步",
    signals: [
      [/\bfollow(?:ing)? up\b/i, 5],
      [/\bany update\b/i, 4],
      [/\bwaiting for your (?:reply|response|feedback)\b/i, 4],
      [/\bhave you (?:checked|reviewed|decided)\b/i, 3],
      [/\bget back to me\b/i, 3],
      [/\breminder\b/i, 3]
    ]
  }
];

export function getScenario(id) {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}

export function detectScenario(message) {
  const text = String(message ?? "").trim();
  if (!text) {
    return { ...SCENARIOS[0], confidence: 0, evidence: [] };
  }

  const ranked = SCENARIOS.map((scenario, index) => {
    const evidence = [];
    let score = 0;

    for (const [pattern, weight] of scenario.signals) {
      const match = text.match(pattern);
      if (match) {
        score += weight;
        evidence.push(match[0]);
      }
    }

    return { scenario, score, evidence, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const best = ranked[0];
  if (best.score === 0) {
    return { ...SCENARIOS[0], confidence: 0.25, evidence: [] };
  }

  return {
    ...best.scenario,
    confidence: Math.min(0.98, 0.46 + best.score * 0.06),
    evidence: [...new Set(best.evidence)]
  };
}
