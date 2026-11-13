"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  clearPageCache,
  clearClientData,
  createCrop as createCropRequest,
  createField as createFieldRequest,
  deleteCrop as deleteCropRequest,
  deleteField as deleteFieldRequest,
  getCrops,
  getCurrentWeather,
  getFields,
  getForecast,
  getProfile,
  getSchedules,
  logout as logoutRequest,
  performScheduleAction as performScheduleActionRequest,
  readFarmSnapshot,
  saveFarmSnapshot,
  switchFarmAccount,
  updateCrop as updateCropRequest,
  updateField as updateFieldRequest,
  updateProfile as updateProfileRequest,
} from "@/lib/api";
import type {
  ApiError,
  CropCreatePayload,
  CropPatchPayload,
  FarmCrop,
  FarmField,
  FarmSnapshot,
  FarmerProfile,
  FarmerProfileUpdate,
  FieldCreatePayload,
  FieldPatchPayload,
  ScheduleAction,
} from "@/lib/types";

type FarmDataContextValue = {
  data: FarmSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  online: boolean;
  error: string;
  refreshCooling: boolean;
  refresh: () => Promise<void>;
  updateProfile: (payload: FarmerProfileUpdate) => Promise<void>;
  createField: (payload: FieldCreatePayload) => Promise<FarmField>;
  updateField: (fieldId: number, payload: FieldPatchPayload) => Promise<FarmField>;
  deleteField: (fieldId: number) => Promise<void>;
  createCrop: (payload: CropCreatePayload) => Promise<FarmCrop>;
  updateCrop: (cropId: number, payload: CropPatchPayload) => Promise<FarmCrop>;
  deleteCrop: (cropId: number) => Promise<void>;
  performScheduleAction: (scheduleId: number, action: ScheduleAction) => Promise<void>;
  prepareForAccount: (profile: FarmerProfile) => Promise<void>;
  signOut: () => Promise<void>;
};

const FarmDataContext = createContext<FarmDataContextValue | null>(null);

function isSnapshot(value: unknown): value is FarmSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<FarmSnapshot>;
  return Boolean(
    snapshot.profile &&
    typeof snapshot.profile.id === "number" &&
    typeof snapshot.profile.name === "string" &&
    Array.isArray(snapshot.fields) &&
    Array.isArray(snapshot.crops) &&
    Array.isArray(snapshot.schedules) &&
    typeof snapshot.lastUpdated === "string",
  );
}

function locationFor(profile: FarmerProfile): string | undefined {
  const location = [profile.village, profile.district, profile.state].filter(Boolean).join(", ");
  return location || undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|load/i.test(error.message);
}

type WeatherResult<T> = { value: T; error?: never } | { value?: never; error: unknown };
const WEATHER_COOLDOWN_KEY = "jalsaathi.farmer-pwa.weather-refresh-until.v1";
const ROUTE_WARM_KEY_PREFIX = "jalsaathi.farmer-pwa.route-warm.v1.";
const ROUTE_WARM_INTERVAL_MS = 6 * 60 * 60 * 1000;

function hasWeatherError<T>(result: WeatherResult<T>): result is { error: unknown; value?: never } {
  return "error" in result;
}

async function weatherResult<T>(request: Promise<T>): Promise<WeatherResult<T>> {
  try {
    return { value: await request };
  } catch (error) {
    return { error };
  }
}

