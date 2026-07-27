/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where submitJobOrder POSTs. Required at runtime — the wizard throws without
   * it. Set to the same-origin relay path "/submit" so the Worker in
   * src/worker.ts attaches the credential server-side; anything set here ships
   * in the public bundle, so it must never be a secret or a direct upstream URL.
   */
  readonly VITE_JOB_ORDER_SUBMIT_URL?: string;
  readonly VITE_GOOGLE_PLACES_API_KEY?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_JOB_ORDER_LOGO_URL?: string;
  readonly VITE_OUR_COMPANY_NAME?: string;
  readonly VITE_OUR_COMPANY_WEBSITE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Google Maps TypeScript declarations
declare namespace google {
  namespace maps {
    namespace places {
      class Autocomplete {
        constructor(
          input: HTMLInputElement,
          opts?: {
            types?: string[];
            fields?: string[];
            componentRestrictions?: { country: string | string[] };
            strictBounds?: boolean;
            bounds?: {
              north: number;
              south: number;
              east: number;
              west: number;
            };
          }
        );
        addListener(event: string, handler: () => void): void;
        getPlace(): {
          name?: string;
          address_components?: Array<{
            long_name: string;
            short_name: string;
            types: string[];
          }>;
          formatted_address?: string;
          formatted_phone_number?: string;
          website?: string;
        };
      }
    }
  }
}
