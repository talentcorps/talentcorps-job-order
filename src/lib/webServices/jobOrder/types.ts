export type Contact = {
  name: string;
  phone: string;
  email: string;
  title?: string;
};

export type ToggleDetail = {
  enabled: boolean;
  amount?: number | null;
  details?: string;
  days?: number | null;
};

export type LaborPosition = {
  tradeRequested: string;
  workersNeeded: number;
  languagePreference: "english" | "bilingual" | "spanish" | "no_preference";
  jobDescription: string;
  requirements: string;
  certificates: string;
  submittalProcess: string;
};

export type VariablePayRate = {
  label?: string;
  payRate?: number;
  billRate?: number;
  markupMultiplier?: number;
};

export type JobOrder = {
  id: string;
  createdAt: string;
  orderType: "new" | "append" | "new_for_existing_site";
  parentJobOrderId?: string;
  existingSiteReference?: string;
  changeReason?: string;
  isLongTermProject: boolean;
  reviewDateType: "end_date" | "check_in_60_day";
  clientName: string;
  twid?: string;
  projectName: string;
  jobSite: {
    address: string;
    city: string;
    state: string;
    zip: string;
    formattedAddress?: string;
    lat?: number;
    lng?: number;
    placeId?: string;
  };
  startDate?: string;
  startDateDescription?: string;
  endDate?: string;
  endDateDescription?: string;
  shiftStart?: string;
  shiftEnd?: string;
  scheduleDays: string[];
  shiftTypes: Array<"day" | "night">;
  shiftNotes?: string;

  contacts: {
    primary: Contact;
    supervisor: Contact;
    timesheet: Contact;
    generalContractor: Contact;
    accounting: Contact;
    safety: Contact;
    otherContact: Contact;
    gcAddress?: string;
  };

  laborPositions: LaborPosition[];

  financial: {
    payStructure: "single" | "range" | "multiple";
    inputMode: "bill" | "markup";
    payRate?: number;
    billRate?: number;
    markupMultiplier?: number;
    minPayRate?: number;
    maxPayRate?: number;
    minBillRate?: number;
    maxBillRate?: number;
    variableRates: VariablePayRate[];
    variablePayDescription?: string;
    poNumber?: string;
  };

  onboarding: {
    drugScreenRequired: boolean;
    drugScreenType: "" | "5_panel" | "10_panel" | "in_house_swab" | "other";
    drugScreenDetails?: string;
    backgroundRequired: boolean;
    backgroundYears?: string;
    backgroundDetails?: string;
    badgingRequired: boolean;
    badgingDetails?: string;
  };

  perDiem: ToggleDetail;
  travelPay: ToggleDetail;
  otherCompensation: ToggleDetail;

  compliance: {
    cipWrap: {
      enabled: boolean;
      enrollmentRequired?: boolean;
      details?: string;
      contact?: Contact;
      portalInformation?: string;
      note?: string;
      wrapTypes?: {
        ocip: boolean;
        ccip: boolean;
        rocip: boolean;
      };
      insuranceCertificateAttached?: boolean;
    };
    prevailingWage: {
      enabled: boolean;
      certifiedPayrollRequired?: boolean;
      wageDeterminationAttached?: boolean;
      wageDeterminationNotes?: string;
      portalInformation?: string;
      reportingContact?: Contact;
    };
    fringe: {
      enabled: boolean;
      details?: string;
    };
  };

  internal: {
    salesTeamMember: string;
    branch: string;
    notes?: string;
  };
};

export function createEmptyJobOrder(): JobOrder {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 60);
  const toInputDate = (value: Date) => {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    orderType: "new",
    parentJobOrderId: "",
    existingSiteReference: "",
    changeReason: "",
    isLongTermProject: false,
    reviewDateType: "end_date",
    clientName: "",
    twid: "",
    projectName: "",
    jobSite: {
      address: "",
      city: "",
      state: "",
      zip: "",
      formattedAddress: "",
    },
    startDate: toInputDate(today),
    startDateDescription: "",
    endDate: toInputDate(end),
    endDateDescription: "",
    shiftStart: "",
    shiftEnd: "",
    scheduleDays: [],
    shiftTypes: [],
    shiftNotes: "",
    contacts: {
      primary: { name: "", phone: "", email: "", title: "" },
      supervisor: { name: "", phone: "", email: "", title: "" },
      timesheet: { name: "", phone: "", email: "", title: "" },
      generalContractor: { name: "", phone: "", email: "", title: "" },
      accounting: { name: "", phone: "", email: "", title: "" },
      safety: { name: "", phone: "", email: "", title: "" },
      otherContact: { name: "", phone: "", email: "", title: "" },
      gcAddress: "",
    },
    laborPositions: [
      {
        tradeRequested: "",
        workersNeeded: 1,
        languagePreference: "english",
        jobDescription: "",
        requirements: "",
        certificates: "",
        submittalProcess: "",
      },
    ],
    financial: {
      payStructure: "single",
      inputMode: "markup",
      payRate: undefined,
      billRate: undefined,
      markupMultiplier: undefined,
      minPayRate: undefined,
      maxPayRate: undefined,
      minBillRate: undefined,
      maxBillRate: undefined,
      variableRates: [],
      variablePayDescription: "",
      poNumber: "",
    },
    onboarding: {
      drugScreenRequired: false,
      drugScreenType: "",
      drugScreenDetails: "",
      backgroundRequired: false,
      backgroundYears: "",
      backgroundDetails: "",
      badgingRequired: false,
      badgingDetails: "",
    },
    perDiem: { enabled: false, amount: null, days: null, details: "" },
    travelPay: { enabled: false, amount: null, details: "" },
    otherCompensation: { enabled: false, details: "" },
    compliance: {
      cipWrap: {
        enabled: false,
        enrollmentRequired: false,
        details: "",
        contact: { name: "", phone: "", email: "", title: "" },
        portalInformation: "",
        note: "",
        wrapTypes: {
          ocip: false,
          ccip: false,
          rocip: false,
        },
        insuranceCertificateAttached: false,
      },
      prevailingWage: {
        enabled: false,
        certifiedPayrollRequired: false,
        wageDeterminationAttached: false,
        wageDeterminationNotes: "",
        portalInformation: "",
        reportingContact: { name: "", phone: "", email: "", title: "" },
      },
      fringe: {
        enabled: false,
        details: "",
      },
    },
    internal: {
      salesTeamMember: "House Account",
      branch: "",
      notes: "",
    },
  };
}
