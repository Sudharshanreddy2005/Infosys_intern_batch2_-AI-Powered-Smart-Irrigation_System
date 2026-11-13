import type {
  ApiError,
  CurrentWeather,
  CropCreatePayload,
  CropPatchPayload,
  FarmerProfile,
  FarmerProfileUpdate,
  FarmerRegistration,
  FarmCrop,
  FarmField,
  FieldCreatePayload,
  FieldPatchPayload,
  ForecastResponse,
  ScheduleListResponse,
  ScheduleAction,
  ScheduleActionResponse,
} from "@/lib/types";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const LEGACY_FARM_DATA_KEY = "jalsaathi.farmer-pwa.snapshot.v1";
const FARM_DATA_KEY_PREFIX = `${LEGACY_FARM_DATA_KEY}.`;
const ACTIVE_ACCOUNT_KEY = "jalsaathi.farmer-pwa.active-account.v1";
const APP_STORAGE_PREFIX = "jalsaathi.farmer-pwa.";
const APP_CACHE_PREFIX = "jalsaathi-";
const APP_DATABASE_PREFIX = "jalsaathi-farmer-pwa-";
const ROUTE_WARM_KEY_PREFIX = "jalsaathi.farmer-pwa.route-warm.v1.";

function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie.split("; ").find((item) => item.startsWith("jalsaathi_csrf="));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice("jalsaathi_csrf=".length));
  } catch (error) {
    console.error("JalSaathi CSRF cookie could not be decoded.", error);
    return null;
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const method = (options.method ?? "GET").toUpperCase();
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (token) headers.set("X-CSRF-Token", token);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const rawDetail = payload && typeof payload === "object" && "detail" in payload
      ? payload.detail
      : null;
    const validationErrors = Array.isArray(rawDetail)
      ? rawDetail.flatMap((item): { field: string; message: string }[] => {
        if (!item || typeof item !== "object") return [];
        const record = item as { loc?: unknown; msg?: unknown };
        const location = Array.isArray(record.loc) ? record.loc.filter((part): part is string | number =>
          typeof part === "string" || typeof part === "number") : [];
        const field = String([...location].reverse().find((part) => typeof part === "string" && part !== "body") ?? "");
        return typeof record.msg === "string" ? [{ field, message: record.msg }] : [];
      })
      : undefined;
    const detail = validationErrors?.map((issue) => issue.message).join(" ") ||
      (typeof rawDetail === "string" ? rawDetail : `Request failed (${response.status}).`);
    const error = new Error(detail) as ApiError;
    error.status = response.status;
    error.validationErrors = validationErrors;
    throw error;
  }
  return payload as T;
}

export const getProfile = () => apiRequest<FarmerProfile>("/api/auth/me");
export const getFields = () => apiRequest<FarmField[]>("/api/fields");
export const getCrops = () => apiRequest<FarmCrop[]>("/api/crops");
export const getSchedules = () => apiRequest<ScheduleListResponse>("/api/irrigation/schedules");
export const performScheduleAction = (scheduleId: number, action: ScheduleAction) =>
  apiRequest<ScheduleActionResponse>(
    `/api/irrigation/schedules/${encodeURIComponent(String(scheduleId))}/${action}`,
    { method: "POST" },
  );
export const createField = (payload: FieldCreatePayload) =>
  apiRequest<FarmField>("/api/fields", { method: "POST", body: JSON.stringify(payload) });