export function FarmDataProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [data, setData] = useState<FarmSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(true);
  const [verifiedAccountId, setVerifiedAccountId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [refreshCooling, setRefreshCooling] = useState(false);
  const dataRef = useRef<FarmSnapshot | null>(null);
  const refreshCooldownUntil = useRef(0);
  const refreshCooldownTimer = useRef<number | null>(null);
  const initialized = useRef(false);
  const authRoute = pathname === "/login" || pathname === "/register" || pathname === "/forgot-password";
  const protectedRoute = useRef(!authRoute);
  protectedRoute.current = !authRoute;

  const clearRefreshCooldown = useCallback(() => {
    refreshCooldownUntil.current = 0;
    if (refreshCooldownTimer.current !== null) window.clearTimeout(refreshCooldownTimer.current);
    refreshCooldownTimer.current = null;
    setRefreshCooling(false);
    try {
      localStorage.removeItem(WEATHER_COOLDOWN_KEY);
    } catch (reason) {
      console.error("JalSaathi weather refresh cooldown could not be cleared:", reason);
    }
  }, []);

  const pauseWeatherRefresh = useCallback((until: number) => {
    refreshCooldownUntil.current = until;
    setRefreshCooling(true);
    if (refreshCooldownTimer.current !== null) window.clearTimeout(refreshCooldownTimer.current);
    refreshCooldownTimer.current = window.setTimeout(clearRefreshCooldown, Math.max(0, until - Date.now()));
    try {
      localStorage.setItem(WEATHER_COOLDOWN_KEY, String(until));
    } catch (reason) {
      console.error("JalSaathi weather refresh cooldown could not be saved:", reason);
    }
  }, [clearRefreshCooldown]);

  const refresh = useCallback(async () => {
    if (!navigator.onLine || Date.now() < refreshCooldownUntil.current) return;
    const profile: FarmerProfile = await getProfile();
    setVerifiedAccountId(profile.id);
    if (Date.now() < refreshCooldownUntil.current) return;
    const accountChanged = switchFarmAccount(profile.id);
    if (accountChanged) {
      await clearPageCache();
      dataRef.current = null;
      setData(null);
    }
    const previous = accountChanged ? null : dataRef.current;
    const location = locationFor(profile);
    const [fields, crops, scheduleResult, currentWeatherResult, hourlyForecastResult, dailyForecastResult] = await Promise.all([
      getFields(),
      getCrops(),
      getSchedules(),
      weatherResult(getCurrentWeather(location)),
      weatherResult(getForecast(location, "1h", 24)),
      weatherResult(getForecast(location, "1d", 5)),
    ]);

    const weatherResults = [currentWeatherResult, hourlyForecastResult, dailyForecastResult];
    const weatherRateLimited = weatherResults.some((result) =>
      hasWeatherError(result) && [429, 503].includes((result.error as ApiError).status ?? 0),
    );
    if (weatherResults.some((result) => hasWeatherError(result))) {
      console.warn("JalSaathi weather data could not be refreshed; retaining the saved weather snapshot.");
    }
    if (weatherRateLimited) {
      pauseWeatherRefresh(Date.now() + 60_000);
    }
    const updatedAt = new Date().toISOString();
    const weather = hasWeatherError(currentWeatherResult)
      ? previous?.weather ?? null
      : currentWeatherResult.value;
    const snapshot: FarmSnapshot = {
      profile,
      fields,
      crops,
      schedules: scheduleResult.schedules,
      weather,
      weatherUpdatedAt: hasWeatherError(currentWeatherResult)
        ? previous?.weatherUpdatedAt ?? previous?.lastUpdated ?? null
        : updatedAt,
      weatherTemporarilyUnavailable: weatherRateLimited && Boolean(weather)
        ? true
        : hasWeatherError(currentWeatherResult) ? previous?.weatherTemporarilyUnavailable ?? false : false,
      hourlyForecast: hasWeatherError(hourlyForecastResult)
        ? previous?.hourlyForecast ?? null
        : hourlyForecastResult.value,
      dailyForecast: hasWeatherError(dailyForecastResult)
        ? previous?.dailyForecast ?? null
        : dailyForecastResult.value,
      lastUpdated: updatedAt,
    };
    dataRef.current = snapshot;
    setData(snapshot);
    setError("");
    setOnline(navigator.onLine);
    try {
      saveFarmSnapshot(snapshot);
    } catch (reason) {
      console.error("JalSaathi farm data could not be saved for offline use:", reason);
      setError("Farm data loaded, but this browser could not save it for offline use.");
    }
  }, [pauseWeatherRefresh]);

  const discardLocalAccount = useCallback(async () => {
    dataRef.current = null;
    setData(null);
    setVerifiedAccountId(null);
    clearRefreshCooldown();
    await clearClientData();
  }, [clearRefreshCooldown]);

  useEffect(() => {
    setOnline(navigator.onLine);

    if (authRoute) {
      initialized.current = false;
      setLoading(false);
      return;
    }
    if (initialized.current) return;
    initialized.current = true;
    setLoading(true);

    let hasSnapshot = false;
    try {
      const cached = readFarmSnapshot<unknown>();
      if (isSnapshot(cached)) {
        dataRef.current = cached;
        setData(cached);
        hasSnapshot = true;
        setLoading(false);
      }
      else if (cached !== null) {
        console.warn("Discarding malformed JalSaathi offline data.");
        void clearClientData().catch((reason: unknown) => {
          console.error("Malformed JalSaathi offline data could not be cleared:", reason);
        });
      }
    } catch (reason) {
      console.error("JalSaathi offline data could not be read:", reason);
      setError("Saved farm data could not be read. Connect to refresh your account.");
    }

    let active = true;
    if (navigator.onLine) {
      void refresh().catch(async (reason: unknown) => {
        if (!active) return;
        if ((reason as ApiError)?.status === 401) {
          try {
            await discardLocalAccount();
            setError("Your session has expired. Sign in again to reload your farm.");
          } catch (cleanupError) {
            setError(`Your session expired, but local data cleanup failed: ${errorMessage(cleanupError)}`);
          }
        } else if (!hasSnapshot) {
          if (isNetworkFailure(reason)) setOnline(false);
          setError(errorMessage(reason));
        } else {
          if (isNetworkFailure(reason)) {
            setOnline(false);
            setError("");
          } else {
            setError("Showing saved data. Connect to refresh your account.");
          }
        }
      }).finally(() => {
        if (active) setLoading(false);
      });
    } else {
      setLoading(false);
      if (!dataRef.current) setError("Connect to the internet to sign in and load your farm.");
    }

    return () => {
      active = false;
    };
  }, [authRoute, discardLocalAccount, refresh]);

  useEffect(() => {
    if (!online || !data || verifiedAccountId !== data.profile.id ||
        !("serviceWorker" in navigator)) return;
    const warmKey = `${ROUTE_WARM_KEY_PREFIX}${data.profile.id}`;
    let active = true;
    const warm = (worker: ServiceWorker | null) => {
      if (!active || !worker || !navigator.onLine) return;
      try {
        const previousWarmup = Number(localStorage.getItem(warmKey) ?? 0);
        if (Number.isFinite(previousWarmup) && Date.now() - previousWarmup < ROUTE_WARM_INTERVAL_MS) return;
        const urls = [
          "/dashboard",
          "/fields",
          "/crops",
          "/schedule",
          "/weather",
          "/alerts",
          "/profile",
          ...data.fields.map((field) => `/fields/${encodeURIComponent(String(field.id))}`),
        ];
        localStorage.setItem(warmKey, String(Date.now()));
        worker.postMessage({ type: "WARM_ROUTES", urls });
      } catch (reason) {
        console.error("JalSaathi offline pages could not be scheduled for warm-up:", reason);
      }
    };
    const handleControllerChange = () => {
      try {
        localStorage.removeItem(warmKey);
      } catch (reason) {
        console.error("JalSaathi route warm-up state could not be reset:", reason);
      }
      warm(navigator.serviceWorker.controller);
    };
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    void navigator.serviceWorker.ready.then((registration) => {
      if (active) warm(navigator.serviceWorker.controller ?? registration.active);
    }).catch((reason: unknown) => {
      console.error("JalSaathi service worker is not ready to warm routes:", reason);
    });
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, [data, online, verifiedAccountId]);

  useEffect(() => {
    let storedCooldown: number | null = null;
    try {
      const rawCooldown = localStorage.getItem(WEATHER_COOLDOWN_KEY);
      const parsedCooldown = rawCooldown ? Number(rawCooldown) : NaN;
      if (Number.isFinite(parsedCooldown) && parsedCooldown > Date.now()) {
        storedCooldown = parsedCooldown;
      } else if (rawCooldown) {
        localStorage.removeItem(WEATHER_COOLDOWN_KEY);
      }
    } catch (reason) {
      console.error("JalSaathi weather refresh cooldown could not be restored:", reason);
    }
    if (storedCooldown) pauseWeatherRefresh(storedCooldown);

    const handleOnline = () => {
      setOnline(true);
      if (!protectedRoute.current) return;
      void refresh().catch(async (reason: unknown) => {
        if ((reason as ApiError)?.status === 401) {
          try {
            await discardLocalAccount();
            setError("Your session has expired. Sign in again to reload your farm.");
          } catch (cleanupError) {
            setError(`Your session expired, but local data cleanup failed: ${errorMessage(cleanupError)}`);
          }
        } else {
          if (isNetworkFailure(reason) && dataRef.current) {
            setOnline(false);
            setError("");
          } else {
            if (isNetworkFailure(reason)) setOnline(false);
            setError(errorMessage(reason));
          }
        }
      });
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (refreshCooldownTimer.current !== null) window.clearTimeout(refreshCooldownTimer.current);
    };
  }, [discardLocalAccount, pauseWeatherRefresh, refresh]);

  const updateProfile = useCallback(async (payload: FarmerProfileUpdate) => {
    const profile = await updateProfileRequest(payload);
    const current = dataRef.current;
    if (!current) return;
    const updated = { ...current, profile, lastUpdated: new Date().toISOString() };
    dataRef.current = updated;
    setData(updated);
    try {
      saveFarmSnapshot(updated);
    } catch (reason) {
      console.error("Updated JalSaathi profile could not be saved for offline use:", reason);
      setError("Profile updated, but this browser could not save the change for offline use.");
    }
  }, []);

  const saveMutation = useCallback((update: (current: FarmSnapshot) => FarmSnapshot) => {
    const current = dataRef.current;
    if (!current) throw new Error("Farm data is not available.");
    const updated = { ...update(current), lastUpdated: new Date().toISOString() };
    dataRef.current = updated;
    setData(updated);
    try {
      saveFarmSnapshot(updated);
    } catch (reason) {
      console.error("Updated JalSaathi data could not be saved for offline use:", reason);
      setError("Changes were saved online, but this browser could not save them for offline use.");
    }
  }, []);

  const createField = useCallback(async (payload: FieldCreatePayload) => {
    const field = await createFieldRequest(payload);
    saveMutation((current) => ({ ...current, fields: [...current.fields, field] }));
    try {
      if (dataRef.current) localStorage.removeItem(`${ROUTE_WARM_KEY_PREFIX}${dataRef.current.profile.id}`);
    } catch (reason) {
      console.error("Field route warm-up could not be reset after adding a field:", reason);
    }
    return field;
  }, [saveMutation]);

  const updateField = useCallback(async (fieldId: number, payload: FieldPatchPayload) => {
    const field = await updateFieldRequest(fieldId, payload);
    saveMutation((current) => ({
      ...current,
      fields: current.fields.map((item) => item.id === fieldId ? field : item),
    }));
    return field;
  }, [saveMutation]);

  const deleteField = useCallback(async (fieldId: number) => {
    await deleteFieldRequest(fieldId);
    saveMutation((current) => ({
      ...current,
      fields: current.fields.filter((item) => item.id !== fieldId),
      crops: current.crops.map((crop) => crop.field_id === fieldId ? { ...crop, field_id: null } : crop),
      schedules: current.schedules.filter((schedule) => schedule.field_id !== fieldId),
    }));
    try {
      if (dataRef.current) localStorage.removeItem(`${ROUTE_WARM_KEY_PREFIX}${dataRef.current.profile.id}`);
    } catch (reason) {
      console.error("Field route warm-up could not be reset after deleting a field:", reason);
    }
  }, [saveMutation]);

  const createCrop = useCallback(async (payload: CropCreatePayload) => {
    const crop = await createCropRequest(payload);
    saveMutation((current) => ({ ...current, crops: [...current.crops, crop] }));
    return crop;
  }, [saveMutation]);

  const updateCrop = useCallback(async (cropId: number, payload: CropPatchPayload) => {
    const crop = await updateCropRequest(cropId, payload);
    saveMutation((current) => ({
      ...current,
      crops: current.crops.map((item) => item.id === cropId ? crop : item),
    }));
    return crop;
  }, [saveMutation]);

  const deleteCrop = useCallback(async (cropId: number) => {
    await deleteCropRequest(cropId);
    saveMutation((current) => ({
      ...current,
      crops: current.crops.filter((item) => item.id !== cropId),
    }));
  }, [saveMutation]);

  const performScheduleAction = useCallback(async (scheduleId: number, action: ScheduleAction) => {
    const result = await performScheduleActionRequest(scheduleId, action);
    saveMutation((current) => ({
      ...current,
      schedules: current.schedules.map((schedule) =>
        schedule.id === scheduleId ? result.schedule : schedule),
    }));
  }, [saveMutation]);

  const prepareForAccount = useCallback(async (profile: FarmerProfile) => {
    if (dataRef.current && dataRef.current.profile.id !== profile.id) {
      await discardLocalAccount();
    }
  }, [discardLocalAccount]);

  const signOut = useCallback(async () => {
    if (!navigator.onLine) {
      setError("You’re offline. Reconnect before signing out so your server session can be ended.");
      return;
    }
    let requestError: unknown;
    try {
      await logoutRequest();
    } catch (reason) {
      requestError = reason;
    }
    try {
      await discardLocalAccount();
      setError(requestError
        ? `Local data was cleared, but the server could not end the session: ${errorMessage(requestError)}`
        : "");
    } catch (reason) {
      setError(`Sign-out cleanup failed: ${errorMessage(reason)}`);
    }
    router.replace("/login");
  }, [discardLocalAccount, router]);

  const value = useMemo(() => ({
    data,
    loading,
    refreshing,
    online,
    error,
    refreshCooling,
    refresh: async () => {
      if (!navigator.onLine) return;
      setRefreshing(true);
      try {
        await refresh();
      } catch (reason) {
        if ((reason as ApiError)?.status === 401) {
          try {
            await discardLocalAccount();
            setError("Your session has expired. Sign in again to reload your farm.");
          } catch (cleanupError) {
            setError(`Your session expired, but local data cleanup failed: ${errorMessage(cleanupError)}`);
          }
        } else {
          if (isNetworkFailure(reason) && dataRef.current) {
            setOnline(false);
            setError("");
          } else {
            if (isNetworkFailure(reason)) setOnline(false);
            setError(errorMessage(reason));
          }
        }
      } finally {
        setRefreshing(false);
      }
    },
    updateProfile,
    createField,
    updateField,
    deleteField,
    createCrop,
    updateCrop,
    deleteCrop,
    performScheduleAction,
    prepareForAccount,
    signOut,
  }), [
    createCrop,
    createField,
    data,
    deleteCrop,
    deleteField,
    discardLocalAccount,
    error,
    loading,
    online,
    performScheduleAction,
    prepareForAccount,
    refresh,
    refreshCooling,
    refreshing,
    signOut,
    updateCrop,
    updateField,
    updateProfile,
  ]);

  return <FarmDataContext.Provider value={value}>{children}</FarmDataContext.Provider>;
}

export function useFarmData(): FarmDataContextValue {
  const value = useContext(FarmDataContext);
  if (!value) throw new Error("useFarmData must be used within FarmDataProvider.");
  return value;
}
