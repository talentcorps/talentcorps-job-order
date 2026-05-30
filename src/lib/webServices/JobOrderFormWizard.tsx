import { useEffect, useMemo, useRef, useState } from "react";
import { createEmptyJobOrder, type JobOrder, type LaborPosition, type VariablePayRate } from "./jobOrder/types";
import { type ValidationIssue, validateJobOrder } from "./jobOrder/validation";
import { generateJobOrderPdf } from "./jobOrder/api";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type UploadState = {
  wageSheet?: File | null;
  cipDocument?: File | null;
  cipInsuranceCertificate?: File | null;
  supplemental?: File | null;
  generatedPdf?: File | null;
};

type AddressCandidate = {
  formattedAddress: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
};

type DeviceLocation = {
  lat: number;
  lng: number;
};

const DALLAS_FALLBACK_LOCATION: DeviceLocation = {
  lat: 32.7767,
  lng: -96.7970,
};

type NominatimResult = {
  display_name?: string;
  lat?: string;
  lon?: string;
  place_id?: number;
  type?: string;
  address?: {
    road?: string;
    house_number?: string;
    country_code?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    state?: string;
    postcode?: string;
  };
};

const STEP_LABELS = ["Snapshot", "Contacts", "Labor", "Pay", "Compliance", "Review"] as const;
const WEEK_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SALES_TEAM_MEMBER_OPTIONS = [
  "House Account",
  "Bertha Quiroga Copado",
  "Jack Trischett",
  "Yvette Quintana",
  "Vincent Chernushin",
  "Scott Olson",
  "Mitchell Cummings",
  "Chad Gibson",
  "Jared Schock",
  "Kelly Smith",
  "Eric Stegman",
  "Cameron Mecca",
  "Kim Higbie",
  "Livan Macanlalay",
  "Megan Waters",
  "Rebekah Guillory",
  "Kevin Owens",
  "Trevor Hodgins",
  "Ronald Smith",
];
const BRANCH_OPTIONS = [
  "Atlanta",
  "Austin",
  "Charlotte",
  "Dallas/Fort Worth",
  "DC Metroplex",
  "DFW LIT Direct Placements",
  "Houston",
  "Nashville",
  "National",
  "Orlando",
  "Philadelphia",
  "Phoenix",
  "San Antonio",
  "Strategic Accounts",
  "Tampa",
];

type SubmitConfirmationItem = {
  key: string;
  label: string;
};

function stepForField(field: string): number {
  if (field === "scheduleDays" || field === "shiftTypes") return 0;
  if (field === "orderType" || field === "parentJobOrderId" || field === "existingSiteReference" || field === "changeReason") return 0;
  if (field === "startDate" || field === "endDate" || field === "isLongTermProject" || field === "reviewDateType") return 0;
  if (field.startsWith("client") || field.startsWith("project") || field.startsWith("jobSite")) return 0;
  if (field.startsWith("contacts")) return 1;
  if (field.startsWith("labor")) return 2;
  if (field.startsWith("financial") || field.startsWith("perDiem") || field.startsWith("travelPay") || field.startsWith("otherCompensation") || field.startsWith("internal")) return 3;
  if (field.startsWith("onboarding") || field.startsWith("compliance")) return 4;
  return 5;
}

function orderTypeLabel(orderType: JobOrder["orderType"]) {
  if (orderType === "append") return "Add to Existing Job Order";
  if (orderType === "new_for_existing_site") return "New Job Order for Existing Site";
  return "New Job Order";
}

function orderTypeBadgeText(orderType: JobOrder["orderType"]) {
  if (orderType === "append") return "ADD TO EXISTING";
  if (orderType === "new_for_existing_site") return "NEW FOR EXISTING SITE";
  return "NEW JOB ORDER";
}

function orderTypeSlug(orderType: JobOrder["orderType"]) {
  if (orderType === "append") return "add_to_existing_job_order";
  if (orderType === "new_for_existing_site") return "new_job_order_for_existing_site";
  return "new_job_order";
}

function orderTypeTheme(orderType: JobOrder["orderType"]) {
  if (orderType === "append") {
    return {
      uiBorder: "#f59e0b",
      uiSoft: "#fffbeb",
      uiInk: "#92400e",
      uiStepActive: "#b45309",
      pdfHeader: rgb(0.55, 0.31, 0.02),
      pdfHeaderBorder: rgb(0.85, 0.54, 0.08),
      pdfBadge: rgb(0.96, 0.62, 0.07),
      pdfBadgeText: rgb(0.2, 0.12, 0.01),
      pdfSectionHead: rgb(0.7, 0.42, 0.05),
    };
  }

  if (orderType === "new_for_existing_site") {
    return {
      uiBorder: "#8b5cf6",
      uiSoft: "#f5f3ff",
      uiInk: "#5b21b6",
      uiStepActive: "#6d28d9",
      pdfHeader: rgb(0.27, 0.14, 0.55),
      pdfHeaderBorder: rgb(0.54, 0.36, 0.92),
      pdfBadge: rgb(0.65, 0.47, 0.96),
      pdfBadgeText: rgb(0.12, 0.04, 0.22),
      pdfSectionHead: rgb(0.42, 0.24, 0.75),
    };
  }

  return {
    uiBorder: "#2563eb",
    uiSoft: "#eff6ff",
    uiInk: "#1d4ed8",
    uiStepActive: "#1d4ed8",
    pdfHeader: rgb(0.05, 0.16, 0.34),
    pdfHeaderBorder: rgb(0.18, 0.39, 0.72),
    pdfBadge: rgb(0.37, 0.62, 0.99),
    pdfBadgeText: rgb(0.05, 0.13, 0.31),
    pdfSectionHead: rgb(0.16, 0.35, 0.66),
  };
}

function mapEmbedUrl(order: JobOrder) {
  if (!order.jobSite.lat || !order.jobSite.lng) return "";
  const lat = Number(order.jobSite.lat).toFixed(6);
  const lng = Number(order.jobSite.lng).toFixed(6);
  return `https://www.google.com/maps?q=${lat},${lng}&z=14&output=embed`;
}

function streetViewEmbedUrl(order: JobOrder) {
  if (!order.jobSite.lat || !order.jobSite.lng) return "";
  const lat = Number(order.jobSite.lat).toFixed(6);
  const lng = Number(order.jobSite.lng).toFixed(6);
  return `https://www.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0&output=svembed`;
}

function parseAddress(place: any) {
  const next = { street: "", city: "", state: "", zip: "" };
  let streetNumber = "";
  let route = "";
  for (const comp of place.address_components || []) {
    const types = comp.types || [];
    if (types.includes("street_number")) streetNumber = comp.long_name;
    if (types.includes("route")) route = comp.long_name;
    if (types.includes("locality")) next.city = comp.long_name;
    if (types.includes("administrative_area_level_1")) next.state = comp.short_name;
    if (types.includes("postal_code")) next.zip = comp.long_name;
  }
  next.street = [streetNumber, route].filter(Boolean).join(" ").trim();
  return next;
}

function createEmptyPosition(): LaborPosition {
  return {
    tradeRequested: "",
    workersNeeded: 1,
    languagePreference: "english",
    jobDescription: "",
    requirements: "",
    certificates: "",
    submittalProcess: "",
  };
}

function createEmptyVariableRate(): VariablePayRate {
  return {
    label: "",
    payRate: undefined,
    billRate: undefined,
    markupMultiplier: undefined,
  };
}