export const updateField = (fieldId: number, payload: FieldPatchPayload) =>
  apiRequest<FarmField>(`/api/fields/${encodeURIComponent(String(fieldId))}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
export const deleteField = (fieldId: number) =>
  apiRequest<void>(`/api/fields/${encodeURIComponent(String(fieldId))}`, { method: "DELETE" });
export const createCrop = (payload: CropCreatePayload) =>
  apiRequest<FarmCrop>("/api/crops", { method: "POST", body: JSON.stringify(payload) });
export const updateCrop = (cropId: number, payload: CropPatchPayload) =>
  apiRequest<FarmCrop>(`/api/crops/${encodeURIComponent(String(cropId))}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
export const deleteCrop = (cropId: number) =>
  apiRequest<void>(`/api/crops/${encodeURIComponent(String(cropId))}`, { method: "DELETE" });

export function getCurrentWeather(location?: string): Promise<CurrentWeather> {
  const query = location ? `?location=${encodeURIComponent(location)}` : "";
  return apiRequest<CurrentWeather>(`/weather/current${query}`);
}

export function getForecast(
  location: string | undefined,
  timestep: "1h" | "1d",
  hours: number,
): Promise<ForecastResponse> {
  const query = new URLSearchParams({ timestep, hours: String(hours) });
  if (location) query.set("location", location);
  return apiRequest<ForecastResponse>(`/weather/forecast?${query.toString()}`);
}

export function login(email: string, password: string) {
  return apiRequest<FarmerProfile>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function registerFarmer(payload: FarmerRegistration) {
  return apiRequest<FarmerProfile>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProfile(payload: FarmerProfileUpdate) {
  return apiRequest<FarmerProfile>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function logout() {
  return apiRequest<void>("/api/auth/logout", { method: "POST" });
}

export function saveFarmSnapshot(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== "object" || !("profile" in snapshot)) {
    throw new Error("Farm data cannot be saved without its account identity.");
  }
  const profile = snapshot.profile;
  if (!profile || typeof profile !== "object" || !("id" in profile) || typeof profile.id !== "number") {
    throw new Error("Farm data cannot be saved without a valid account identity.");
  }
  const accountId = String(profile.id);
  localStorage.setItem(`${FARM_DATA_KEY_PREFIX}${accountId}`, JSON.stringify(snapshot));
  localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId);
}

export function readFarmSnapshot<T>(): T | null {
  const accountId = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
  if (accountId && /^\d+$/.test(accountId)) {
    const raw = localStorage.getItem(`${FARM_DATA_KEY_PREFIX}${accountId}`);
    if (!raw) return null;
    const snapshot: unknown = JSON.parse(raw);
    if (!hasAccountId(snapshot, accountId)) {
      localStorage.removeItem(`${FARM_DATA_KEY_PREFIX}${accountId}`);
      localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
      console.warn("Discarded offline data whose account identity did not match its storage key.");
      return null;
    }
    return snapshot as T;
  }

  const legacyRaw = localStorage.getItem(LEGACY_FARM_DATA_KEY);
  if (!legacyRaw) return null;
  const legacy: unknown = JSON.parse(legacyRaw);
  if (!legacy || typeof legacy !== "object" || !("profile" in legacy) ||
      !legacy.profile || typeof legacy.profile !== "object" || !("id" in legacy.profile) ||
      typeof legacy.profile.id !== "number") {
    localStorage.removeItem(LEGACY_FARM_DATA_KEY);
    console.warn("Discarded legacy offline data without a valid account identity.");
    return null;
  }
  const legacyAccountId = String(legacy.profile.id);
  localStorage.setItem(`${FARM_DATA_KEY_PREFIX}${legacyAccountId}`, legacyRaw);
  localStorage.setItem(ACTIVE_ACCOUNT_KEY, legacyAccountId);
  localStorage.removeItem(LEGACY_FARM_DATA_KEY);
  return legacy as T;
}

function hasAccountId(value: unknown, accountId: string): boolean {
  return Boolean(value && typeof value === "object" && "profile" in value &&
    value.profile && typeof value.profile === "object" && "id" in value.profile &&
    String(value.profile.id) === accountId);
}

export function switchFarmAccount(accountId: number): boolean {
  const nextId = String(accountId);
  const activeId = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
  if (activeId !== nextId) {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(FARM_DATA_KEY_PREFIX) ||
          key.startsWith(ROUTE_WARM_KEY_PREFIX) ||
          key === LEGACY_FARM_DATA_KEY) {
        localStorage.removeItem(key);
      }
    }
  }
  localStorage.setItem(ACTIVE_ACCOUNT_KEY, nextId);
  return activeId !== nextId;
}

export async function clearPageCache(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PAGES" });
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames
    .filter((name) => name.startsWith(`${APP_CACHE_PREFIX}pages-`))
    .map(async (name) => {
      if (!await caches.delete(name)) throw new Error(`Could not clear offline page cache ${name}.`);
    }));
}

export async function clearClientData(): Promise<void> {
  if (typeof window === "undefined") return;

  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(APP_STORAGE_PREFIX)) localStorage.removeItem(key);
  }
  localStorage.removeItem(LEGACY_FARM_DATA_KEY);

  if ("indexedDB" in window && typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    await Promise.all(databases
      .filter((database) => database.name?.startsWith(APP_DATABASE_PREFIX))
      .map((database) => new Promise<void>((resolve, reject) => {
        if (!database.name) return resolve();
        const request = indexedDB.deleteDatabase(database.name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error(`Could not clear ${database.name}.`));
        request.onblocked = () => reject(new Error(`Could not clear ${database.name}; it is still open.`));
      })));
  }

  await clearPageCache();
}
