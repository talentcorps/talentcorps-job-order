import type { JobOrder } from "./types";

export type ValidationIssue = {
  field: string;
  message: string;
  severity: "error" | "warning";
};

export function validateJobOrder(order: JobOrder): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const startValue = String(order.startDate || "").trim();
  const endValue = String(order.endDate || "").trim();
  const start = startValue ? new Date(`${startValue}T00:00:00`) : null;
  const end = endValue ? new Date(`${endValue}T00:00:00`) : null;
  const hasValidStart = Boolean(start && !Number.isNaN(start.getTime()));
  const hasValidEnd = Boolean(end && !Number.isNaN(end.getTime()));

  if (!order.orderType) {
    issues.push({ field: "orderType", message: "Order type is required.", severity: "error" });
  }
  if (order.orderType === "append" && !String(order.parentJobOrderId || "").trim()) {
    issues.push({ field: "parentJobOrderId", message: "Existing Job Order ID is required when adding to an existing order.", severity: "error" });
  }
  if ((order.orderType === "append" || order.orderType === "new_for_existing_site") && !String(order.existingSiteReference || "").trim()) {
    issues.push({ field: "existingSiteReference", message: "Existing site / client reference is required for this order type.", severity: "error" });
  }

  if (!startValue) {
    issues.push({ field: "startDate", message: "Start date is required.", severity: "error" });
  }
  if (!endValue) {
    issues.push({ field: "endDate", message: "End date is required.", severity: "error" });
  }

  if (hasValidStart && hasValidEnd) {
    const startTime = start!.getTime();
    const endTime = end!.getTime();
    if (endTime < startTime) {
      issues.push({ field: "endDate", message: "End date must be on or after start date.", severity: "error" });
    } else {
      const msPerDay = 1000 * 60 * 60 * 24;
      const dayDelta = Math.floor((endTime - startTime) / msPerDay);
      if (dayDelta > 60) {
        issues.push({ field: "endDate", message: "End date must be within 60 days of start date.", severity: "error" });
      }
    }
  }

  if (!order.clientName.trim()) issues.push({ field: "clientName", message: "Client name is required.", severity: "error" });
  if (!String(order.twid || "").trim()) issues.push({ field: "twid", message: "TempWorks ID is required.", severity: "error" });
  if (!order.projectName.trim()) issues.push({ field: "projectName", message: "Project name is required.", severity: "error" });
  if (!order.jobSite.address.trim()) issues.push({ field: "jobSite.address", message: "Job site address is required.", severity: "error" });
  if (!order.contacts.primary.name.trim()) issues.push({ field: "contacts.primary.name", message: "Primary contact name is required.", severity: "error" });
  if (!order.laborPositions.length) {
    issues.push({ field: "laborPositions", message: "At least one position request is required.", severity: "error" });
  }
  order.laborPositions.forEach((position, index) => {
    if (!String(position.tradeRequested || "").trim()) {
      issues.push({ field: `laborPositions.${index}.tradeRequested`, message: `Position ${index + 1}: Trade requested is required.`, severity: "error" });
    }
    if (!position.workersNeeded || position.workersNeeded < 1) {
      issues.push({ field: `laborPositions.${index}.workersNeeded`, message: `Position ${index + 1}: Workers needed must be at least 1.`, severity: "error" });
    }
  });
  if (!order.internal.salesTeamMember.trim()) issues.push({ field: "internal.salesTeamMember", message: "Sales team member is required.", severity: "error" });
  if (!order.internal.branch.trim()) issues.push({ field: "internal.branch", message: "Branch is required.", severity: "error" });
  if (!order.scheduleDays.length) issues.push({ field: "scheduleDays", message: "Select at least one schedule day.", severity: "warning" });
  if (!order.shiftTypes.length) issues.push({ field: "shiftTypes", message: "Select day shift, night shift, or both.", severity: "warning" });

  if (order.financial.payStructure === "single") {
    if (order.financial.inputMode === "bill") {
      if (!order.financial.payRate || order.financial.payRate <= 0) {
        issues.push({ field: "financial.payRate", message: "Pay rate is required when bill-rate mode is selected.", severity: "error" });
      }
      if (!order.financial.billRate || order.financial.billRate <= 0) {
        issues.push({ field: "financial.billRate", message: "Bill rate is required in bill-rate mode.", severity: "error" });
      }
    }

    if (order.financial.inputMode === "markup") {
      if (!order.financial.payRate || order.financial.payRate <= 0) {
        issues.push({ field: "financial.payRate", message: "Pay rate is required when markup mode is selected.", severity: "error" });
      }
      if (!order.financial.markupMultiplier || order.financial.markupMultiplier <= 0) {
        issues.push({ field: "financial.markupMultiplier", message: "Markup multiplier is required in markup mode.", severity: "error" });
      }
    }
  }

  if (order.financial.payStructure === "range") {
    const minPay = Number(order.financial.minPayRate || 0);
    const maxPay = Number(order.financial.maxPayRate || 0);
    const minBill = Number(order.financial.minBillRate || 0);
    const maxBill = Number(order.financial.maxBillRate || 0);
    const markup = Number(order.financial.markupMultiplier || 0);

    if (minPay <= 0) issues.push({ field: "financial.minPayRate", message: "Minimum pay rate is required for pay range.", severity: "error" });
    if (maxPay <= 0) issues.push({ field: "financial.maxPayRate", message: "Maximum pay rate is required for pay range.", severity: "error" });

    if (order.financial.inputMode === "bill") {
      if (minBill <= 0) issues.push({ field: "financial.minBillRate", message: "Minimum bill rate is required in bill-rate mode.", severity: "error" });
      if (maxBill <= 0) issues.push({ field: "financial.maxBillRate", message: "Maximum bill rate is required in bill-rate mode.", severity: "error" });
    }

    if (order.financial.inputMode === "markup") {
      if (markup <= 0) issues.push({ field: "financial.markupMultiplier", message: "Markup multiplier is required in markup mode.", severity: "error" });
    }

    if (minPay > 0 && maxPay > 0 && minPay > maxPay) {
      issues.push({ field: "financial.maxPayRate", message: "Maximum pay rate must be greater than or equal to minimum pay rate.", severity: "error" });
    }
    if (order.financial.inputMode === "bill" && minBill > 0 && maxBill > 0 && minBill > maxBill) {
      issues.push({ field: "financial.maxBillRate", message: "Maximum bill rate must be greater than or equal to minimum bill rate.", severity: "error" });
    }
  }

  if (order.financial.payStructure === "multiple") {
    const rates = order.financial.variableRates || [];
    if (!rates.length) {
      issues.push({ field: "financial.variableRates", message: "Add at least one variable pay rate option.", severity: "error" });
    }
    rates.forEach((rate, index) => {
      const pay = Number(rate.payRate || 0);
      const bill = Number(rate.billRate || 0);
      const markup = Number(rate.markupMultiplier || 0);
      if (pay <= 0) issues.push({ field: `financial.variableRates.${index}.payRate`, message: `Rate option ${index + 1}: pay rate is required.`, severity: "error" });
      if (!String(rate.label || "").trim()) {
        issues.push({ field: `financial.variableRates.${index}.label`, message: `Rate option ${index + 1}: description is required.`, severity: "error" });
      }
      if (order.financial.inputMode === "bill" && bill <= 0) {
        issues.push({ field: `financial.variableRates.${index}.billRate`, message: `Rate option ${index + 1}: bill rate is required in bill-rate mode.`, severity: "error" });
      }
      if (order.financial.inputMode === "markup" && markup <= 0) {
        issues.push({ field: `financial.variableRates.${index}.markupMultiplier`, message: `Rate option ${index + 1}: markup is required in markup mode.`, severity: "error" });
      }
    });
  }

  if (order.perDiem.enabled) {
    if (!order.perDiem.amount || order.perDiem.amount <= 0) {
      issues.push({ field: "perDiem.amount", message: "Per diem amount is required when per diem is enabled.", severity: "error" });
    }
    if (!order.perDiem.days || order.perDiem.days <= 0) {
      issues.push({ field: "perDiem.days", message: "Per diem days paid is required when per diem is enabled.", severity: "error" });
    }
  }

  if (order.travelPay.enabled && (!order.travelPay.amount || order.travelPay.amount <= 0)) {
    issues.push({ field: "travelPay.amount", message: "Travel pay amount is required when travel pay is enabled.", severity: "error" });
  }

  if (order.otherCompensation.enabled && !String(order.otherCompensation.details || "").trim()) {
    issues.push({ field: "otherCompensation.details", message: "Add details for Other compensation when enabled.", severity: "error" });
  }

  if (order.onboarding.drugScreenRequired && !order.onboarding.drugScreenType) {
    issues.push({ field: "onboarding.drugScreenType", message: "Select the required drug screen type.", severity: "error" });
  }

  if (order.onboarding.badgingRequired && !order.onboarding.badgingDetails?.trim()) {
    issues.push({ field: "onboarding.badgingDetails", message: "Badging requirements are required when badging is enabled.", severity: "error" });
  }

  if (order.onboarding.backgroundRequired && !order.onboarding.backgroundYears?.trim()) {
    issues.push({ field: "onboarding.backgroundYears", message: "Background check period is required when background is enabled.", severity: "warning" });
  }

  if (order.compliance.cipWrap.enabled) {
    const wrapTypes = order.compliance.cipWrap.wrapTypes;
    const hasWrapType = Boolean(wrapTypes?.ocip || wrapTypes?.ccip || wrapTypes?.rocip);
    if (!hasWrapType) {
      issues.push({ field: "compliance.cipWrap.wrapTypes", message: "Select at least one wrap type (OCIP, CCIP, or ROCIP).", severity: "error" });
    }
    if (!order.compliance.cipWrap.note?.trim()) {
      issues.push({ field: "compliance.cipWrap.note", message: "Wrap note is recommended for Field Ops.", severity: "warning" });
    }
  }

  if (order.compliance.prevailingWage.enabled) {
    if (!order.compliance.prevailingWage.wageDeterminationAttached) {
      issues.push({ field: "compliance.prevailingWage.wageDeterminationAttached", message: "Indicate whether wage determination sheet is attached.", severity: "error" });
    }
    if (!order.compliance.prevailingWage.wageDeterminationNotes?.trim()) {
      issues.push({ field: "compliance.prevailingWage.wageDeterminationNotes", message: "Prevailing wage notes are required for processing.", severity: "warning" });
    }
  }

      if (order.compliance.prevailingWage.certifiedPayrollRequired) {
        const reporting = order.compliance.prevailingWage.reportingContact;
        const missingName = !reporting?.name?.trim();
        const missingPhone = !reporting?.phone?.trim();
        const missingEmail = !reporting?.email?.trim();
        if (missingName || missingPhone || missingEmail) {
          issues.push({
            field: "compliance.prevailingWage.reportingContact.name",
            message: "Certified payroll contact name, phone, and email are required.",
            severity: "error",
          });
        }
      }

  if (order.compliance.fringe.enabled && !order.compliance.fringe.details?.trim()) {
    issues.push({ field: "compliance.fringe.details", message: "Fringe details are required when fringe is enabled.", severity: "warning" });
  }

  return issues;
}
