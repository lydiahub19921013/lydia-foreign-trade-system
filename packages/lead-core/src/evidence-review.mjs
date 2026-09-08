import { createEvidence, normalizeLead } from "./model.mjs";

function clean(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.valueOf())) throw new Error("复核时间格式不正确");
  return date.toISOString();
}

function comparable(value) {
  return String(value ?? "").trim().toLowerCase();
}

function fieldValue(lead, path) {
  const [group, field] = path.split(".");
  return lead[group]?.[field] ?? null;
}

function setFieldValue(lead, path, value) {
  const [group, field] = path.split(".");
  lead[group] = { ...lead[group], [field]: value };
}

function requiredNote(value) {
  const note = clean(value, 1000);
  if (note.length < 3) throw new Error("请填写至少 3 个字的复核原因");
  return note;
}

function withReviewEvent(inputEvidence, action, options = {}, changes = null) {
  const evidence = createEvidence(inputEvidence);
  const reviewedAt = timestamp(options.reviewedAt);
  const note = requiredNote(options.note);
  const history = [...(evidence.review?.history || []), { action, reviewedAt, note, changes }];
  const decision = action === "revised"
    ? evidence.review?.decision || "accepted"
    : action;
  return createEvidence({
    ...evidence,
    review: { decision, reviewedAt, note, history }
  });
}

function replaceEvidence(lead, evidenceId, replacement) {
  lead.evidence = lead.evidence.map((item) => item.id === evidenceId ? replacement : item);
}

function evidenceFor(lead, evidenceId) {
  const evidence = lead.evidence.find((item) => item.id === evidenceId);
  if (!evidence) throw new Error("没有找到要复核的证据");
  return evidence;
}

export function reviewLeadEvidence(input, evidenceId, options = {}) {
  const lead = normalizeLead(input);
  const decision = options.decision;
  if (!["accepted", "rejected"].includes(decision)) throw new Error("复核决定只能是接受或驳回");
  const reviewedAt = timestamp(options.reviewedAt);
  const evidence = evidenceFor(lead, evidenceId);
  const replacement = withReviewEvent(evidence, decision, { ...options, reviewedAt });
  replaceEvidence(lead, evidenceId, replacement);

  const clearedFields = [];
  const restoredFields = [];
  const preservedFields = [];
  lead.fieldOrigins = lead.fieldOrigins.map((origin) => {
    if (origin.evidenceId !== evidenceId) return origin;
    const currentValue = fieldValue(lead, origin.path);

    if (decision === "rejected" && origin.active) {
      const unchanged = comparable(currentValue) === comparable(origin.appliedValue);
      if (unchanged) {
        setFieldValue(lead, origin.path, null);
        clearedFields.push(origin.path);
      } else {
        preservedFields.push(origin.path);
      }
      return {
        ...origin,
        active: false,
        endedAt: reviewedAt,
        endReason: unchanged ? "evidence-rejected" : "field-changed"
      };
    }

    if (decision === "accepted" && !origin.active) {
      const empty = !clean(currentValue);
      const same = comparable(currentValue) === comparable(origin.appliedValue);
      if (empty || same) {
        if (empty) setFieldValue(lead, origin.path, origin.appliedValue);
        restoredFields.push(origin.path);
        return { ...origin, active: true, endedAt: null, endReason: null };
      }
      preservedFields.push(origin.path);
    }
    return origin;
  });

  return {
    lead: normalizeLead(lead),
    clearedFields: [...new Set(clearedFields)],
    restoredFields: [...new Set(restoredFields)],
    preservedFields: [...new Set(preservedFields)]
  };
}

export function reviseLeadEvidence(input, evidenceId, changes = {}, options = {}) {
  const lead = normalizeLead(input);
  const evidence = evidenceFor(lead, evidenceId);
  if (evidence.review?.decision === "rejected") throw new Error("请先恢复这条证据，再进行修订");

  const nextValue = changes.value === undefined ? evidence.value : clean(changes.value);
  const nextSourceRef = changes.sourceRef === undefined ? evidence.sourceRef : clean(changes.sourceRef);
  if (!nextValue) throw new Error("修订后的证据内容不能为空");
  if (!nextSourceRef) throw new Error("修订后的来源不能为空");

  const revisionChanges = {};
  if (comparable(nextValue) !== comparable(evidence.value)) {
    revisionChanges.value = { from: evidence.value, to: nextValue };
  }
  if (nextSourceRef !== evidence.sourceRef) {
    revisionChanges.sourceRef = { from: evidence.sourceRef, to: nextSourceRef };
  }
  if (!Object.keys(revisionChanges).length) throw new Error("证据内容和来源都没有变化");

  const reviewedAt = timestamp(options.reviewedAt);
  const replacement = withReviewEvent({ ...evidence, value: nextValue, sourceRef: nextSourceRef }, "revised", { ...options, reviewedAt }, revisionChanges);
  replaceEvidence(lead, evidenceId, replacement);

  const updatedFields = [];
  const preservedFields = [];
  if (revisionChanges.value) {
    lead.fieldOrigins = lead.fieldOrigins.map((origin) => {
      if (origin.evidenceId !== evidenceId || !origin.active || comparable(origin.appliedValue) !== comparable(evidence.value)) return origin;
      const currentValue = fieldValue(lead, origin.path);
      if (comparable(currentValue) !== comparable(origin.appliedValue)) {
        preservedFields.push(origin.path);
        return { ...origin, active: false, endedAt: reviewedAt, endReason: "field-changed" };
      }
      setFieldValue(lead, origin.path, nextValue);
      updatedFields.push(origin.path);
      return { ...origin, appliedValue: nextValue, updatedAt: reviewedAt };
    });
  }

  return {
    lead: normalizeLead(lead),
    updatedFields: [...new Set(updatedFields)],
    preservedFields: [...new Set(preservedFields)]
  };
}
