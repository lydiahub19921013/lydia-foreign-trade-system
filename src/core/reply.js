import { getScenario } from "./scenarios.js";

const SCENARIO_COPY = {
  inquiry: {
    acknowledgement: "Thank you for your interest in our products.",
    nextStep: "To recommend the right option, could you share the product specifications, expected quantity, application, and destination market?"
  },
  quotation: {
    acknowledgement: "Thank you for your quotation request.",
    nextStep: "Please confirm the product or model, quantity, destination, and preferred trade term so I can prepare an accurate offer."
  },
  sample: {
    acknowledgement: "Thank you for asking about a sample.",
    nextStep: "Please confirm the required model, quantity, customization details, delivery address, and preferred courier so I can check the sample cost and lead time."
  },
  negotiation: {
    acknowledgement: "Thank you for sharing your target and concerns about the offer.",
    nextStep: "Could you confirm the target quantity, required specification, delivery schedule, and target price? I will review the workable options based on the complete terms."
  },
  order: {
    acknowledgement: "Thank you for moving forward with the order.",
    nextStep: "Please send or confirm the purchase order, product details, quantities, consignee information, and requested delivery date so I can check everything before confirmation."
  },
  payment: {
    acknowledgement: "Thank you for the payment update.",
    nextStep: "Please share the order or invoice number and the payment reference. I will verify the status and update you after confirmation."
  },
  production: {
    acknowledgement: "Thank you for checking the production status.",
    nextStep: "Please confirm the order number and required delivery date. I will check the latest schedule and report any item that may affect completion."
  },
  shipping: {
    acknowledgement: "Thank you for checking the shipment.",
    nextStep: "Please confirm the order or shipment number and the documents or tracking details you need. I will verify the latest logistics status."
  },
  complaint: {
    acknowledgement: "I am sorry to hear about this issue, and thank you for bringing it to our attention.",
    nextStep: "Please share the order number, affected quantity, photos or video, packaging condition, and a short description of the problem. I will review the evidence and respond with the next step."
  },
  "follow-up": {
    acknowledgement: "Thank you for following up.",
    nextStep: "Please let me know which quotation, sample, or order you are referring to, and I will check the current status and reply with a clear next step."
  }
};

const TONE_LINE = {
  concise: "I will keep the follow-up brief and focused.",
  professional: "I appreciate the opportunity to support your request.",
  warm: "We value your time and look forward to helping you move this forward."
};

function clean(value, maxLength = 4000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function contextNote(mode, settings) {
  if (mode === "industry" && clean(settings.industryProfile)) {
    return `Relevant background: ${clean(settings.industryProfile, 500)}`;
  }

  if (mode === "company" && clean(settings.companyProfile)) {
    return `Relevant background: ${clean(settings.companyProfile, 500)}`;
  }

  return "";
}

export function createTemplateReply({ scenarioId, customer = {}, settings = {}, mode = "generic", tone = "professional" }) {
  const scenario = getScenario(scenarioId);
  const copy = SCENARIO_COPY[scenario.id] ?? SCENARIO_COPY.inquiry;
  const name = clean(customer.name, 80);
  const greeting = name ? `Dear ${name},` : "Hello,";
  const background = contextNote(mode, settings);
  const signature = clean(settings.signature, 300);
  const paragraphs = [
    greeting,
    copy.acknowledgement,
    background,
    copy.nextStep,
    TONE_LINE[tone] ?? TONE_LINE.professional,
    signature ? `Best regards,\n${signature}` : "Best regards,"
  ].filter(Boolean);

  return paragraphs.join("\n\n");
}

export function buildAIChatMessages({ message, scenarioId, customer = {}, settings = {}, mode = "generic", tone = "professional" }) {
  const scenario = getScenario(scenarioId);
  const background = contextNote(mode, settings) || "No additional business background was selected.";
  const customerDetails = [
    clean(customer.name, 80) && `Contact: ${clean(customer.name, 80)}`,
    clean(customer.company, 120) && `Company: ${clean(customer.company, 120)}`,
    clean(customer.country, 80) && `Market: ${clean(customer.country, 80)}`,
    clean(customer.notes, 500) && `Notes: ${clean(customer.notes, 500)}`
  ].filter(Boolean).join("\n") || "No customer profile is available.";

  return [
    {
      role: "system",
      content: [
        "You are an experienced B2B export sales communication assistant.",
        "Write one ready-to-send English reply based only on the supplied facts.",
        "Do not invent prices, lead times, certifications, stock, payment status, shipping status, or promises.",
        "Ask concise clarification questions where facts are missing.",
        `Use a ${tone} tone. Return only the email or chat reply, without analysis or labels.`
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Detected stage: ${scenario.label} (${scenario.id})`,
        `Customer message:\n${clean(message, 8000)}`,
        `Customer profile:\n${customerDetails}`,
        background,
        clean(settings.signature, 300) ? `Signature:\n${clean(settings.signature, 300)}` : "No signature was provided."
      ].join("\n\n")
    }
  ];
}

export function extractChatCompletionText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  throw new Error("接口返回中没有可用的回复内容");
}