export function JobOrderFormWizard(props: {
  onBack: () => void;
  onSubmit?: (order: JobOrder, uploads: UploadState) => Promise<{ submissionId?: string } | void>;
}) {
  const [step, setStep] = useState(0);
  const [order, setOrder] = useState<JobOrder>(createEmptyJobOrder());
  const [uploads, setUploads] = useState<UploadState>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [placesReady, setPlacesReady] = useState(false);
  const [placesError, setPlacesError] = useState<string>("");
  const [addressCandidates, setAddressCandidates] = useState<AddressCandidate[]>([]);
  const [gcAddressCandidates, setGcAddressCandidates] = useState<AddressCandidate[]>([]);
  const [isResolvingGcAddress, setIsResolvingGcAddress] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [pdfResultUrl, setPdfResultUrl] = useState("");
  const [pdfResultMode, setPdfResultMode] = useState<"remote" | "local" | "">("");
  const [brandLogoSrc, setBrandLogoSrc] = useState("/assets/tc-logo.png");
  const [deviceLocation, setDeviceLocation] = useState<DeviceLocation | null>(null);
  const [jobSiteQuery, setJobSiteQuery] = useState("");
  const [submitBanner, setSubmitBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showSubmitConfirmation, setShowSubmitConfirmation] = useState(false);
  const [submitConfirmationChecks, setSubmitConfirmationChecks] = useState<Record<string, boolean>>({});

  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const addressAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const gcAddressInputRef = useRef<HTMLInputElement | null>(null);
  const gcAddressAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const issues = useMemo(() => validateJobOrder(order), [order]);
  const blockingErrors = issues.filter((i) => i.severity === "error");
  const mapUrl = mapEmbedUrl(order);
  const streetViewUrl = streetViewEmbedUrl(order);
  const heroImageUrl = "/assets/tc-intranet-hero.jpg";
  const placesKey = String(import.meta.env.VITE_GOOGLE_PLACES_API_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
  const enableFallbackAutocomplete = false;
  const hasPlacesKey = Boolean(placesKey);
  const placesUnavailableNotice = "Google Places API key is missing. Address autocomplete is disabled until the key is configured.";
  const effectiveLocation = deviceLocation || DALLAS_FALLBACK_LOCATION;
  const pay = Number(order.financial.payRate || 0);
  const bill = Number(order.financial.billRate || 0);
  const markup = Number(order.financial.markupMultiplier || 0);
  const computedMarkup = pay > 0 && bill > 0 ? bill / pay : 0;
  const computedBill = pay > 0 && markup > 0 ? pay * markup : 0;
  const activeTheme = useMemo(() => orderTypeTheme(order.orderType), [order.orderType]);
  const requestTypeBadge = useMemo(() => orderTypeBadgeText(order.orderType), [order.orderType]);
  const salesTeamMemberOptions = useMemo(() => {
    const next = [...SALES_TEAM_MEMBER_OPTIONS];
    const selected = String(order.internal.salesTeamMember || "").trim();
    if (selected && !next.includes(selected)) next.unshift(selected);
    return next;
  }, [order.internal.salesTeamMember]);
  const submitConfirmationItems = useMemo<SubmitConfirmationItem[]>(() => {
    const items: SubmitConfirmationItem[] = [];
    if (!String(order.financial.poNumber || "").trim()) {
      items.push({
        key: "poNumber",
        label: "I have verified that a pruchase order is not required on this site.",
      });
    }
    if (!order.onboarding.drugScreenRequired) {
      items.push({
        key: "drugScreenRequired",
        label: "I have verified that a drug screen is not required on this site.",
      });
    }
    if (!order.onboarding.backgroundRequired) {
      items.push({
        key: "backgroundRequired",
        label: "I have verified that a background check is not required on this site.",
      });
    }
    if (!order.compliance.cipWrap.enabled) {
      items.push({
        key: "cipWrap",
        label: "I have verified that CIP / Wrap is not required on this site.",
      });
    }
    if (!order.compliance.prevailingWage.enabled) {
      items.push({
        key: "prevailingWage",
        label: "I have verified that prevailing wage is not required on this site.",
      });
    }
    return items;
  }, [
    order.financial.poNumber,
    order.onboarding.drugScreenRequired,
    order.onboarding.backgroundRequired,
    order.compliance.cipWrap.enabled,
    order.compliance.prevailingWage.enabled,
  ]);
  const submitConfirmationReady = submitConfirmationItems.every((item) => Boolean(submitConfirmationChecks[item.key]));
  const hasTimesheetValues = Boolean(
    order.contacts.timesheet.name?.trim() ||
    order.contacts.timesheet.title?.trim() ||
    order.contacts.timesheet.phone?.trim() ||
    order.contacts.timesheet.email?.trim()
  );
  const hasGeneralContractorValues = Boolean(
    order.contacts.generalContractor.name?.trim() ||
    order.contacts.generalContractor.title?.trim() ||
    order.contacts.generalContractor.phone?.trim() ||
    order.contacts.generalContractor.email?.trim() ||
    order.contacts.gcAddress?.trim()
  );
  const hasAccountingValues = Boolean(
    order.contacts.accounting.name?.trim() ||
    order.contacts.accounting.title?.trim() ||
    order.contacts.accounting.phone?.trim() ||
    order.contacts.accounting.email?.trim()
  );
  const hasSafetyValues = Boolean(
    order.contacts.safety.name?.trim() ||
    order.contacts.safety.title?.trim() ||
    order.contacts.safety.phone?.trim() ||
    order.contacts.safety.email?.trim()
  );
  const hasOtherContactValues = Boolean(
    order.contacts.otherContact.name?.trim() ||
    order.contacts.otherContact.title?.trim() ||
    order.contacts.otherContact.phone?.trim() ||
    order.contacts.otherContact.email?.trim()
  );

  const updateOrder = (updater: (next: JobOrder) => JobOrder) => {
    setOrder((prev) => updater(prev));
  };

  useEffect(() => {
    if (!jobSiteQuery && order.jobSite.formattedAddress) {
      setJobSiteQuery(order.jobSite.formattedAddress);
    }
  }, [jobSiteQuery, order.jobSite.formattedAddress]);

  useEffect(() => {
    setSubmitConfirmationChecks((prev) => {
      const next: Record<string, boolean> = {};
      for (const item of submitConfirmationItems) {
        next[item.key] = prev[item.key] ?? false;
      }
      return next;
    });
    if (submitConfirmationItems.length === 0) {
      setShowSubmitConfirmation(false);
    }
  }, [submitConfirmationItems]);

  const updatePosition = (index: number, updater: (current: LaborPosition) => LaborPosition) => {
    updateOrder((prev) => ({
      ...prev,
      laborPositions: prev.laborPositions.map((position, idx) => (idx === index ? updater(position) : position)),
    }));
  };

  const addPosition = () => {
    updateOrder((prev) => ({
      ...prev,
      laborPositions: [...prev.laborPositions, createEmptyPosition()],
    }));
  };

  const addVariableRate = () => {
    updateOrder((prev) => ({
      ...prev,
      financial: {
        ...prev.financial,
        variableRates: [...prev.financial.variableRates, createEmptyVariableRate()],
      },
    }));
  };

  const updateVariableRate = (index: number, updater: (current: VariablePayRate) => VariablePayRate) => {
    updateOrder((prev) => ({
      ...prev,
      financial: {
        ...prev.financial,
        variableRates: prev.financial.variableRates.map((rate, idx) => (idx === index ? updater(rate) : rate)),
      },
    }));
  };

  const removeVariableRate = (index: number) => {
    updateOrder((prev) => ({
      ...prev,
      financial: {
        ...prev.financial,
        variableRates: prev.financial.variableRates.filter((_, idx) => idx !== index),
      },
    }));
  };

  const removePosition = (index: number) => {
    if (index === 0) return;
    updateOrder((prev) => ({
      ...prev,
      laborPositions: prev.laborPositions.filter((_, idx) => idx !== index),
    }));
  };

  useEffect(() => {
    return () => {
      if (pdfResultMode === "local" && pdfResultUrl.startsWith("blob:")) {
        URL.revokeObjectURL(pdfResultUrl);
      }
    };
  }, [pdfResultMode, pdfResultUrl]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeviceLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        // Keep fallback usable when permission is blocked/denied.
      },
      {
        enableHighAccuracy: false,
        timeout: 7000,
        maximumAge: 5 * 60 * 1000,
      }
    );
  }, []);

  function distanceInKm(aLat: number, aLng: number, bLat: number, bLng: number) {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const q = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
    return 6371 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
  }

  function locationBiasBounds(location: DeviceLocation) {
    return {
      north: location.lat + 0.35,
      south: location.lat - 0.35,
      east: location.lng + 0.45,
      west: location.lng - 0.45,
    };
  }

  useEffect(() => {
    let cancelled = false;

    const markReadyIfAvailable = () => {
      if ((window as any).google?.maps?.places) {
        if (!cancelled) {
          setPlacesReady(true);
          setPlacesError("");
        }
        return true;
      }
      return false;
    };

    const waitForPlaces = () => {
      let attempts = 0;
      const maxAttempts = 40;

      const poll = () => {
        if (cancelled) return;
        if (markReadyIfAvailable()) return;

        attempts += 1;
        if (attempts >= maxAttempts) {
          setPlacesReady(false);
          setPlacesError(`Google Places script loaded but Places library was unavailable for ${window.location.hostname}. Check API enablement and referrer settings.`);
          return;
        }
        window.setTimeout(poll, 150);
      };

      poll();
    };

    if ((window as any).google?.maps?.places) {
      setPlacesReady(true);
      setPlacesError("");
      return;
    }
    if (!placesKey) {
      setPlacesReady(false);
      setPlacesError("");
      return;
    }

    const existing = document.querySelector('script[data-google-places="web-services-job-order"]') as HTMLScriptElement | null;
    if (existing) {
      const onLoad = () => waitForPlaces();
      const onError = () => setPlacesError(`Google Places script failed to load for ${window.location.hostname}. Check API key and referrer restrictions.`);
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener("error", onError, { once: true });
      waitForPlaces();
      return () => {
        cancelled = true;
      };
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(placesKey)}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.setAttribute("data-google-places", "web-services-job-order");
      script.onload = () => {
      waitForPlaces();
    };
    script.onerror = () => setPlacesError(`Google Places script failed to load for ${window.location.hostname}. Check API key restrictions for this domain.`);
    document.body.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [placesKey]);

  async function resolveAddressCandidatesFromNominatim(value: string): Promise<AddressCandidate[]> {
    const input = String(value || "").trim();
    if (!input) return [];

    const hasLeadingStreetNumber = /^\d+/.test(input);
    const typedHouseNumber = hasLeadingStreetNumber ? (input.match(/^\d+/)?.[0] || "") : "";
    const hasStreetSuffix = /\b(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|ct|court|cir|circle|pkwy|parkway)\b/i.test(input);
    const searchQueries = [input];
    if (hasLeadingStreetNumber && !hasStreetSuffix) {
      searchQueries.push(`${input} road`, `${input} street`);
    }

    const fetchOne = async (query: string): Promise<NominatimResult[]> => {
      const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        addressdetails: "1",
        countrycodes: "us",
        limit: "8",
      });
      const west = effectiveLocation.lng - 1.2;
      const east = effectiveLocation.lng + 1.2;
      const north = effectiveLocation.lat + 0.9;
      const south = effectiveLocation.lat - 0.9;
      params.set("viewbox", `${west},${north},${east},${south}`);
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return [];
      return (await response.json()) as NominatimResult[];
    };

    const responses = await Promise.all(searchQueries.map((q) => fetchOne(q)));
    const flattened = responses.flat();
    const uniqueByDisplay = new Map<string, NominatimResult>();
    for (const item of flattened) {
      const key = String(item.display_name || "").trim();
      if (!key || uniqueByDisplay.has(key)) continue;
      uniqueByDisplay.set(key, item);
    }

    const ranked = Array.from(uniqueByDisplay.values())
      .map((item) => {
        const city = item.address?.city || item.address?.town || item.address?.village || item.address?.hamlet || "";
        const state = item.address?.state || "";
        const zip = item.address?.postcode || "";
        const lat = Number(item.lat || "");
        const lng = Number(item.lon || "");
        const display = String(item.display_name || "").toLowerCase();
        let score = 0;

        if (item.address?.country_code?.toLowerCase() === "us") score += 2;
        if (item.address?.road) score += 3;
        if (item.address?.house_number) score += 4;
        if (/\b(road|street|avenue|boulevard|drive|lane|parkway|way|court|circle)\b/.test(display)) score += 2;
        if (hasLeadingStreetNumber && /^\d+/.test(display)) score += 2;
        if (typedHouseNumber) {
          if (new RegExp(`\\b${typedHouseNumber}\\b`).test(display)) score += 10;
          else score -= 10;
        }
        if (hasLeadingStreetNumber && ["village", "hamlet", "town", "city", "administrative"].includes(String(item.type || ""))) score -= 7;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const kmAway = distanceInKm(effectiveLocation.lat, effectiveLocation.lng, lat, lng);
          if (kmAway <= 5) score += 6;
          else if (kmAway <= 20) score += 4;
          else if (kmAway <= 50) score += 2;
          else if (kmAway >= 600) score -= 5;
        }

        return {
          candidate: {
            formattedAddress: String(item.display_name || ""),
            street: [item.address?.house_number || "", item.address?.road || ""].filter(Boolean).join(" ").trim(),
            city,
            state,
            zip,
            lat: Number.isFinite(lat) ? lat : undefined,
            lng: Number.isFinite(lng) ? lng : undefined,
            placeId: item.place_id ? String(item.place_id) : "",
          } as AddressCandidate,
          score,
        };
      })
      .filter((x) => x.candidate.formattedAddress)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.candidate);

    if (typedHouseNumber) {
      const exactNumber = ranked.filter((candidate) => new RegExp(`\\b${typedHouseNumber}\\b`, "i").test(candidate.formattedAddress));
      if (exactNumber.length > 0) return exactNumber;
    }

    return ranked;
  }

  async function resolveAddressCandidates(value: string): Promise<AddressCandidate[]> {
    const g = (window as any).google;
    if (g?.maps?.Geocoder) {
      const geocoder = new g.maps.Geocoder();
      const results = await new Promise<any[]>((resolve) => {
        geocoder.geocode({ address: value }, (nextResults: any[] | null, status: string) => {
          if (status !== "OK" || !nextResults?.length) {
            resolve([]);
            return;
          }
          resolve(nextResults);
        });
      });
      const mapped = results.slice(0, 5).map((item) => {
        const parsed = parseAddress(item);
        return {
          formattedAddress: String(item.formatted_address || ""),
          street: parsed.street,
          city: parsed.city,
          state: parsed.state,
          zip: parsed.zip,
          lat: item.geometry?.location?.lat?.(),
          lng: item.geometry?.location?.lng?.(),
          placeId: String(item.place_id || ""),
        } as AddressCandidate;
      }).filter((x) => x.formattedAddress);
      if (mapped.length > 0) return mapped;
    }

    if (!enableFallbackAutocomplete) return [];
    return resolveAddressCandidatesFromNominatim(value);
  }

  useEffect(() => {
    if (placesReady || !enableFallbackAutocomplete) {
      setAddressCandidates([]);
      return;
    }

    const value = String(jobSiteQuery || "").trim();
    if (value.length < 5) {
      setAddressCandidates([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await resolveAddressCandidates(value);
        if (!cancelled) setAddressCandidates(next);
      } catch {
        if (!cancelled) setAddressCandidates([]);
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobSiteQuery, placesReady, effectiveLocation.lat, effectiveLocation.lng, enableFallbackAutocomplete]);

  function applyAddressCandidate(candidate: AddressCandidate) {
    updateOrder((p) => ({
      ...p,
      jobSite: {
        ...p.jobSite,
        address: candidate.street || candidate.formattedAddress,
        formattedAddress: candidate.formattedAddress,
        city: candidate.city || p.jobSite.city,
        state: candidate.state || p.jobSite.state,
        zip: candidate.zip || p.jobSite.zip,
        lat: candidate.lat ?? p.jobSite.lat,
        lng: candidate.lng ?? p.jobSite.lng,
        placeId: candidate.placeId || p.jobSite.placeId,
      },
    }));
    setJobSiteQuery(candidate.formattedAddress || candidate.street || "");
    setAddressCandidates([]);
    setPlacesError("");
  }

  useEffect(() => {
    if (placesReady || !enableFallbackAutocomplete) {
      setGcAddressCandidates([]);
      setIsResolvingGcAddress(false);
      return;
    }

    const value = String(order.contacts.gcAddress || "").trim();
    if (value.length < 5) {
      setGcAddressCandidates([]);
      setIsResolvingGcAddress(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setIsResolvingGcAddress(true);
        const next = await resolveAddressCandidates(value);
        if (!cancelled) setGcAddressCandidates(next);
      } catch {
        if (!cancelled) setGcAddressCandidates([]);
      } finally {
        if (!cancelled) setIsResolvingGcAddress(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [order.contacts.gcAddress, placesReady, enableFallbackAutocomplete]);

  function applyGcAddressCandidate(candidate: AddressCandidate) {
    updateOrder((p) => ({
      ...p,
      contacts: {
        ...p.contacts,
        gcAddress: candidate.formattedAddress,
      },
    }));
    setGcAddressCandidates([]);
    setPlacesError("");
  }

  useEffect(() => {
    if (!placesReady) return;
    try {
      if (addressInputRef.current && !addressAutocompleteRef.current) {
        const biasBounds = deviceLocation ? locationBiasBounds(deviceLocation) : undefined;
        const autocomplete = new google.maps.places.Autocomplete(addressInputRef.current, {
          types: ["address"],
          fields: ["address_components", "formatted_address", "geometry", "place_id"],
          componentRestrictions: { country: ["us"] },
          strictBounds: false,
          ...(biasBounds ? { bounds: biasBounds } : {}),
        });
        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace() as any;
          if (!place) return;
          const parsed = parseAddress(place);
          updateOrder((prev) => ({
            ...prev,
            jobSite: {
              ...prev.jobSite,
              address: String(parsed.street || place.formatted_address || prev.jobSite.address || ""),
              formattedAddress: String(place.formatted_address || ""),
              lat: place.geometry?.location?.lat?.() ?? prev.jobSite.lat,
              lng: place.geometry?.location?.lng?.() ?? prev.jobSite.lng,
              placeId: String(place.place_id || prev.jobSite.placeId || ""),
              city: parsed.city || prev.jobSite.city,
              state: parsed.state || prev.jobSite.state,
              zip: parsed.zip || prev.jobSite.zip,
            },
          }));
          setJobSiteQuery(String(place.formatted_address || parsed.street || ""));
          setPlacesError("");
        });
        addressAutocompleteRef.current = autocomplete;
      }

      if (addressAutocompleteRef.current && deviceLocation && typeof (addressAutocompleteRef.current as any).setBounds === "function") {
        (addressAutocompleteRef.current as any).setBounds(locationBiasBounds(deviceLocation));
      }

      if (gcAddressInputRef.current && !gcAddressAutocompleteRef.current) {
        const gcAutocomplete = new google.maps.places.Autocomplete(gcAddressInputRef.current, {
          types: ["address"],
          fields: ["formatted_address"],
          componentRestrictions: { country: ["us"] },
        });
        gcAutocomplete.addListener("place_changed", () => {
          const place = gcAutocomplete.getPlace() as any;
          if (!place) return;
          updateOrder((prev) => ({
            ...prev,
            contacts: {
              ...prev.contacts,
              gcAddress: String(place.formatted_address || prev.contacts.gcAddress || ""),
            },
          }));
          setGcAddressCandidates([]);
          setPlacesError("");
        });
        gcAddressAutocompleteRef.current = gcAutocomplete;
      }
    } catch {
      // Keep form usable even if Places fails.
    }
  }, [placesReady, deviceLocation]);

  function jumpToIssue(issue: ValidationIssue) {
    const targetStep = stepForField(issue.field);
    setStep(targetStep);
    window.setTimeout(() => {
      const el = document.querySelector(`[data-field="${issue.field}"]`) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof (el as any).focus === "function") (el as any).focus();
    }, 80);
  }

  async function runSubmit() {
    if (blockingErrors.length > 0) {
      setStep(5);
      return;
    }
    if (!props.onSubmit) return;
    setIsSubmitting(true);
    setSubmitBanner(null);
    try {
      const cleanClientName = String(order.clientName || "unknown_client")
        .trim()
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 50) || "unknown_client";
      const cleanTwid = String(order.twid || "no_twid")
        .trim()
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 24) || "no_twid";
      const submissionToken = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;

      const localPdfUrl = await generateLocalPdfUrl(order, uploads);
      const localPdfBlob = await fetch(localPdfUrl).then((res) => res.blob());
      const generatedPdf = new File(
        [localPdfBlob],
        `TalentCorps_${orderTypeSlug(order.orderType)}_${cleanTwid}_${cleanClientName}_${submissionToken}.pdf`,
        { type: "application/pdf" }
      );

      if (pdfResultMode === "local" && pdfResultUrl.startsWith("blob:")) {
        URL.revokeObjectURL(pdfResultUrl);
      }
      setPdfResultUrl(localPdfUrl);
      setPdfResultMode("local");
      setPdfError("");

      const nextUploads = { ...uploads, generatedPdf };
      setUploads(nextUploads);
      const result = await props.onSubmit(order, nextUploads);
      const submittedId = result && typeof result === "object" && "submissionId" in result ? result.submissionId : "";
      setSubmitBanner({
        type: "success",
        message: submittedId ? `Submission accepted by automated flow. Submission ID: ${submittedId}` : "Submission accepted by automated flow.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown submit error.";
      setSubmitBanner({ type: "error", message: `Submit failed: ${message}` });
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (blockingErrors.length > 0) {
      setStep(5);
      return;
    }
    if (submitConfirmationItems.length > 0 && !submitConfirmationReady) {
      setShowSubmitConfirmation(true);
      return;
    }
    await runSubmit();
  }

  async function handleSubmitFromConfirmation() {
    if (!submitConfirmationReady) {
      setSubmitBanner({ type: "error", message: "Please check all required confirmations before submitting." });
      return;
    }
    setShowSubmitConfirmation(false);
    await runSubmit();
  }

  async function generateLocalPdfUrl(nextOrder: JobOrder, nextUploads?: UploadState): Promise<string> {
    const pdfTheme = orderTypeTheme(nextOrder.orderType);
    const pdfRequestTypeLabel = orderTypeLabel(nextOrder.orderType);
    const pdfRequestTypeBadge = orderTypeBadgeText(nextOrder.orderType);
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pageWidth = 612;
    const margin = 34;
    let page = pdf.getPages()[0];
    let y = 758;
    const headerHeight = 56;
    const logoTargetHeight = 54;
    const headerTextPad = 12;
    let headerInset = 72;

    try {
      const logoRes = await fetch("/assets/tc-logo.png", { cache: "no-store" });
      if (logoRes.ok) {
        const logoBytes = await logoRes.arrayBuffer();
        const logo = await pdf.embedPng(logoBytes);
        const logoScale = logoTargetHeight / logo.height;
        const logoWidth = logo.width * logoScale;
        const logoHeight = logoTargetHeight;
        headerInset = Math.max(72, Math.ceil(logoWidth + 16));
        page.drawImage(logo, {
          x: margin,
          y: y - headerHeight + (headerHeight - logoHeight) / 2,
          width: logoWidth,
          height: logoHeight,
        });
      }
    } catch {
      // Keep PDF generation resilient when logo is unavailable.
    }

    page.drawRectangle({
      x: margin + headerInset,
      y: y - headerHeight,
      width: pageWidth - margin * 2 - headerInset,
      height: headerHeight,
      color: pdfTheme.pdfHeader,
      borderColor: pdfTheme.pdfHeaderBorder,
      borderWidth: 1,
    });

    const badgeX = margin + headerInset + 10;
    const badgeY = y - 16;
    const badgeWidth = 200;
    const badgeHeight = 14;
    page.drawRectangle({
      x: badgeX,
      y: badgeY,
      width: badgeWidth,
      height: badgeHeight,
      color: pdfTheme.pdfBadge,
      borderColor: pdfTheme.pdfBadge,
      borderWidth: 1,
    });
    page.drawText(pdfRequestTypeBadge, {
      x: badgeX + 6,
      y: badgeY + 3,
      size: 8,
      font: bold,
      color: pdfTheme.pdfBadgeText,
    });

    page.drawText("Talent Corps | Job Order Summary", {
      x: margin + headerInset + headerTextPad,
      y: y - 35,
      size: 17,
      font: bold,
      color: rgb(0.94, 0.97, 1.0),
    });
    page.drawText(`Generated: ${new Date().toLocaleString()}`, {
      x: margin + headerInset + headerTextPad,
      y: y - 50,
      size: 9,
      font,
      color: rgb(0.78, 0.85, 0.96),
    });

    y -= 78;

    const drawSection = (title: string, rows: Array<[string, string]>) => {
      const rowHeight = 16;
      const pad = 10;
      const sectionHeight = 28 + rows.length * rowHeight + pad;
      if (y - sectionHeight < 42) {
        page = pdf.addPage([612, 792]);
        y = 758;
      }

      page.drawRectangle({
        x: margin,
        y: y - sectionHeight,
        width: pageWidth - margin * 2,
        height: sectionHeight,
        color: rgb(0.95, 0.97, 1.0),
        borderColor: rgb(0.79, 0.86, 0.96),
        borderWidth: 1,
      });
      page.drawRectangle({
        x: margin,
        y: y - 24,
        width: pageWidth - margin * 2,
        height: 24,
        color: pdfTheme.pdfSectionHead,
      });
      page.drawText(title, {
        x: margin + 10,
        y: y - 16,
        size: 11,
        font: bold,
        color: rgb(1, 1, 1),
      });

      let rowY = y - 39;
      for (const [label, value] of rows) {
        page.drawText(`${label}:`, {
          x: margin + 10,
          y: rowY,
          size: 10,
          font: bold,
          color: rgb(0.1, 0.17, 0.28),
        });
        page.drawText(value || "-", {
          x: margin + 148,
          y: rowY,
          size: 10,
          font,
          color: rgb(0.15, 0.2, 0.3),
        });
        rowY -= rowHeight;
      }
      y -= sectionHeight + 10;
    };

    const fit = (value: string | undefined, max = 78) => {
      const raw = String(value || "-").trim();
      return raw.length > max ? `${raw.slice(0, max - 1)}...` : raw;
    };

    const wrapText = (text: string, maxChars = 92) => {
      const clean = String(text || "").replace(/\r\n/g, "\n");
      const paragraphs = clean.split("\n");
      const lines: string[] = [];
      for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
          lines.push("");
          continue;
        }
        let current = "";
        for (const word of words) {
          const next = current ? `${current} ${word}` : word;
          if (next.length > maxChars) {
            if (current) lines.push(current);
            current = word;
          } else {
            current = next;
          }
        }
        if (current) lines.push(current);
      }
      return lines;
    };

    const drawTextAttachment = (title: string, body: string) => {
      const lines = wrapText(body || "-", 94);
      const ensureSpace = (needed: number) => {
        if (y - needed < 42) {
          page = pdf.addPage([612, 792]);
          y = 758;
        }
      };

      ensureSpace(52);
      page.drawRectangle({
        x: margin,
        y: y - 26,
        width: pageWidth - margin * 2,
        height: 22,
        color: pdfTheme.pdfSectionHead,
      });
      page.drawText(title, {
        x: margin + 10,
        y: y - 18,
        size: 11,
        font: bold,
        color: rgb(1, 1, 1),
      });
      y -= 34;

      for (const line of lines) {
        ensureSpace(16);
        page.drawText(line || " ", {
          x: margin + 4,
          y,
          size: 10,
          font,
          color: rgb(0.15, 0.2, 0.3),
        });
        y -= 13;
      }
      y -= 8;
    };

    drawSection("Order Setup", [
      ["Request Type", pdfRequestTypeLabel],
      ["Request Badge", pdfRequestTypeBadge],
      ["Existing Job Order", nextOrder.parentJobOrderId || "-"],
      ["Existing Site", nextOrder.existingSiteReference || "-"],
      ["Sales Team Member", nextOrder.internal.salesTeamMember || "-"],
      ["Branch", nextOrder.internal.branch || "-"],
      ["End Date", nextOrder.endDate || "-"],
    ]);

    drawSection("Client & Project", [
      ["Client", nextOrder.clientName || "-"],
      ["Project", nextOrder.projectName || "-"],
      ["TWID", nextOrder.twid || "-"],
      ["Position Count", String(nextOrder.laborPositions.length || 0)],
    ]);

    drawSection("Internal Assignment", [
      ["Sales Team Member", nextOrder.internal.salesTeamMember || "-"],
      ["Branch", nextOrder.internal.branch || "-"],
      ["Internal Notes", fit(nextOrder.internal.notes || "-")],
    ]);

    drawSection("Scheduling", [
      ["Start", nextOrder.startDate || "-"],
      ["End", nextOrder.endDate || "-"],
      ["Shift Window", `${nextOrder.shiftStart || "-"} to ${nextOrder.shiftEnd || "-"}`],
      ["Schedule Days", nextOrder.scheduleDays.join(", ") || "-"],
      ["Shift Types", nextOrder.shiftTypes.join(", ") || "-"],
    ]);

    drawSection("Contacts", [
      ["Primary", fit(`${nextOrder.contacts.primary.name || "-"} (${nextOrder.contacts.primary.title || "-"}) | ${nextOrder.contacts.primary.email || "-"}`)],
      ["Supervisor", fit(`${nextOrder.contacts.supervisor.name || "-"} (${nextOrder.contacts.supervisor.title || "-"}) | ${nextOrder.contacts.supervisor.email || "-"}`)],
      ["Timesheet", fit(`${nextOrder.contacts.timesheet.name || "-"} (${nextOrder.contacts.timesheet.title || "-"}) | ${nextOrder.contacts.timesheet.email || "-"}`)],
      ["General Contractor", fit(`${nextOrder.contacts.generalContractor.name || "-"} | ${nextOrder.contacts.generalContractor.phone || "-"}`)],
      ["GC Address", fit(nextOrder.contacts.gcAddress || "-")],
      ["Accounting", fit(`${nextOrder.contacts.accounting.name || "-"} (${nextOrder.contacts.accounting.title || "-"}) | ${nextOrder.contacts.accounting.email || "-"}`)],
      ["Safety", fit(`${nextOrder.contacts.safety.name || "-"} (${nextOrder.contacts.safety.title || "-"}) | ${nextOrder.contacts.safety.email || "-"}`)],
      ["Other Contact", fit(`${nextOrder.contacts.otherContact.name || "-"} (${nextOrder.contacts.otherContact.title || "-"}) | ${nextOrder.contacts.otherContact.email || "-"}`)],
    ]);

    const longJobDescriptionAttachments: Array<{ title: string; body: string }> = [];
    nextOrder.laborPositions.forEach((position, index) => {
      const fullDescription = String(position.jobDescription || "").trim();
      const descriptionTooLong = fullDescription.length > 160;
      if (descriptionTooLong) {
        longJobDescriptionAttachments.push({
          title: `Attachment: Position ${index + 1} Full Job Description`,
          body: fullDescription,
        });
      }
      drawSection(`Position ${index + 1}`, [
        ["Trade", position.tradeRequested || "-"],
        ["Workers Needed", String(position.workersNeeded || "-")],
        ["Language", position.languagePreference || "-"],
        ["Job Description", descriptionTooLong ? `Attached - see Position ${index + 1} appendix` : fit(position.jobDescription || "-")],
        ["Requirements", fit(position.requirements || "-")],
        ["Certificates/Safety", fit(position.certificates || "-")],
        ["Submittal Process", fit(position.submittalProcess || "-")],
      ]);
    });

    const financialRows: Array<[string, string]> = [
      ["Pay Structure", nextOrder.financial.payStructure || "single"],
      ["Input Mode", nextOrder.financial.inputMode || "bill"],
      ["PO #", nextOrder.financial.poNumber || "-"],
    ];
    if (nextOrder.financial.payStructure === "single") {
      financialRows.push(
        ["Pay Rate", nextOrder.financial.payRate ? `$${nextOrder.financial.payRate.toFixed(2)}` : "-"],
        ["Bill Rate", nextOrder.financial.billRate ? `$${nextOrder.financial.billRate.toFixed(2)}` : "-"],
        ["Markup", nextOrder.financial.markupMultiplier ? String(nextOrder.financial.markupMultiplier) : "-"]
      );
    }
    if (nextOrder.financial.payStructure === "range") {
      financialRows.push(
        ["Pay Range", `${nextOrder.financial.minPayRate ? `$${nextOrder.financial.minPayRate.toFixed(2)}` : "-"} to ${nextOrder.financial.maxPayRate ? `$${nextOrder.financial.maxPayRate.toFixed(2)}` : "-"}`],
        ["Bill Range", `${nextOrder.financial.minBillRate ? `$${nextOrder.financial.minBillRate.toFixed(2)}` : "-"} to ${nextOrder.financial.maxBillRate ? `$${nextOrder.financial.maxBillRate.toFixed(2)}` : "-"}`]
      );
    }
    if (nextOrder.financial.payStructure === "multiple") {
      const count = nextOrder.financial.variableRates?.length || 0;
      financialRows.push(["Variable Rate Options", String(count)]);
      financialRows.push(["Variable Pay Notes", fit(nextOrder.financial.variablePayDescription || "-")]);
      if (count > 0) {
        const first = nextOrder.financial.variableRates[0];
        financialRows.push([
          "First Rate Option",
          fit(`${first.label || "Option 1"}: Pay ${first.payRate ? `$${first.payRate.toFixed(2)}` : "-"}, Bill ${first.billRate ? `$${first.billRate.toFixed(2)}` : "-"}, Markup ${first.markupMultiplier || "-"}`),
        ]);
      }
    }
    financialRows.push(
      ["Per Diem", nextOrder.perDiem.enabled ? `Yes ($${nextOrder.perDiem.amount || 0})` : "No"],
      ["Per Diem Notes", fit(nextOrder.perDiem.details || "-")],
      ["Travel Pay", nextOrder.travelPay.enabled ? `Yes ($${nextOrder.travelPay.amount || 0})` : "No"],
      ["Other", nextOrder.otherCompensation.enabled ? fit(nextOrder.otherCompensation.details || "Yes") : "No"]
    );
    drawSection("Rates & Conditions", financialRows);

    if (longJobDescriptionAttachments.length > 0) {
      for (const attachment of longJobDescriptionAttachments) {
        drawTextAttachment(attachment.title, attachment.body);
      }
    }

    const filesToAppend = Object.entries(nextUploads || {})
      .filter(([key, file]) => key !== "generatedPdf" && Boolean(file))
      .map(([key, file]) => ({ key, file: file as File }));

    const unsupportedAttachments: string[] = [];
    const imageExtensions = [".png", ".jpg", ".jpeg"];
    const imageMimeTypes = ["image/png", "image/jpeg", "image/jpg"];
    const isPdfFile = (file: File) => {
      const lower = String(file.name || "").toLowerCase();
      return file.type === "application/pdf" || lower.endsWith(".pdf");
    };
    const isImageFile = (file: File) => {
      const lower = String(file.name || "").toLowerCase();
      return imageMimeTypes.includes(file.type) || imageExtensions.some((ext) => lower.endsWith(ext));
    };

    const drawAttachmentHeading = (title: string) => {
      page = pdf.addPage([612, 792]);
      y = 758;
      page.drawRectangle({
        x: margin,
        y: y - 30,
        width: pageWidth - margin * 2,
        height: 24,
        color: pdfTheme.pdfSectionHead,
      });
      page.drawText(title, {
        x: margin + 10,
        y: y - 21,
        size: 11,
        font: bold,
        color: rgb(1, 1, 1),
      });
    };

    const appendImageAttachment = async (file: File, title: string) => {
      const bytes = await file.arrayBuffer();
      const lower = String(file.name || "").toLowerCase();
      const isPng = file.type === "image/png" || lower.endsWith(".png");
      const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

      drawAttachmentHeading(title);

      const drawWidthMax = pageWidth - margin * 2 - 20;
      const drawHeightMax = 700;
      const scale = Math.min(drawWidthMax / image.width, drawHeightMax / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      const drawX = margin + (pageWidth - margin * 2 - drawWidth) / 2;
      const drawY = 24 + (drawHeightMax - drawHeight) / 2;

      page.drawImage(image, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      });
    };

    const appendPdfAttachment = async (file: File, title: string) => {
      const bytes = await file.arrayBuffer();
      const attachmentPdf = await PDFDocument.load(bytes);
      const pageIndices = attachmentPdf.getPageIndices();
      if (pageIndices.length === 0) return;
      const copied = await pdf.copyPages(attachmentPdf, pageIndices);
      copied.forEach((copiedPage, index) => {
        if (index === 0) {
          drawAttachmentHeading(title);
          page.drawText("Attached PDF begins below.", {
            x: margin + 10,
            y: y - 44,
            size: 9,
            font,
            color: rgb(0.22, 0.28, 0.38),
          });
        }
        pdf.addPage(copiedPage);
      });
      page = pdf.getPages()[pdf.getPageCount() - 1];
      y = 758;
    };

    drawSection("Compliance & Onboarding", [
      ["CIP / Wrap", nextOrder.compliance.cipWrap.enabled ? "Yes" : "No"],
      [
        "Wrap Type",
        nextOrder.compliance.cipWrap.wrapTypes
          ? [
              nextOrder.compliance.cipWrap.wrapTypes.ocip ? "OCIP" : "",
              nextOrder.compliance.cipWrap.wrapTypes.ccip ? "CCIP" : "",
              nextOrder.compliance.cipWrap.wrapTypes.rocip ? "ROCIP" : "",
            ].filter(Boolean).join(", ") || "-"
          : "-",
      ],
      ["CIP Contact", fit(`${nextOrder.compliance.cipWrap.contact?.name || "-"} | ${nextOrder.compliance.cipWrap.contact?.phone || "-"} | ${nextOrder.compliance.cipWrap.contact?.email || "-"}`)],
      ["CIP Portal", fit(nextOrder.compliance.cipWrap.portalInformation || "-")],
      ["CIP Note", fit(nextOrder.compliance.cipWrap.note || "-")],
      ["Insurance Certificate Attached", nextOrder.compliance.cipWrap.insuranceCertificateAttached ? "Yes" : "No"],
      ["Drug Test Required", nextOrder.onboarding.drugScreenRequired ? "Yes" : "No"],
      ["Drug Test Type", nextOrder.onboarding.drugScreenType || "-"],
      ["Background Required", nextOrder.onboarding.backgroundRequired ? "Yes" : "No"],
      ["Background Period", nextOrder.onboarding.backgroundYears || "-"],
      ["Badging Required", nextOrder.onboarding.badgingRequired ? "Yes" : "No"],
      ["Badging Details", fit(nextOrder.onboarding.badgingDetails || "-")],
      ["Prevailing Wage", nextOrder.compliance.prevailingWage.enabled ? "Yes" : "No"],
      ["Certified Payroll", nextOrder.compliance.prevailingWage.certifiedPayrollRequired ? "Required" : "Not Required"],
      ["Prevailing Wage Contact", fit(`${nextOrder.compliance.prevailingWage.reportingContact?.name || "-"} | ${nextOrder.compliance.prevailingWage.reportingContact?.phone || "-"} | ${nextOrder.compliance.prevailingWage.reportingContact?.email || "-"}`)],
      ["Prevailing Portal", fit(nextOrder.compliance.prevailingWage.portalInformation || "-")],
      ["Prevailing Note", fit(nextOrder.compliance.prevailingWage.wageDeterminationNotes || "-")],
      ["Fringe", nextOrder.compliance.fringe.enabled ? "Yes" : "No"],
      ["Fringe Details", fit(nextOrder.compliance.fringe.details || "-")],
    ]);

    drawSection("Map & Site", [
      ["Site Address", nextOrder.jobSite.formattedAddress || nextOrder.jobSite.address || "-"],
      ["City/State/ZIP", `${nextOrder.jobSite.city || ""} ${nextOrder.jobSite.state || ""} ${nextOrder.jobSite.zip || ""}`.trim() || "-"],
      ["Coordinates", nextOrder.jobSite.lat && nextOrder.jobSite.lng ? `${nextOrder.jobSite.lat.toFixed(6)}, ${nextOrder.jobSite.lng.toFixed(6)}` : "-"],
    ]);

    const mapPanelHeight = 130;
    if (y - mapPanelHeight < 42) {
      page = pdf.addPage([612, 792]);
      y = 758;
    }
    page.drawRectangle({
      x: margin,
      y: y - mapPanelHeight,
      width: pageWidth - margin * 2,
      height: mapPanelHeight,
      color: rgb(0.96, 0.98, 1),
      borderColor: rgb(0.72, 0.82, 0.94),
      borderWidth: 1,
    });
    page.drawRectangle({
      x: margin + 10,
      y: y - mapPanelHeight + 10,
      width: pageWidth - margin * 2 - 20,
      height: mapPanelHeight - 20,
      color: rgb(0.9, 0.95, 1),
      borderColor: rgb(0.63, 0.74, 0.9),
      borderWidth: 1,
    });
    page.drawText("Map Panel", {
      x: margin + 18,
      y: y - 30,
      size: 12,
      font: bold,
      color: rgb(0.12, 0.22, 0.38),
    });

    const hasCoords = Boolean(nextOrder.jobSite.lat && nextOrder.jobSite.lng);
    if (hasCoords) {
      const staticMapBase = "https://maps.googleapis.com/maps/api/staticmap";
      const staticMapParams = new URLSearchParams({
        center: `${nextOrder.jobSite.lat},${nextOrder.jobSite.lng}`,
        zoom: "14",
        size: "640x220",
        scale: "2",
        maptype: "roadmap",
        markers: `color:red|${nextOrder.jobSite.lat},${nextOrder.jobSite.lng}`,
      });
      if (placesKey) staticMapParams.set("key", placesKey);

      try {
        const mapRes = await fetch(`${staticMapBase}?${staticMapParams.toString()}`, { cache: "no-store" });
        if (mapRes.ok) {
          const mapBytes = await mapRes.arrayBuffer();
          const contentType = String(mapRes.headers.get("content-type") || "").toLowerCase();
          const mapImg = contentType.includes("png")
            ? await pdf.embedPng(mapBytes)
            : await pdf.embedJpg(mapBytes);
          page.drawImage(mapImg, {
            x: margin + 16,
            y: y - mapPanelHeight + 16,
            width: pageWidth - margin * 2 - 32,
            height: mapPanelHeight - 36,
          });
        } else {
          page.drawText("Map preview unavailable for this record.", {
            x: margin + 18,
            y: y - 48,
            size: 10,
            font,
            color: rgb(0.2, 0.28, 0.4),
          });
        }
      } catch {
        page.drawText("Map preview unavailable for this record.", {
          x: margin + 18,
          y: y - 48,
          size: 10,
          font,
          color: rgb(0.2, 0.28, 0.4),
        });
      }
    } else {
      page.drawText("No coordinates available to render map preview.", {
        x: margin + 18,
        y: y - 48,
        size: 10,
        font,
        color: rgb(0.2, 0.28, 0.4),
      });
    }
    y -= mapPanelHeight + 8;

    // Always append uploaded files last so they appear at the end of the PDF.
    for (const { file, key } of filesToAppend) {
      const label = file.name || key;
      try {
        if (isPdfFile(file)) {
          await appendPdfAttachment(file, `Attachment: ${label}`);
          continue;
        }
        if (isImageFile(file)) {
          await appendImageAttachment(file, `Attachment: ${label}`);
          continue;
        }
        unsupportedAttachments.push(label);
      } catch {
        unsupportedAttachments.push(label);
      }
    }

    if (unsupportedAttachments.length > 0) {
      drawTextAttachment(
        "Attachment Note",
        `The following uploaded files were not appended to this PDF because their formats are not directly supported in-browser: ${unsupportedAttachments.join(", ")}.`
      );
    }

    const bytes = await pdf.save();
    const normalizedBytes = Uint8Array.from(bytes);
    return URL.createObjectURL(new Blob([normalizedBytes], { type: "application/pdf" }));
  }

  async function handleGeneratePdfResult() {
    setPdfError("");
    setIsGeneratingPdf(true);
    try {
      try {
        const localUrl = await generateLocalPdfUrl(order, uploads);
        if (pdfResultMode === "local" && pdfResultUrl.startsWith("blob:")) URL.revokeObjectURL(pdfResultUrl);
        setPdfResultMode("local");
        setPdfResultUrl(localUrl);
        return;
      } catch {
        // Fall through to backend generator.
      }

      try {
        const remote = await generateJobOrderPdf(order);
        if (remote?.pdfUrl) {
          if (pdfResultMode === "local" && pdfResultUrl.startsWith("blob:")) URL.revokeObjectURL(pdfResultUrl);
          setPdfResultMode("remote");
          setPdfResultUrl(remote.pdfUrl);
          return;
        }
        setPdfError("Could not generate PDF result. Please retry after saving required fields.");
      } catch {
        setPdfError("Could not generate PDF result. Please retry after saving required fields.");
      }
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  if (pdfResultUrl) {
    return (
      <div className="crm-card" style={{ maxWidth: 980, margin: "0 auto" }}>
        <div className="crm-topbar" style={{ alignItems: "flex-start" }}>
          <div>
            <h2 className="crm-title" style={{ fontSize: 24, marginBottom: 6 }}>Job Order PDF Result</h2>
            <p className="crm-sub" style={{ margin: 0 }}>
              {pdfResultMode === "remote" ? "Server-generated PDF preview." : "Client-generated PDF preview."}
            </p>
          </div>
          <div className="crm-row" style={{ gap: 8 }}>
            <button className="crm-btn-secondary" type="button" onClick={() => setPdfResultUrl("")}>Back to Review</button>
            <a className="crm-btn-primary" href={pdfResultUrl} target="_blank" rel="noreferrer">Open / Download PDF</a>
          </div>
        </div>
        <div className="crm-card" style={{ padding: 0, overflow: "hidden" }}>
          <iframe title="Job Order PDF Result" src={pdfResultUrl} style={{ width: "100%", minHeight: 760, border: 0 }} />
        </div>
      </div>
    );
  }

  return (
      <div className="crm-card job-order-shell" style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div
          className="job-order-hero"
          style={{
            backgroundImage: `linear-gradient(135deg, rgba(7,18,42,.88), rgba(11,35,83,.72)), url(${heroImageUrl})`,
          }}
        >
          <img
            src={brandLogoSrc}
            alt="Talent Corps"
            className="job-order-hero-logo"
            onError={() => setBrandLogoSrc("/assets/company-logo.svg")}
          />
          <div>
            <p className="job-order-kicker">Talent Corps Web Services</p>
            <h1 className="job-order-hero-title">Job Order Command Center</h1>
            <p className="job-order-hero-sub">Field-ready intake with route-safe addressing, map and street preview, and one-click PDF result output.</p>
          </div>
        </div>
      <div className="crm-topbar" style={{ alignItems: "flex-start" }}>
        <div>
          <h2 className="crm-title" style={{ fontSize: 24, marginBottom: 6 }}>Job Order Form</h2>
          <p className="crm-sub" style={{ margin: 0 }}>Mobile-first guided intake for field sales managers.</p>
        </div>
      </div>

      <div className="order-type-badge-row" style={{ marginBottom: 10 }}>
        <span className="order-type-badge" style={{ borderColor: activeTheme.uiBorder, color: activeTheme.uiInk, background: activeTheme.uiSoft }}>
          {requestTypeBadge}
        </span>
        <span className="crm-sub" style={{ margin: 0, color: activeTheme.uiInk }}>{orderTypeLabel(order.orderType)}</span>
      </div>

      <div className="crm-row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {STEP_LABELS.map((label, idx) => (
          <button
            key={label}
            type="button"
            className={idx === step ? "crm-chip crm-chip-active" : "crm-chip"}
            onClick={() => setStep(idx)}
            style={idx === step ? { cursor: "pointer", borderColor: activeTheme.uiBorder, color: activeTheme.uiInk, background: activeTheme.uiSoft } : { cursor: "pointer" }}
          >
            {idx + 1}. {label}
          </button>
        ))}
      </div>

      {step === 0 ? (
        <section className="crm-card" style={{ marginBottom: 10 }}>
          <h3 className="crm-section-title">1) Job Snapshot</h3>
          <div className="snapshot-grid">
            <div className="crm-card snapshot-section" style={{ borderColor: activeTheme.uiBorder, background: activeTheme.uiSoft }}>
              <div className="snapshot-section-head">
                <h4 className="crm-section-title" style={{ fontSize: 16, marginBottom: 0 }}>Order Setup</h4>
                <span className="order-type-badge" style={{ borderColor: activeTheme.uiBorder, color: activeTheme.uiInk, background: "#ffffff" }}>{requestTypeBadge}</span>
              </div>
              <div className="snapshot-form-grid-2">
                <select
                  data-field="orderType"
                  className="crm-input snapshot-full"
                  value={order.orderType}
                  onChange={(e) => {
                    const nextType = e.target.value as JobOrder["orderType"];
                    updateOrder((p) => ({ ...p, orderType: nextType }));
                  }}
                >
                  <option value="new">New Job Order</option>
                  <option value="append">Add to Existing Job Order</option>
                  <option value="new_for_existing_site">New Job Order for Existing Site</option>
                </select>
                {order.orderType === "append" ? (
                  <>
                    <input
                      data-field="parentJobOrderId"
                      className="crm-input"
                      placeholder="Existing Job Order ID / Lookup"
                      value={order.parentJobOrderId || ""}
                      onChange={(e) => updateOrder((p) => ({ ...p, parentJobOrderId: e.target.value }))}
                    />
                    <input
                      data-field="existingSiteReference"
                      className="crm-input"
                      placeholder="Existing Site / Client Reference"
                      value={order.existingSiteReference || ""}
                      onChange={(e) => updateOrder((p) => ({ ...p, existingSiteReference: e.target.value }))}
                    />
                    <textarea
                      data-field="changeReason"
                      className="crm-input snapshot-full"
                      rows={2}
                      placeholder="Change Reason"
                      value={order.changeReason || ""}
                      onChange={(e) => updateOrder((p) => ({ ...p, changeReason: e.target.value }))}
                    />
                  </>
                ) : null}
                {order.orderType === "new_for_existing_site" ? (
                  <>
                    <input
                      data-field="existingSiteReference"
                      className="crm-input"
                      placeholder="Existing Site / Client Reference"
                      value={order.existingSiteReference || ""}
                      onChange={(e) => updateOrder((p) => ({ ...p, existingSiteReference: e.target.value }))}
                    />
                    <div />
                    <textarea
                      data-field="changeReason"
                      className="crm-input snapshot-full"
                      rows={2}
                      placeholder="Reason for separate order"
                      value={order.changeReason || ""}
                      onChange={(e) => updateOrder((p) => ({ ...p, changeReason: e.target.value }))}
                    />
                  </>
                ) : null}
              </div>
              <p className="crm-sub" style={{ marginTop: 8, marginBottom: 2, color: activeTheme.uiInk }}>New Job Order: Creates a new job order record.</p>
              <p className="crm-sub" style={{ marginTop: 0, marginBottom: 2, color: activeTheme.uiInk }}>Add to Existing Job Order: Updates an existing order and logs changes.</p>
              <p className="crm-sub" style={{ marginTop: 0, marginBottom: 0, color: activeTheme.uiInk }}>New Job Order for Existing Site: Creates a separate order tied to the same site.</p>
            </div>

            <div className="crm-card snapshot-section">
              <h4 className="crm-section-title" style={{ fontSize: 16 }}>Job Basics</h4>
              <div className="snapshot-form-grid-3">
                <input data-field="clientName" className="crm-input" placeholder="Client / Company Name" value={order.clientName} onChange={(e) => updateOrder((p) => ({ ...p, clientName: e.target.value }))} />
                <input className="crm-input" placeholder="TempWorks ID (TWID)" value={order.twid || ""} onChange={(e) => updateOrder((p) => ({ ...p, twid: e.target.value }))} />
                <input data-field="projectName" className="crm-input" placeholder="Project Name" value={order.projectName} onChange={(e) => updateOrder((p) => ({ ...p, projectName: e.target.value }))} />
              </div>
            </div>

            <div className="crm-card snapshot-section">
              <h4 className="crm-section-title" style={{ fontSize: 16 }}>Job Site</h4>
              <div className="snapshot-form-grid-site">
                <div className="snapshot-full snapshot-address-autocomplete">
                  <input
                    data-field="jobSite.address"
                    ref={addressInputRef}
                    className="crm-input snapshot-full"
                    placeholder={placesReady ? "Work Site Address (select a suggested address)" : "Work Site Address"}
                    value={jobSiteQuery}
                    onChange={(e) => {
                      const value = e.target.value;
                      setJobSiteQuery(value);
                    }}
                  />
                  {!placesReady && addressCandidates.length > 0 ? (
                    <div className="snapshot-address-autocomplete-menu" role="listbox" aria-label="Job site suggestions">
                      {addressCandidates.map((candidate) => (
                        <button
                          key={candidate.formattedAddress}
                          type="button"
                          className="snapshot-address-autocomplete-option"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyAddressCandidate(candidate);
                          }}
                        >
                          {candidate.formattedAddress}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <input
                  className="crm-input snapshot-full"
                  placeholder="Street"
                  value={order.jobSite.address}
                  onChange={(e) => updateOrder((p) => ({ ...p, jobSite: { ...p.jobSite, address: e.target.value } }))}
                />
                <input
                  className="crm-input"
                  placeholder="City"
                  value={order.jobSite.city}
                  onChange={(e) => updateOrder((p) => ({ ...p, jobSite: { ...p.jobSite, city: e.target.value } }))}
                />
                <input
                  className="crm-input"
                  placeholder="State"
                  value={order.jobSite.state}
                  onChange={(e) => updateOrder((p) => ({ ...p, jobSite: { ...p.jobSite, state: e.target.value } }))}
                />
                <input
                  className="crm-input"
                  placeholder="ZIP"
                  value={order.jobSite.zip}
                  onChange={(e) => updateOrder((p) => ({ ...p, jobSite: { ...p.jobSite, zip: e.target.value } }))}
                />
              </div>
            </div>

            <div className="crm-card snapshot-section">
              <h4 className="crm-section-title" style={{ fontSize: 16 }}>Assignment Schedule</h4>
              <div className="snapshot-form-grid-2">
                <div>
                  <p className="crm-sub" style={{ marginTop: 0, marginBottom: 6 }}>Start Date</p>
                  <input data-field="startDate" className="crm-input" type="date" value={order.startDate || ""} onChange={(e) => updateOrder((p) => ({ ...p, startDate: e.target.value }))} />
                </div>
                <div>
                  <p className="crm-sub" style={{ marginTop: 0, marginBottom: 6 }}>End Date</p>
                  <input data-field="endDate" className="crm-input" type="date" value={order.endDate || ""} onChange={(e) => updateOrder((p) => ({ ...p, endDate: e.target.value }))} />
                </div>
                <div>
                  <p className="crm-sub" style={{ marginTop: 0, marginBottom: 6 }}>Start Time</p>
                  <input className="crm-input" type="time" value={order.shiftStart || ""} onChange={(e) => updateOrder((p) => ({ ...p, shiftStart: e.target.value }))} />
                </div>
                <div>
                  <p className="crm-sub" style={{ marginTop: 0, marginBottom: 6 }}>End Time</p>
                  <input className="crm-input" type="time" value={order.shiftEnd || ""} onChange={(e) => updateOrder((p) => ({ ...p, shiftEnd: e.target.value }))} />
                </div>
                <label className="crm-row snapshot-full" style={{ gap: 8, marginTop: 2 }}>
                  <input
                    data-field="isLongTermProject"
                    type="checkbox"
                    checked={order.isLongTermProject}
                    onChange={(e) => updateOrder((p) => ({
                      ...p,
                      isLongTermProject: e.target.checked,
                      reviewDateType: e.target.checked ? "check_in_60_day" : "end_date",
                    }))}
                  />
                  Long-term project
                </label>
                {order.isLongTermProject ? (
                  <p className="crm-sub snapshot-full" style={{ marginTop: 0, marginBottom: 0 }}>
                    End Date remains required and must stay within 60 days of Start Date.
                  </p>
                ) : null}
                <div className="snapshot-full">
                  <p className="crm-sub" style={{ marginTop: 0, marginBottom: 8 }}>Schedule Days</p>
                  <div className="crm-row" style={{ flexWrap: "wrap", gap: 8 }}>
                    {WEEK_DAYS.map((day) => {
                      const checked = order.scheduleDays.includes(day);
                      return (
                        <label key={day} className="crm-chip" data-field="scheduleDays" style={{ cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const enabled = e.target.checked;
                              updateOrder((p) => ({
                                ...p,
                                scheduleDays: enabled
                                  ? Array.from(new Set([...p.scheduleDays, day]))
                                  : p.scheduleDays.filter((d) => d !== day),
                              }));
                            }}
                          />
                          <span>{day}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="snapshot-full" data-field="shiftTypes">
                  <p className="crm-sub" style={{ marginTop: 0, marginBottom: 8 }}>Shift Types</p>
                  <div className="crm-row" style={{ gap: 10 }}>
                    <label className="crm-chip" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={order.shiftTypes.includes("day")}
                        onChange={(e) => updateOrder((p) => ({
                          ...p,
                          shiftTypes: e.target.checked
                            ? Array.from(new Set([...p.shiftTypes, "day"]))
                            : p.shiftTypes.filter((x) => x !== "day"),
                        }))}
                      />
                      <span>Day Shift</span>
                    </label>
                    <label className="crm-chip" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={order.shiftTypes.includes("night")}
                        onChange={(e) => updateOrder((p) => ({
                          ...p,
                          shiftTypes: e.target.checked
                            ? Array.from(new Set([...p.shiftTypes, "night"]))
                            : p.shiftTypes.filter((x) => x !== "night"),
                        }))}
                      />
                      <span>Night Shift</span>
                    </label>
                  </div>
                </div>
                <textarea className="crm-input snapshot-full" rows={2} placeholder="Shift Notes" value={order.shiftNotes || ""} onChange={(e) => updateOrder((p) => ({ ...p, shiftNotes: e.target.value }))} />
              </div>
            </div>
          </div>
          <p className="crm-muted" style={{ marginTop: 8 }}>
            {hasPlacesKey
              ? placesReady
                ? "Google Places ready. Start typing and pick an address from the dropdown suggestions."
                  : "Google dropdown unavailable for this host. Update API key referrer restrictions to include this domain."
              : placesUnavailableNotice}
          </p>
            {hasPlacesKey && placesError ? <p className="crm-error" style={{ marginTop: 6 }}>{placesError}</p> : null}
          {mapUrl ? (
            <div style={{ marginTop: 10 }}>
                <div className="snapshot-map-grid">
                  <iframe title="Job Site Map" src={mapUrl} style={{ width: "100%", minHeight: 240, border: 0, borderRadius: 10 }} loading="lazy" />
                  <iframe title="Job Site Street View" src={streetViewUrl || mapUrl} style={{ width: "100%", minHeight: 240, border: 0, borderRadius: 10 }} loading="lazy" />
                </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 1 ? (
        <section className="crm-card" style={{ marginBottom: 10 }}>
          <h3 className="crm-section-title">2) Contacts</h3>
          <div className="contacts-step-grid">
            <div className="crm-card contacts-group contacts-group-primary">
              <h4 className="crm-section-title" style={{ fontSize: 15, marginBottom: 10 }}>Primary Contact</h4>
              <div className="contacts-fields-grid">
                <input data-field="contacts.primary.name" className="crm-input" placeholder="Primary Contact Name" value={order.contacts.primary.name} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, primary: { ...p.contacts.primary, name: e.target.value } } }))} />
                <input className="crm-input" placeholder="Primary Contact Title" value={order.contacts.primary.title || ""} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, primary: { ...p.contacts.primary, title: e.target.value } } }))} />
                <input className="crm-input" placeholder="Primary Contact Phone" value={order.contacts.primary.phone} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, primary: { ...p.contacts.primary, phone: e.target.value } } }))} />
                <input className="crm-input" placeholder="Primary Contact Email" value={order.contacts.primary.email} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, primary: { ...p.contacts.primary, email: e.target.value } } }))} />
              </div>
            </div>

            <div className="crm-card contacts-group contacts-group-primary">
              <h4 className="crm-section-title" style={{ fontSize: 15, marginBottom: 10 }}>Site Supervisor</h4>
              <div className="contacts-fields-grid">
                <input className="crm-input" placeholder="Site Supervisor Name" value={order.contacts.supervisor.name} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, supervisor: { ...p.contacts.supervisor, name: e.target.value } } }))} />
                <input className="crm-input" placeholder="Site Supervisor Title" value={order.contacts.supervisor.title || ""} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, supervisor: { ...p.contacts.supervisor, title: e.target.value } } }))} />
                <input className="crm-input" placeholder="Site Supervisor Phone" value={order.contacts.supervisor.phone} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, supervisor: { ...p.contacts.supervisor, phone: e.target.value } } }))} />
                <input className="crm-input" placeholder="Site Supervisor Email" value={order.contacts.supervisor.email} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, supervisor: { ...p.contacts.supervisor, email: e.target.value } } }))} />
              </div>
            </div>

            <div className="crm-card contacts-group contacts-group-secondary">
              <h4 className="crm-section-title" style={{ fontSize: 14, marginBottom: 6 }}>Additional Contacts</h4>
              <p className="crm-sub" style={{ marginTop: 0, marginBottom: 10 }}>Optional contacts for timesheets and site coordination.</p>

              <details className="contacts-disclosure" open={hasTimesheetValues}>
                <summary className="contacts-disclosure-summary">Timesheet Contact</summary>
                <div className="contacts-fields-grid" style={{ marginTop: 8 }}>
                  <input className="crm-input" placeholder="Timesheet Contact Name" value={order.contacts.timesheet.name} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, timesheet: { ...p.contacts.timesheet, name: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Timesheet Contact Title" value={order.contacts.timesheet.title || ""} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, timesheet: { ...p.contacts.timesheet, title: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Timesheet Contact Phone" value={order.contacts.timesheet.phone} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, timesheet: { ...p.contacts.timesheet, phone: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Timesheet Contact Email" value={order.contacts.timesheet.email} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, timesheet: { ...p.contacts.timesheet, email: e.target.value } } }))} />
                </div>
              </details>

              <details className="contacts-disclosure" open={hasGeneralContractorValues}>
                <summary className="contacts-disclosure-summary">General Contractor</summary>
                <div className="contacts-fields-grid" style={{ marginTop: 8 }}>
                  <input className="crm-input" placeholder="General Contractor Name" value={order.contacts.generalContractor.name} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, generalContractor: { ...p.contacts.generalContractor, name: e.target.value } } }))} />
                  <input className="crm-input" placeholder="General Contractor Title" value={order.contacts.generalContractor.title || ""} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, generalContractor: { ...p.contacts.generalContractor, title: e.target.value } } }))} />
                  <input className="crm-input" placeholder="General Contractor Phone" value={order.contacts.generalContractor.phone} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, generalContractor: { ...p.contacts.generalContractor, phone: e.target.value } } }))} />
                  <input className="crm-input" placeholder="General Contractor Email" value={order.contacts.generalContractor.email} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, generalContractor: { ...p.contacts.generalContractor, email: e.target.value } } }))} />
                  <input
                    data-field="contacts.gcAddress"
                    ref={gcAddressInputRef}
                    className="crm-input contacts-full"
                    placeholder={placesReady ? "General Contractor Address (select a suggested address)" : "General Contractor Address"}
                    value={order.contacts.gcAddress || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setGcAddressCandidates([]);
                      updateOrder((p) => ({ ...p, contacts: { ...p.contacts, gcAddress: value } }));
                    }}
                  />
                </div>

                {gcAddressCandidates.length > 0 ? (
                  <div className="crm-card" style={{ marginTop: 8, padding: 8 }}>
                    <p className="crm-sub" style={{ marginTop: 0, marginBottom: 8 }}>General contractor address matches</p>
                    <div className="crm-grid" style={{ gap: 6 }}>
                      {gcAddressCandidates.map((candidate) => (
                        <button
                          key={candidate.formattedAddress}
                          className="crm-btn-secondary"
                          type="button"
                          style={{ textAlign: "left" }}
                          onClick={() => applyGcAddressCandidate(candidate)}
                        >
                          {candidate.formattedAddress}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </details>

              <details className="contacts-disclosure" open={hasAccountingValues}>
                <summary className="contacts-disclosure-summary">Accounting Contact</summary>
                <div className="contacts-fields-grid" style={{ marginTop: 8 }}>
                  <input className="crm-input" placeholder="Accounting Contact Name" value={order.contacts.accounting.name} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, accounting: { ...p.contacts.accounting, name: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Accounting Contact Title" value={order.contacts.accounting.title || ""} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, accounting: { ...p.contacts.accounting, title: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Accounting Contact Phone" value={order.contacts.accounting.phone} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, accounting: { ...p.contacts.accounting, phone: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Accounting Contact Email" value={order.contacts.accounting.email} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, accounting: { ...p.contacts.accounting, email: e.target.value } } }))} />
                </div>
              </details>

              <details className="contacts-disclosure" open={hasSafetyValues}>
                <summary className="contacts-disclosure-summary">Safety Contact</summary>
                <div className="contacts-fields-grid" style={{ marginTop: 8 }}>
                  <input className="crm-input" placeholder="Safety Contact Name" value={order.contacts.safety.name} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, safety: { ...p.contacts.safety, name: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Safety Contact Title" value={order.contacts.safety.title || ""} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, safety: { ...p.contacts.safety, title: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Safety Contact Phone" value={order.contacts.safety.phone} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, safety: { ...p.contacts.safety, phone: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Safety Contact Email" value={order.contacts.safety.email} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, safety: { ...p.contacts.safety, email: e.target.value } } }))} />
                </div>
              </details>

              <details className="contacts-disclosure" open={hasOtherContactValues}>
                <summary className="contacts-disclosure-summary">Other Contact</summary>
                <div className="contacts-fields-grid" style={{ marginTop: 8 }}>
                  <input className="crm-input" placeholder="Other Contact Name" value={order.contacts.otherContact.name} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, otherContact: { ...p.contacts.otherContact, name: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Other Contact Title" value={order.contacts.otherContact.title || ""} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, otherContact: { ...p.contacts.otherContact, title: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Other Contact Phone" value={order.contacts.otherContact.phone} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, otherContact: { ...p.contacts.otherContact, phone: e.target.value } } }))} />
                  <input className="crm-input" placeholder="Other Contact Email" value={order.contacts.otherContact.email} onChange={(e) => updateOrder((p) => ({ ...p, contacts: { ...p.contacts, otherContact: { ...p.contacts.otherContact, email: e.target.value } } }))} />
                </div>
              </details>

              {!hasPlacesKey ? <p className="crm-muted" style={{ marginTop: 10 }}>{placesUnavailableNotice}</p> : null}
              {isResolvingGcAddress ? <p className="crm-sub" style={{ marginTop: 6 }}>Finding address matches...</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="crm-card" style={{ marginBottom: 10 }}>
          <h3 className="crm-section-title">3) Labor Request</h3>
          <div className="labor-layout-grid">
            {order.laborPositions.map((position, index) => {
              const hasSubmittalInstructions = Boolean(position.submittalProcess?.trim());
              return (
                <div key={`position-${index}`} className="crm-card labor-position-card">
                  <div className="labor-position-head">
                    <h4 className="crm-section-title" style={{ fontSize: 16, marginBottom: 0 }}>Position {index + 1}</h4>
                    {index > 0 ? (
                      <button className="crm-btn-secondary" type="button" onClick={() => removePosition(index)}>Remove Position</button>
                    ) : null}
                  </div>

                  <div className="crm-card labor-section">
                    <h5 className="crm-section-title" style={{ fontSize: 14 }}>A. Labor Basics</h5>
                    <div className="labor-basics-grid">
                      <input
                        data-field={`laborPositions.${index}.tradeRequested`}
                        className="crm-input labor-trade"
                        placeholder="Trade Requested"
                        value={position.tradeRequested}
                        onChange={(e) => updatePosition(index, (p) => ({ ...p, tradeRequested: e.target.value }))}
                      />
                      <input
                        data-field={`laborPositions.${index}.workersNeeded`}
                        className="crm-input labor-workers"
                        type="number"
                        min={1}
                        placeholder="Workers Needed"
                        value={position.workersNeeded}
                        onChange={(e) => updatePosition(index, (p) => ({ ...p, workersNeeded: Number(e.target.value || 1) }))}
                      />
                      <select
                        className="crm-input labor-language"
                        value={position.languagePreference}
                        onChange={(e) => updatePosition(index, (p) => ({ ...p, languagePreference: e.target.value as LaborPosition["languagePreference"] }))}
                      >
                        <option value="english">English</option>
                        <option value="bilingual">Bilingual</option>
                        <option value="spanish">Spanish</option>
                        <option value="no_preference">No Preference</option>
                      </select>
                    </div>
                  </div>

                  <div className="crm-card labor-section labor-overview-card">
                    <h5 className="crm-section-title" style={{ fontSize: 14 }}>B. Job Overview</h5>
                    <textarea
                      className="crm-input"
                      rows={4}
                      placeholder="Job Description"
                      value={position.jobDescription}
                      onChange={(e) => updatePosition(index, (p) => ({ ...p, jobDescription: e.target.value }))}
                    />
                  </div>

                  <div className="crm-card labor-section">
                    <h5 className="crm-section-title" style={{ fontSize: 14 }}>C. Requirements</h5>
                    <div className="labor-full-stack">
                      <textarea
                        className="crm-input"
                        rows={3}
                        placeholder="Requirements"
                        value={position.requirements}
                        onChange={(e) => updatePosition(index, (p) => ({ ...p, requirements: e.target.value }))}
                      />
                      <textarea
                        className="crm-input"
                        rows={2}
                        placeholder="Certificates / Safety Requirements"
                        value={position.certificates}
                        onChange={(e) => updatePosition(index, (p) => ({ ...p, certificates: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="crm-card labor-section labor-optional-section">
                    <details className="labor-disclosure" open={hasSubmittalInstructions}>
                      <summary className="labor-disclosure-summary">D. Submission Instructions (Optional)</summary>
                      <div className="labor-full-stack" style={{ marginTop: 8 }}>
                        <textarea
                          className="crm-input"
                          rows={2}
                          placeholder="Submittal Process"
                          value={position.submittalProcess}
                          onChange={(e) => updatePosition(index, (p) => ({ ...p, submittalProcess: e.target.value }))}
                        />
                      </div>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="crm-row" style={{ marginTop: 10 }}>
            <button className="crm-btn-secondary" type="button" onClick={addPosition}>+ Add Another Position</button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="crm-card" style={{ marginBottom: 10 }}>
          <h3 className="crm-section-title">4) Pay + Conditions</h3>
          <div className="pay-layout-grid">
            <div className="crm-card pay-section">
              <h4 className="crm-section-title" style={{ fontSize: 16 }}>Pay Setup</h4>
              <div className="pay-mode-toggle" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className={order.financial.payStructure === "single" ? "crm-btn-primary" : "crm-btn-secondary"}
                  style={order.financial.payStructure === "single" ? { background: activeTheme.uiStepActive } : undefined}
                  onClick={() => updateOrder((p) => ({
                    ...p,
                    financial: {
                      ...p.financial,
                      payStructure: "single",
                    },
                  }))}
                >
                  Single Pay
                </button>
                <button
                  type="button"
                  className={order.financial.payStructure === "range" ? "crm-btn-primary" : "crm-btn-secondary"}
                  style={order.financial.payStructure === "range" ? { background: activeTheme.uiStepActive } : undefined}
                  onClick={() => updateOrder((p) => ({
                    ...p,
                    financial: {
                      ...p.financial,
                      payStructure: "range",
                    },
                  }))}
                >
                  Pay Range
                </button>
                <button
                  type="button"
                  className={order.financial.payStructure === "multiple" ? "crm-btn-primary" : "crm-btn-secondary"}
                  style={order.financial.payStructure === "multiple" ? { background: activeTheme.uiStepActive } : undefined}
                  onClick={() => updateOrder((p) => ({
                    ...p,
                    financial: {
                      ...p.financial,
                      payStructure: "multiple",
                      variableRates: p.financial.variableRates.length ? p.financial.variableRates : [createEmptyVariableRate()],
                    },
                  }))}
                >
                  Multiple Pay Rates
                </button>
              </div>
              <div className="pay-mode-toggle" style={{ padding: 8, borderRadius: 10, border: `1px solid ${activeTheme.uiBorder}`, background: activeTheme.uiSoft }}>
                <button
                  type="button"
                  className={order.financial.inputMode === "bill" ? "crm-btn-primary" : "crm-btn-secondary"}
                  style={order.financial.inputMode === "bill" ? { background: activeTheme.uiStepActive } : undefined}
                  onClick={() => updateOrder((p) => {
                    let derivedMarkup = p.financial.markupMultiplier;
                    if (p.financial.payStructure === "single") {
                      const nextPay = Number(p.financial.payRate || 0);
                      const nextBill = Number(p.financial.billRate || 0);
                      derivedMarkup = nextPay > 0 && nextBill > 0 ? Number((nextBill / nextPay).toFixed(4)) : p.financial.markupMultiplier;
                    }
                    if (p.financial.payStructure === "range") {
                      const minPay = Number(p.financial.minPayRate || 0);
                      const minBill = Number(p.financial.minBillRate || 0);
                      derivedMarkup = minPay > 0 && minBill > 0 ? Number((minBill / minPay).toFixed(4)) : p.financial.markupMultiplier;
                    }
                    if (p.financial.payStructure === "multiple") {
                      const normalized = p.financial.variableRates.map((rate) => {
                        const pay = Number(rate.payRate || 0);
                        const bill = Number(rate.billRate || 0);
                        const nextMarkup = pay > 0 && bill > 0 ? Number((bill / pay).toFixed(4)) : rate.markupMultiplier;
                        return { ...rate, markupMultiplier: nextMarkup };
                      });
                      return {
                        ...p,
                        financial: { ...p.financial, inputMode: "bill", variableRates: normalized, markupMultiplier: derivedMarkup },
                      };
                    }
                    return {
                      ...p,
                      financial: { ...p.financial, inputMode: "bill", markupMultiplier: derivedMarkup },
                    };
                  })}
                >
                  By Bill Rate(s)
                </button>
                <button
                  type="button"
                  className={order.financial.inputMode === "markup" ? "crm-btn-primary" : "crm-btn-secondary"}
                  style={order.financial.inputMode === "markup" ? { background: activeTheme.uiStepActive } : undefined}
                  onClick={() => updateOrder((p) => {
                    let derivedBill = p.financial.billRate;
                    const nextMarkup = Number(p.financial.markupMultiplier || 0);
                    if (p.financial.payStructure === "single") {
                      const nextPay = Number(p.financial.payRate || 0);
                      derivedBill = nextPay > 0 && nextMarkup > 0 ? Number((nextPay * nextMarkup).toFixed(2)) : p.financial.billRate;
                    }
                    if (p.financial.payStructure === "range") {
                      const minPay = Number(p.financial.minPayRate || 0);
                      const maxPay = Number(p.financial.maxPayRate || 0);
                      const minBill = minPay > 0 && nextMarkup > 0 ? Number((minPay * nextMarkup).toFixed(2)) : p.financial.minBillRate;
                      const maxBill = maxPay > 0 && nextMarkup > 0 ? Number((maxPay * nextMarkup).toFixed(2)) : p.financial.maxBillRate;
                      return {
                        ...p,
                        financial: { ...p.financial, inputMode: "markup", minBillRate: minBill, maxBillRate: maxBill },
                      };
                    }
                    if (p.financial.payStructure === "multiple") {
                      const normalized = p.financial.variableRates.map((rate) => {
                        const pay = Number(rate.payRate || 0);
                        const markup = Number(rate.markupMultiplier || 0);
                        const nextBill = pay > 0 && markup > 0 ? Number((pay * markup).toFixed(2)) : rate.billRate;
                        return { ...rate, billRate: nextBill };
                      });
                      return {
                        ...p,
                        financial: { ...p.financial, inputMode: "markup", variableRates: normalized },
                      };
                    }
                    return {
                      ...p,
                      financial: { ...p.financial, inputMode: "markup", billRate: derivedBill },
                    };
                  })}
                >
                  By Markup
                </button>
              </div>
              <p className="crm-muted" style={{ marginTop: 8, marginBottom: 0 }}>
                {order.financial.payStructure === "single"
                  ? order.financial.inputMode === "bill"
                    ? "Bill-rate mode: enter pay + bill, markup auto-calculates."
                    : "Markup mode: enter pay + markup, bill auto-calculates."
                  : order.financial.payStructure === "range"
                    ? order.financial.inputMode === "bill"
                      ? "Range mode (Bill): enter minimum and maximum pay + bill rates."
                      : "Range mode (Markup): enter pay range + markup, bill range auto-calculates."
                    : "Multiple mode: add each pay option with its own pay/bill/markup."}
              </p>
            </div>

            <div className="crm-card pay-section">
              <h4 className="crm-section-title" style={{ fontSize: 16 }}>Rates</h4>
              {order.financial.payStructure === "single" ? (
                <div className="pay-rates-grid">
                  <input data-field="financial.payRate" className="crm-input" type="number" step="0.01" placeholder="Pay Rate" value={order.financial.payRate ?? ""} onChange={(e) => updateOrder((p) => {
                    const nextPay = Number(e.target.value || 0) || undefined;
                    const currentBill = Number(p.financial.billRate || 0);
                    const currentMarkup = Number(p.financial.markupMultiplier || 0);
                    const nextBill = p.financial.inputMode === "markup" && nextPay && currentMarkup > 0
                      ? Number((nextPay * currentMarkup).toFixed(2))
                      : p.financial.billRate;
                    const nextMarkup = p.financial.inputMode === "bill" && nextPay && currentBill > 0
                      ? Number((currentBill / nextPay).toFixed(4))
                      : p.financial.markupMultiplier;
                    return {
                      ...p,
                      financial: {
                        ...p.financial,
                        payRate: nextPay,
                        billRate: nextBill,
                        markupMultiplier: nextMarkup,
                      },
                    };
                  })} />
                  <input
                    data-field="financial.billRate"
                    className={`crm-input ${order.financial.inputMode === "markup" ? "pay-result-input" : ""}`}
                    type="number"
                    step="0.01"
                    placeholder="Bill Rate"
                    value={order.financial.inputMode === "markup" ? (computedBill > 0 ? computedBill.toFixed(2) : "") : (order.financial.billRate ?? "")}
                    disabled={order.financial.inputMode === "markup"}
                    onChange={(e) => updateOrder((p) => {
                      const nextBill = Number(e.target.value || 0) || undefined;
                      const nextPay = Number(p.financial.payRate || 0);
                      const nextMarkup = nextPay > 0 && nextBill ? Number((nextBill / nextPay).toFixed(4)) : p.financial.markupMultiplier;
                      return {
                        ...p,
                        financial: {
                          ...p.financial,
                          billRate: nextBill,
                          markupMultiplier: nextMarkup,
                        },
                      };
                    })}
                  />
                  <input
                    data-field="financial.markupMultiplier"
                    className={`crm-input ${order.financial.inputMode === "bill" ? "pay-result-input" : ""}`}
                    type="number"
                    step="0.01"
                    placeholder="Mark-up / Multiplier"
                    value={order.financial.inputMode === "bill" ? (computedMarkup > 0 ? computedMarkup.toFixed(2) : "") : (order.financial.markupMultiplier ?? "")}
                    disabled={order.financial.inputMode === "bill"}
                    onChange={(e) => updateOrder((p) => {
                      const nextMarkup = Number(e.target.value || 0) || undefined;
                      const nextPay = Number(p.financial.payRate || 0);
                      const nextBill = nextPay > 0 && nextMarkup ? Number((nextPay * nextMarkup).toFixed(2)) : p.financial.billRate;
                      return {
                        ...p,
                        financial: {
                          ...p.financial,
                          markupMultiplier: nextMarkup,
                          billRate: nextBill,
                        },
                      };
                    })}
                  />
                  <input className="crm-input" placeholder="PO #" value={order.financial.poNumber || ""} onChange={(e) => updateOrder((p) => ({ ...p, financial: { ...p.financial, poNumber: e.target.value } }))} />
                </div>
              ) : null}

              {order.financial.payStructure === "range" ? (
                <div className="pay-rates-grid pay-rates-grid-range">
                  {order.financial.inputMode === "bill" ? (
                    <div className="pay-range-stack">
                      <div className="pay-range-row">
                        <div className="pay-field">
                          <label className="pay-field-label">Min Pay Rate</label>
                          <input data-field="financial.minPayRate" className="crm-input" type="number" step="0.01" value={order.financial.minPayRate ?? ""} onChange={(e) => updateOrder((p) => {
                            const minPay = Number(e.target.value || 0) || undefined;
                            const minBill = Number(p.financial.minBillRate || 0);
                            const nextMarkup = minPay && minBill > 0 ? Number((minBill / minPay).toFixed(4)) : p.financial.markupMultiplier;
                            return { ...p, financial: { ...p.financial, minPayRate: minPay, markupMultiplier: nextMarkup } };
                          })} />
                        </div>
                        <div className="pay-field">
                          <label className="pay-field-label">Min Bill Rate</label>
                          <input data-field="financial.minBillRate" className="crm-input" type="number" step="0.01" value={order.financial.minBillRate ?? ""} onChange={(e) => updateOrder((p) => {
                            const minBill = Number(e.target.value || 0) || undefined;
                            const minPay = Number(p.financial.minPayRate || 0);
                            const nextMarkup = minPay > 0 && minBill ? Number((minBill / minPay).toFixed(4)) : p.financial.markupMultiplier;
                            return { ...p, financial: { ...p.financial, minBillRate: minBill, markupMultiplier: nextMarkup } };
                          })} />
                        </div>
                        <div className="pay-field">
                          <label className="pay-field-label">Min Markup (Result)</label>
                          <input className="crm-input pay-result-input" type="number" step="0.0001" value={(() => {
                            const pay = Number(order.financial.minPayRate || 0);
                            const bill = Number(order.financial.minBillRate || 0);
                            return pay > 0 && bill > 0 ? Number((bill / pay).toFixed(4)) : "";
                          })()} disabled />
                        </div>
                      </div>
                      <div className="pay-range-row">
                        <div className="pay-field">
                          <label className="pay-field-label">Max Pay Rate</label>
                          <input data-field="financial.maxPayRate" className="crm-input" type="number" step="0.01" value={order.financial.maxPayRate ?? ""} onChange={(e) => updateOrder((p) => {
                            const maxPay = Number(e.target.value || 0) || undefined;
                            const maxBill = Number(p.financial.maxBillRate || 0);
                            const nextMarkup = maxPay && maxBill > 0 ? Number((maxBill / maxPay).toFixed(4)) : p.financial.markupMultiplier;
                            return { ...p, financial: { ...p.financial, maxPayRate: maxPay, markupMultiplier: nextMarkup } };
                          })} />
                        </div>
                        <div className="pay-field">
                          <label className="pay-field-label">Max Bill Rate</label>
                          <input data-field="financial.maxBillRate" className="crm-input" type="number" step="0.01" value={order.financial.maxBillRate ?? ""} onChange={(e) => updateOrder((p) => {
                            const maxBill = Number(e.target.value || 0) || undefined;
                            const maxPay = Number(p.financial.maxPayRate || 0);
                            const nextMarkup = maxPay > 0 && maxBill ? Number((maxBill / maxPay).toFixed(4)) : p.financial.markupMultiplier;
                            return { ...p, financial: { ...p.financial, maxBillRate: maxBill, markupMultiplier: nextMarkup } };
                          })} />
                        </div>
                        <div className="pay-field">
                          <label className="pay-field-label">Max Markup (Result)</label>
                          <input className="crm-input pay-result-input" type="number" step="0.0001" value={(() => {
                            const pay = Number(order.financial.maxPayRate || 0);
                            const bill = Number(order.financial.maxBillRate || 0);
                            return pay > 0 && bill > 0 ? Number((bill / pay).toFixed(4)) : "";
                          })()} disabled />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="pay-range-stack">
                      <div className="pay-range-row">
                        <div className="pay-field">
                          <label className="pay-field-label">Markup</label>
                          <input data-field="financial.markupMultiplier" className="crm-input" type="number" step="0.0001" value={order.financial.markupMultiplier ?? ""} onChange={(e) => updateOrder((p) => {
                            const nextMarkup = Number(e.target.value || 0) || undefined;
                            const minPay = Number(p.financial.minPayRate || 0);
                            const maxPay = Number(p.financial.maxPayRate || 0);
                            const minBill = minPay > 0 && (nextMarkup || 0) > 0 ? Number((minPay * Number(nextMarkup)).toFixed(2)) : p.financial.minBillRate;
                            const maxBill = maxPay > 0 && (nextMarkup || 0) > 0 ? Number((maxPay * Number(nextMarkup)).toFixed(2)) : p.financial.maxBillRate;
                            return { ...p, financial: { ...p.financial, markupMultiplier: nextMarkup, minBillRate: minBill, maxBillRate: maxBill } };
                          })} />
                        </div>
                        <div className="pay-field">
                          <label className="pay-field-label">Min Pay Rate</label>
                          <input data-field="financial.minPayRate" className="crm-input" type="number" step="0.01" value={order.financial.minPayRate ?? ""} onChange={(e) => updateOrder((p) => {
                            const minPay = Number(e.target.value || 0) || undefined;
                            const markupValue = Number(p.financial.markupMultiplier || 0);
                            const minBill = minPay && markupValue > 0 ? Number((minPay * markupValue).toFixed(2)) : p.financial.minBillRate;
                            return { ...p, financial: { ...p.financial, minPayRate: minPay, minBillRate: minBill } };
                          })} />
                        </div>
                        <div className="pay-field">
                          <label className="pay-field-label">Min Bill Rate (Result)</label>
                          <input className="crm-input pay-result-input" type="number" step="0.01" value={(() => {
                            const pay = Number(order.financial.minPayRate || 0);
                            const markup = Number(order.financial.markupMultiplier || 0);
                            return pay > 0 && markup > 0 ? Number((pay * markup).toFixed(2)) : "";
                          })()} disabled />
                        </div>
                      </div>
                      <div className="pay-range-row">
                        <div className="pay-field">
                          <label className="pay-field-label">Markup</label>
                          <input data-field="financial.markupMultiplier" className="crm-input" type="number" step="0.0001" value={order.financial.markupMultiplier ?? ""} onChange={(e) => updateOrder((p) => {
                            const nextMarkup = Number(e.target.value || 0) || undefined;
                            const minPay = Number(p.financial.minPayRate || 0);
                            const maxPay = Number(p.financial.maxPayRate || 0);
                            const minBill = minPay > 0 && (nextMarkup || 0) > 0 ? Number((minPay * Number(nextMarkup)).toFixed(2)) : p.financial.minBillRate;
                            const maxBill = maxPay > 0 && (nextMarkup || 0) > 0 ? Number((maxPay * Number(nextMarkup)).toFixed(2)) : p.financial.maxBillRate;
                            return { ...p, financial: { ...p.financial, markupMultiplier: nextMarkup, minBillRate: minBill, maxBillRate: maxBill } };
                          })} />
                        </div>
                        <div className="pay-field">
                          <label className="pay-field-label">Max Pay Rate</label>
                          <input data-field="financial.maxPayRate" className="crm-input" type="number" step="0.01" value={order.financial.maxPayRate ?? ""} onChange={(e) => updateOrder((p) => {
                            const maxPay = Number(e.target.value || 0) || undefined;
                            const markupValue = Number(p.financial.markupMultiplier || 0);
                            const maxBill = maxPay && markupValue > 0 ? Number((maxPay * markupValue).toFixed(2)) : p.financial.maxBillRate;
                            return { ...p, financial: { ...p.financial, maxPayRate: maxPay, maxBillRate: maxBill } };
                          })} />
                        </div>
                        <div className="pay-field">
                          <label className="pay-field-label">Max Bill Rate (Result)</label>
                          <input className="crm-input pay-result-input" type="number" step="0.01" value={(() => {
                            const pay = Number(order.financial.maxPayRate || 0);
                            const markup = Number(order.financial.markupMultiplier || 0);
                            return pay > 0 && markup > 0 ? Number((pay * markup).toFixed(2)) : "";
                          })()} disabled />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="pay-field pay-full">
                    <label className="pay-field-label">PO #</label>
                    <input className="crm-input" value={order.financial.poNumber || ""} onChange={(e) => updateOrder((p) => ({ ...p, financial: { ...p.financial, poNumber: e.target.value } }))} />
                  </div>
                </div>
              ) : null}

              {order.financial.payStructure === "multiple" ? (
                <>
                  <div className="crm-row" style={{ marginBottom: 8 }}>
                    <button className="crm-btn-secondary" type="button" onClick={addVariableRate}>+ Add Pay Option</button>
                  </div>
                  <div className="crm-grid" style={{ gap: 8 }}>
                    {order.financial.variableRates.map((rate, idx) => {
                      const computedOptionBill = Number(rate.payRate || 0) > 0 && Number(rate.markupMultiplier || 0) > 0
                        ? Number((Number(rate.payRate || 0) * Number(rate.markupMultiplier || 0)).toFixed(2))
                        : undefined;
                      const computedOptionMarkup = Number(rate.payRate || 0) > 0 && Number(rate.billRate || 0) > 0
                        ? Number((Number(rate.billRate || 0) / Number(rate.payRate || 0)).toFixed(4))
                        : undefined;
                      return (
                        <div className="crm-card" key={`variable-rate-${idx}`} style={{ padding: 10 }}>
                          <div className="crm-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <strong>Rate Option {idx + 1}</strong>
                            <button className="crm-btn-secondary" type="button" onClick={() => removeVariableRate(idx)}>Remove</button>
                          </div>
                          <div className="pay-rates-grid pay-rates-grid-multiple">
                            {order.financial.inputMode === "bill" ? (
                              <>
                                <div className="pay-field">
                                  <label className="pay-field-label">Pay Rate</label>
                                  <input className="crm-input" type="number" step="0.01" value={rate.payRate ?? ""} onChange={(e) => updateVariableRate(idx, (r) => {
                                    const nextPay = Number(e.target.value || 0) || undefined;
                                    const nextBill = Number(r.billRate || 0);
                                    const nextMarkup = nextPay && nextBill > 0
                                      ? Number((nextBill / nextPay).toFixed(4))
                                      : r.markupMultiplier;
                                    return { ...r, payRate: nextPay, markupMultiplier: nextMarkup };
                                  })} />
                                </div>
                                <div className="pay-field">
                                  <label className="pay-field-label">Bill Rate</label>
                                  <input className="crm-input" type="number" step="0.01" value={rate.billRate ?? ""} onChange={(e) => updateVariableRate(idx, (r) => {
                                    const nextBill = Number(e.target.value || 0) || undefined;
                                    const nextMarkup = Number(r.payRate || 0) > 0 && nextBill
                                      ? Number((nextBill / Number(r.payRate || 0)).toFixed(4))
                                      : r.markupMultiplier;
                                    return { ...r, billRate: nextBill, markupMultiplier: nextMarkup };
                                  })} />
                                </div>
                                <div className="pay-field">
                                  <label className="pay-field-label">Markup (Result)</label>
                                  <input className="crm-input pay-result-input" type="number" step="0.0001" value={computedOptionMarkup ?? ""} disabled />
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="pay-field">
                                  <label className="pay-field-label">Markup</label>
                                  <input className="crm-input" type="number" step="0.0001" value={rate.markupMultiplier ?? ""} onChange={(e) => updateVariableRate(idx, (r) => {
                                    const nextMarkup = Number(e.target.value || 0) || undefined;
                                    const nextBill = Number(r.payRate || 0) > 0 && nextMarkup
                                      ? Number((Number(r.payRate || 0) * nextMarkup).toFixed(2))
                                      : r.billRate;
                                    return { ...r, markupMultiplier: nextMarkup, billRate: nextBill };
                                  })} />
                                </div>
                                <div className="pay-field">
                                  <label className="pay-field-label">Pay Rate</label>
                                  <input className="crm-input" type="number" step="0.01" value={rate.payRate ?? ""} onChange={(e) => updateVariableRate(idx, (r) => {
                                    const nextPay = Number(e.target.value || 0) || undefined;
                                    const nextBill = nextPay && Number(r.markupMultiplier || 0) > 0
                                      ? Number((nextPay * Number(r.markupMultiplier || 0)).toFixed(2))
                                      : r.billRate;
                                    return { ...r, payRate: nextPay, billRate: nextBill };
                                  })} />
                                </div>
                                <div className="pay-field">
                                  <label className="pay-field-label">Bill Rate (Result)</label>
                                  <input className="crm-input pay-result-input" type="number" step="0.01" value={computedOptionBill ?? ""} disabled />
                                </div>
                              </>
                            )}
                          </div>
                          <div className="pay-field" style={{ marginTop: 8 }}>
                            <label className="pay-field-label">Description</label>
                            <input className="crm-input" value={rate.label || ""} onChange={(e) => updateVariableRate(idx, (r) => ({ ...r, label: e.target.value }))} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <input className="crm-input pay-full" placeholder="PO #" value={order.financial.poNumber || ""} onChange={(e) => updateOrder((p) => ({ ...p, financial: { ...p.financial, poNumber: e.target.value } }))} style={{ marginTop: 8 }} />
                </>
              ) : null}
            </div>

            <div className="crm-card pay-section">
              <h4 className="crm-section-title" style={{ fontSize: 16 }}>Extras</h4>
              <div className="crm-card" style={{ padding: 10 }}>
                <label className="crm-row" style={{ gap: 8 }}><input type="checkbox" checked={order.perDiem.enabled} onChange={(e) => updateOrder((p) => ({ ...p, perDiem: { ...p.perDiem, enabled: e.target.checked } }))} /> Per Diem Applies</label>
                {order.perDiem.enabled ? (
                  <>
                    <div className="pay-rates-grid" style={{ marginTop: 8 }}>
                      <input data-field="perDiem.amount" className="crm-input" type="number" step="0.01" placeholder="Per Diem Amount" value={order.perDiem.amount ?? ""} onChange={(e) => updateOrder((p) => ({ ...p, perDiem: { ...p.perDiem, amount: Number(e.target.value || 0) || null } }))} />
                      <input data-field="perDiem.days" className="crm-input" type="number" placeholder="Days Paid" value={order.perDiem.days ?? ""} onChange={(e) => updateOrder((p) => ({ ...p, perDiem: { ...p.perDiem, days: Number(e.target.value || 0) || null } }))} />
                    </div>
                    <textarea
                      data-field="perDiem.details"
                      className="crm-input"
                      rows={2}
                      style={{ marginTop: 8 }}
                      placeholder="Per Diem Notes"
                      value={order.perDiem.details || ""}
                      onChange={(e) => updateOrder((p) => ({ ...p, perDiem: { ...p.perDiem, details: e.target.value } }))}
                    />
                  </>
                ) : null}
              </div>

              <div className="crm-card" style={{ marginTop: 8, padding: 10 }}>
                <label className="crm-row" style={{ gap: 8 }}><input type="checkbox" checked={order.travelPay.enabled} onChange={(e) => updateOrder((p) => ({ ...p, travelPay: { ...p.travelPay, enabled: e.target.checked } }))} /> Travel Pay Applies</label>
                {order.travelPay.enabled ? (
                  <div className="pay-rates-grid" style={{ marginTop: 8 }}>
                    <input data-field="travelPay.amount" className="crm-input" type="number" step="0.01" placeholder="Travel Pay Amount" value={order.travelPay.amount ?? ""} onChange={(e) => updateOrder((p) => ({ ...p, travelPay: { ...p.travelPay, amount: Number(e.target.value || 0) || null } }))} />
                    <input className="crm-input" placeholder="Travel Pay Details" value={order.travelPay.details || ""} onChange={(e) => updateOrder((p) => ({ ...p, travelPay: { ...p.travelPay, details: e.target.value } }))} />
                  </div>
                ) : null}
              </div>

              <div className="crm-card" style={{ marginTop: 8, padding: 10 }}>
                <label className="crm-row" style={{ gap: 8 }}><input type="checkbox" checked={order.otherCompensation.enabled} onChange={(e) => updateOrder((p) => ({ ...p, otherCompensation: { ...p.otherCompensation, enabled: e.target.checked } }))} /> Other Applies</label>
                {order.otherCompensation.enabled ? (
                  <div className="pay-rates-grid" style={{ marginTop: 8 }}>
                    <input data-field="otherCompensation.details" className="crm-input pay-full" placeholder="Include any attendance bonuses, travel, etc." value={order.otherCompensation.details || ""} onChange={(e) => updateOrder((p) => ({ ...p, otherCompensation: { ...p.otherCompensation, details: e.target.value } }))} />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="crm-card pay-section">
              <h4 className="crm-section-title" style={{ fontSize: 16 }}>Internal Assignment</h4>
              <div className="pay-rates-grid">
                <select
                  data-field="internal.salesTeamMember"
                  className="crm-input"
                  value={order.internal.salesTeamMember}
                  onChange={(e) => updateOrder((p) => ({ ...p, internal: { ...p.internal, salesTeamMember: e.target.value } }))}
                >
                  <option value="">Select Sales Team Member</option>
                  {salesTeamMemberOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <select
                  data-field="internal.branch"
                  className="crm-input"
                  value={order.internal.branch}
                  onChange={(e) => updateOrder((p) => ({ ...p, internal: { ...p.internal, branch: e.target.value } }))}
                >
                  <option value="">Select Branch</option>
                  {BRANCH_OPTIONS.map((branch) => (
                    <option key={branch} value={branch}>{branch}</option>
                  ))}
                </select>
                <textarea className="crm-input pay-full" rows={2} placeholder="Internal Notes" value={order.internal.notes || ""} onChange={(e) => updateOrder((p) => ({ ...p, internal: { ...p.internal, notes: e.target.value } }))} />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="crm-card" style={{ marginBottom: 10 }}>
          <h3 className="crm-section-title">5) Compliance + Onboarding</h3>

          <div className="crm-card" style={{ marginTop: 8 }}>
            <h4 className="crm-section-title" style={{ fontSize: 16 }}>Onboarding Requirements</h4>
            <label className="crm-row" style={{ gap: 8 }}><input type="checkbox" checked={order.onboarding.badgingRequired} onChange={(e) => updateOrder((p) => ({ ...p, onboarding: { ...p.onboarding, badgingRequired: e.target.checked } }))} /> Badging Required</label>
            {order.onboarding.badgingRequired ? (
              <input data-field="onboarding.badgingDetails" className="crm-input" placeholder="Badging requirements" value={order.onboarding.badgingDetails || ""} onChange={(e) => updateOrder((p) => ({ ...p, onboarding: { ...p.onboarding, badgingDetails: e.target.value } }))} />
            ) : null}

            <label className="crm-row" style={{ gap: 8, marginTop: 8 }}><input type="checkbox" checked={order.onboarding.drugScreenRequired} onChange={(e) => updateOrder((p) => ({ ...p, onboarding: { ...p.onboarding, drugScreenRequired: e.target.checked } }))} /> Drug Screen Required</label>
            {order.onboarding.drugScreenRequired ? (
              <div className="crm-grid filters-2" style={{ marginTop: 8 }}>
                <select data-field="onboarding.drugScreenType" className="crm-input" value={order.onboarding.drugScreenType} onChange={(e) => updateOrder((p) => ({ ...p, onboarding: { ...p.onboarding, drugScreenType: e.target.value as JobOrder["onboarding"]["drugScreenType"] } }))}>
                  <option value="">Select Drug Screen Type</option>
                  <option value="5_panel">5-Panel</option>
                  <option value="10_panel">10-Panel</option>
                  <option value="in_house_swab">In-House Swab</option>
                  <option value="other">Other</option>
                </select>
                <input className="crm-input" placeholder="Drug screen details" value={order.onboarding.drugScreenDetails || ""} onChange={(e) => updateOrder((p) => ({ ...p, onboarding: { ...p.onboarding, drugScreenDetails: e.target.value } }))} />
              </div>
            ) : null}

            <label className="crm-row" style={{ gap: 8, marginTop: 8 }}><input type="checkbox" checked={order.onboarding.backgroundRequired} onChange={(e) => updateOrder((p) => ({ ...p, onboarding: { ...p.onboarding, backgroundRequired: e.target.checked } }))} /> Background Required</label>
            {order.onboarding.backgroundRequired ? (
              <div className="crm-grid filters-2" style={{ marginTop: 8 }}>
                <input data-field="onboarding.backgroundYears" className="crm-input" placeholder="Background period (e.g. 7 Year)" value={order.onboarding.backgroundYears || ""} onChange={(e) => updateOrder((p) => ({ ...p, onboarding: { ...p.onboarding, backgroundYears: e.target.value } }))} />
                <input className="crm-input" placeholder="Background requirements" value={order.onboarding.backgroundDetails || ""} onChange={(e) => updateOrder((p) => ({ ...p, onboarding: { ...p.onboarding, backgroundDetails: e.target.value } }))} />
              </div>
            ) : null}
          </div>

          <div className="crm-card" style={{ marginTop: 8 }}>
            <label className="crm-row" style={{ gap: 8 }}><input type="checkbox" checked={order.compliance.cipWrap.enabled} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, cipWrap: { ...p.compliance.cipWrap, enabled: e.target.checked } } }))} /> CIP / Wrap Applies</label>
            {order.compliance.cipWrap.enabled ? (
              <>
                <div className="crm-grid filters-3" style={{ marginTop: 8 }}>
                  <label className="crm-row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(order.compliance.cipWrap.wrapTypes?.ocip)}
                      onChange={(e) => updateOrder((p) => ({
                        ...p,
                        compliance: {
                          ...p.compliance,
                          cipWrap: {
                            ...p.compliance.cipWrap,
                            wrapTypes: {
                              ...(p.compliance.cipWrap.wrapTypes || { ocip: false, ccip: false, rocip: false }),
                              ocip: e.target.checked,
                            },
                          },
                        },
                      }))}
                    />
                    OCIP
                  </label>
                  <label className="crm-row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(order.compliance.cipWrap.wrapTypes?.ccip)}
                      onChange={(e) => updateOrder((p) => ({
                        ...p,
                        compliance: {
                          ...p.compliance,
                          cipWrap: {
                            ...p.compliance.cipWrap,
                            wrapTypes: {
                              ...(p.compliance.cipWrap.wrapTypes || { ocip: false, ccip: false, rocip: false }),
                              ccip: e.target.checked,
                            },
                          },
                        },
                      }))}
                    />
                    CCIP
                  </label>
                  <label className="crm-row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(order.compliance.cipWrap.wrapTypes?.rocip)}
                      onChange={(e) => updateOrder((p) => ({
                        ...p,
                        compliance: {
                          ...p.compliance,
                          cipWrap: {
                            ...p.compliance.cipWrap,
                            wrapTypes: {
                              ...(p.compliance.cipWrap.wrapTypes || { ocip: false, ccip: false, rocip: false }),
                              rocip: e.target.checked,
                            },
                          },
                        },
                      }))}
                    />
                    ROCIP
                  </label>
                </div>

                <div className="crm-grid filters-3" style={{ marginTop: 8 }}>
                  <input data-field="compliance.cipWrap.contact.name" className="crm-input" placeholder="Contact Name" value={order.compliance.cipWrap.contact?.name || ""} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, cipWrap: { ...p.compliance.cipWrap, contact: { ...(p.compliance.cipWrap.contact || { name: "", phone: "", email: "", title: "" }), name: e.target.value } } } }))} />
                  <input data-field="compliance.cipWrap.contact.phone" className="crm-input" placeholder="Contact Phone" value={order.compliance.cipWrap.contact?.phone || ""} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, cipWrap: { ...p.compliance.cipWrap, contact: { ...(p.compliance.cipWrap.contact || { name: "", phone: "", email: "", title: "" }), phone: e.target.value } } } }))} />
                  <input data-field="compliance.cipWrap.contact.email" className="crm-input" placeholder="Contact Email" value={order.compliance.cipWrap.contact?.email || ""} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, cipWrap: { ...p.compliance.cipWrap, contact: { ...(p.compliance.cipWrap.contact || { name: "", phone: "", email: "", title: "" }), email: e.target.value } } } }))} />
                </div>

                <div className="crm-grid filters-2" style={{ marginTop: 8 }}>
                  <input data-field="compliance.cipWrap.portalInformation" className="crm-input" placeholder="Portal Information" value={order.compliance.cipWrap.portalInformation || ""} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, cipWrap: { ...p.compliance.cipWrap, portalInformation: e.target.value } } }))} />
                  <input data-field="compliance.cipWrap.note" className="crm-input" placeholder="Note" value={order.compliance.cipWrap.note || ""} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, cipWrap: { ...p.compliance.cipWrap, note: e.target.value } } }))} />
                </div>

                <label className="crm-row" style={{ gap: 8, marginTop: 8 }}>
                  <input data-field="compliance.cipWrap.insuranceCertificateAttached" type="checkbox" checked={Boolean(order.compliance.cipWrap.insuranceCertificateAttached)} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, cipWrap: { ...p.compliance.cipWrap, insuranceCertificateAttached: e.target.checked } } }))} /> Insurance certificate example attached (if available)
                </label>
                <label className="crm-sub" style={{ display: "block", marginTop: 6 }}>Upload Insurance Certificate Example (if available)</label>
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setUploads((u) => ({ ...u, cipInsuranceCertificate: e.target.files?.[0] || null }))} />
              </>
            ) : null}
          </div>

          <div className="crm-card" style={{ marginTop: 8 }}>
              <label className="crm-row" style={{ gap: 8 }}><input type="checkbox" checked={order.compliance.prevailingWage.enabled} onChange={(e) => updateOrder((p) => ({
                ...p,
                compliance: {
                  ...p.compliance,
                  prevailingWage: {
                    ...p.compliance.prevailingWage,
                    enabled: e.target.checked,
                    certifiedPayrollRequired: e.target.checked ? p.compliance.prevailingWage.certifiedPayrollRequired : false,
                  },
                },
              }))} /> Prevailing Wage Applies</label>
            {order.compliance.prevailingWage.enabled ? (
              <>
                <p className="crm-sub" style={{ marginTop: 8, marginBottom: 8 }}>
                  Certified payroll is treated as part of prevailing wage for this form.
                </p>
                <label className="crm-row" style={{ gap: 8 }}>
                  <input data-field="compliance.prevailingWage.wageDeterminationAttached" type="checkbox" checked={Boolean(order.compliance.prevailingWage.wageDeterminationAttached)} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, prevailingWage: { ...p.compliance.prevailingWage, wageDeterminationAttached: e.target.checked } } }))} /> Wage determination sheet attached
                </label>
                <label className="crm-row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(order.compliance.prevailingWage.certifiedPayrollRequired)}
                    onChange={(e) => updateOrder((p) => ({
                      ...p,
                      compliance: {
                        ...p.compliance,
                        prevailingWage: {
                          ...p.compliance.prevailingWage,
                          certifiedPayrollRequired: e.target.checked,
                        },
                      },
                    }))}
                  /> Certified payroll required for this prevailing wage job
                </label>
                <div className="crm-grid filters-3" style={{ marginTop: 8 }}>
                  <input data-field="compliance.prevailingWage.reportingContact.name" className="crm-input" placeholder="Contact Name" value={order.compliance.prevailingWage.reportingContact?.name || ""} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, prevailingWage: { ...p.compliance.prevailingWage, reportingContact: { ...(p.compliance.prevailingWage.reportingContact || { name: "", phone: "", email: "" }), name: e.target.value } } } }))} />
                  <input data-field="compliance.prevailingWage.reportingContact.phone" className="crm-input" placeholder="Contact Phone" value={order.compliance.prevailingWage.reportingContact?.phone || ""} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, prevailingWage: { ...p.compliance.prevailingWage, reportingContact: { ...(p.compliance.prevailingWage.reportingContact || { name: "", phone: "", email: "" }), phone: e.target.value } } } }))} />
                  <input data-field="compliance.prevailingWage.reportingContact.email" className="crm-input" placeholder="Contact Email" value={order.compliance.prevailingWage.reportingContact?.email || ""} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, prevailingWage: { ...p.compliance.prevailingWage, reportingContact: { ...(p.compliance.prevailingWage.reportingContact || { name: "", phone: "", email: "" }), email: e.target.value } } } }))} />
                </div>
                <div className="crm-grid filters-2" style={{ marginTop: 8 }}>
                  <input data-field="compliance.prevailingWage.portalInformation" className="crm-input" placeholder="Portal Information" value={order.compliance.prevailingWage.portalInformation || ""} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, prevailingWage: { ...p.compliance.prevailingWage, portalInformation: e.target.value } } }))} />
                  <input data-field="compliance.prevailingWage.wageDeterminationNotes" className="crm-input" placeholder="Note" value={order.compliance.prevailingWage.wageDeterminationNotes || ""} onChange={(e) => updateOrder((p) => ({ ...p, compliance: { ...p.compliance, prevailingWage: { ...p.compliance.prevailingWage, wageDeterminationNotes: e.target.value } } }))} />
                </div>
                <label className="crm-sub" style={{ display: "block", marginTop: 6 }}>Upload Wage Determination Sheet (or scan)</label>
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setUploads((u) => ({ ...u, wageSheet: e.target.files?.[0] || null }))} />
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {step === 5 ? (
        <section className="crm-card" style={{ marginBottom: 10 }}>
          <h3 className="crm-section-title">6) Review + Missing Items</h3>
          {submitBanner ? (
            <p className={submitBanner.type === "success" ? "crm-success" : "crm-error"} style={{ marginTop: 0, marginBottom: 10 }}>
              {submitBanner.message}
            </p>
          ) : null}
          <div className="crm-card review-order-banner" style={{ marginBottom: 10, borderColor: activeTheme.uiBorder, background: activeTheme.uiSoft }}>
            <div className="snapshot-section-head">
              <h4 className="crm-section-title" style={{ fontSize: 16, marginBottom: 0 }}>Order Setup Summary</h4>
              <span className="order-type-badge" style={{ borderColor: activeTheme.uiBorder, color: activeTheme.uiInk, background: "#ffffff" }}>{requestTypeBadge}</span>
            </div>
            <p className="crm-sub" style={{ marginTop: 0, marginBottom: 6 }}>
              <strong>Order Type:</strong> {orderTypeLabel(order.orderType)}
            </p>
            {order.parentJobOrderId?.trim() ? (
              <p className="crm-sub" style={{ marginTop: 0, marginBottom: 6 }}>
                <strong>Existing Job Order Reference:</strong> {order.parentJobOrderId}
              </p>
            ) : null}
            {order.existingSiteReference?.trim() ? (
              <p className="crm-sub" style={{ marginTop: 0, marginBottom: 6 }}>
                <strong>Existing Site Reference:</strong> {order.existingSiteReference}
              </p>
            ) : null}
            <p className="crm-sub" style={{ marginTop: 0, marginBottom: 0 }}>
              <strong>End Date:</strong> {order.endDate || "-"}
            </p>
          </div>
          <div className="crm-card" style={{ marginBottom: 10 }}>
            <h4 className="crm-section-title" style={{ fontSize: 16 }}>Position Requests</h4>
            <div className="labor-review-grid">
              {order.laborPositions.map((position, index) => (
                <div key={`review-position-${index}`} className="crm-card labor-review-card">
                  <p className="crm-sub" style={{ marginTop: 0, marginBottom: 6 }}><strong>Position {index + 1}</strong></p>
                  <p className="crm-sub" style={{ marginTop: 0, marginBottom: 6 }}><strong>Trade:</strong> {position.tradeRequested || "-"}</p>
                  <p className="crm-sub" style={{ marginTop: 0, marginBottom: 0 }}><strong>Workers Needed:</strong> {position.workersNeeded || "-"}</p>
                </div>
              ))}
            </div>
          </div>
          {issues.length === 0 ? (
            <p className="crm-muted">No blocking issues found. Ready to submit.</p>
          ) : (
            <ul style={{ listStyle: "none", paddingLeft: 0 }}>
              {issues.map((issue) => (
                <li key={`${issue.field}-${issue.message}`} style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => jumpToIssue(issue)}
                    className={issue.severity === "error" ? "crm-error" : "crm-muted"}
                    style={{ width: "100%", textAlign: "left", padding: 12, borderRadius: 10, border: "1px solid", cursor: "pointer" }}
                  >
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="crm-row" style={{ gap: 8, marginTop: 10 }}>
              <button className="crm-btn-secondary" type="button" onClick={handleGeneratePdfResult} disabled={isGeneratingPdf}>
                {isGeneratingPdf ? "Generating PDF..." : "Generate PDF Result"}
            </button>
            <button className="crm-btn-primary" type="button" disabled={isSubmitting || blockingErrors.length > 0} onClick={handleSubmit}>
              {isSubmitting ? "Submitting..." : "Submit Job Order"}
            </button>
          </div>
            {pdfError ? <p className="crm-error" style={{ marginTop: 8 }}>{pdfError}</p> : null}
        </section>
      ) : null}

      {showSubmitConfirmation ? (
        <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Submission confirmations">
          <div className="crm-modal-card">
            <h4 className="crm-section-title" style={{ fontSize: 16, marginBottom: 6 }}>Confirm Before Submit</h4>
            <p className="crm-sub" style={{ marginTop: 0, marginBottom: 10 }}>
              Please review and confirm each item below before submitting this job order.
            </p>
            <div className="crm-grid" style={{ gap: 8 }}>
              {submitConfirmationItems.map((item) => (
                <label key={item.key} className="crm-modal-check">
                  <input
                    type="checkbox"
                    checked={Boolean(submitConfirmationChecks[item.key])}
                    onChange={(e) => setSubmitConfirmationChecks((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
            <div className="crm-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="crm-btn-secondary" type="button" onClick={() => setShowSubmitConfirmation(false)} disabled={isSubmitting}>
                Cancel
              </button>
              <button className="crm-btn-primary" type="button" onClick={handleSubmitFromConfirmation} disabled={!submitConfirmationReady || isSubmitting}>
                {isSubmitting ? "Submitting..." : "OK and Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="crm-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
        <button className="crm-btn-secondary" type="button" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Previous</button>
        <button className="crm-btn-primary" type="button" disabled={step === STEP_LABELS.length - 1} onClick={() => setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1))}>Next</button>
      </div>
    </div>
  );
}
