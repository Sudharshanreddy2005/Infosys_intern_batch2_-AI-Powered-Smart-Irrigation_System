(() => {
  "use strict";

  const MANUAL_LOCATION_KEY = "jalsaathi.weather.manual-location.v1";
  const DISPLAY_CACHE_KEY = "jalsaathi.weather.display-cache.v1";
  const CACHE_MILLISECONDS = 10 * 60 * 1000;
  const DISPLAY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
  const MAX_TRANSIENT_WEATHER_RETRIES = 2;
  const MAX_WEATHER_RETRY_DELAY_MS = 2_000;
  const inFlight = new Map();
  const currentInFlight = new Map();
  const cache = new Map();
  const currentCache = new Map();
  const translate = (key, parameters) =>
    window.JalSaathiI18n?.t?.(key, parameters) || key;
  const isValidWeatherValue = (value) =>
    (typeof value === "number" || typeof value === "string") &&
    !(typeof value === "string" && !value.trim()) &&
    Number.isFinite(Number(value));
  const displayWeatherFields = [
    "temperature_c",
    "feels_like_c",
    "humidity_percent",
    "wind_speed_mps",
    "rainfall_mm_per_hr",
    "precipitation_probability_percent",
    "weather_code",
    "observation_time",
    "is_stale",
    "locality",
    "location_name",
  ];

  const normalizeLocationKey = (location) => String(location || "").trim().toLocaleLowerCase();

  const isCoordinateLocation = (location) =>
    /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/.test(String(location || "").trim());

  const getProfileLocation = () => {
    const profile = window.JalSaathiProfile?.getProfile?.();
    const parts = [profile?.village, profile?.district, profile?.state]
      .filter((part) => typeof part === "string")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return "";
    let location = "";
    for (const part of parts) {
      const candidate = location ? `${location}, ${part}` : part;
      if (candidate.length > 100) break;
      location = candidate;
    }
    return (location || parts[0]).slice(0, 100);
  };

  const manualLocationStorageKey = () => {
    const profileId = window.JalSaathiProfile?.getProfile?.()?.id;
    return Number.isSafeInteger(profileId)
      ? `${MANUAL_LOCATION_KEY}.${profileId}`
      : MANUAL_LOCATION_KEY;
  };

  const displayLocation = (current, source, selection = {}) => {
    const candidate = source === "current-location"
      ? current?.locality || current?.location_name
      : selection.location || current?.location_name || current?.location;
    if (typeof candidate === "string" && candidate.trim() && !isCoordinateLocation(candidate)) {
      return candidate.trim().slice(0, 120);
    }
    if (source === "configured") return translate("weather.configuredLocation");
    if (source === "current-location") return translate("weather.currentLocation");
    return "";
  };

  const hasDisplayableWeather = (current) => current && typeof current === "object" &&
    !Array.isArray(current) && [
    "temperature_c",
    "feels_like_c",
    "weather_code",
    "humidity_percent",
    "wind_speed_mps",
    "rainfall_mm_per_hr",
    "precipitation_probability_percent",
  ].some((field) => isValidWeatherValue(current[field]));

  const readDisplayWeather = ({ location } = {}) => {
    try {
      const serialized = localStorage.getItem(DISPLAY_CACHE_KEY);
      if (!serialized) return null;
      const saved = JSON.parse(serialized);
      const matchingLocationKeys = location
        ? [`location:${normalizeLocationKey(location)}`, `locality:${normalizeLocationKey(location)}`]
        : null;
      if (!saved || saved.version !== 1 || !Number.isFinite(saved.savedAt) ||
          Date.now() - saved.savedAt > DISPLAY_CACHE_MAX_AGE ||
          typeof saved.locationLabel !== "string" || !saved.locationLabel.trim() ||
          isCoordinateLocation(saved.locationLabel) || !hasDisplayableWeather(saved.current) ||
          (matchingLocationKeys && !matchingLocationKeys.includes(saved.locationKey))) return null;
      return {
        data: {
          current: saved.current,
          hourly: [],
          daily: Array.isArray(saved.daily) ? saved.daily : [],
          selection: {},
        },
        source: "cached",
        cacheTime: saved.savedAt,
        cacheLocation: saved.locationLabel,
      };
    } catch (error) {
      console.warn("JalSaathi could not read its saved weather display cache:", error);
      return null;
    }
  };

  const saveDisplayWeather = (data, source) => {
    const current = data?.current;
    if (!hasDisplayableWeather(current) ||
        !["current-location", "manual", "profile", "configured"].includes(source)) return;
    const locationLabel = displayLocation(current, source, data.selection);
    if (!locationLabel) return;
    const configuredCoordinates = source === "configured" &&
      isCoordinateLocation(data.selection?.location || current.location);
    const locationKey = configuredCoordinates
      ? "configured"
      : source === "current-location"
        ? `locality:${normalizeLocationKey(locationLabel)}`
        : `location:${normalizeLocationKey(data.selection?.location || locationLabel)}`;
    const safeCurrent = Object.fromEntries(displayWeatherFields
      .filter((field) => current[field] !== undefined &&
        !(["locality", "location_name"].includes(field) && isCoordinateLocation(current[field])))
      .map((field) => [field, current[field]]));
    const daily = (Array.isArray(data.daily) ? data.daily : []).slice(0, 5).map((item) =>
      Object.fromEntries(["time", "weather_code", "temperature_high_c", "temperature_low_c", "rain_probability_percent"]
        .filter((field) => item?.[field] !== undefined)
        .map((field) => [field, item[field]])));
    const savedAt = Date.now();
    try {
      localStorage.setItem(DISPLAY_CACHE_KEY, JSON.stringify({
        version: 1,
        locationKey,
        locationLabel,
        savedAt,
        current: safeCurrent,
        daily,
      }));
    } catch (error) {
      console.warn("JalSaathi could not save its weather display cache:", error);
    }
    return { savedAt, locationLabel };
  };

  const getManualLocation = () => {
    try {
      const saved = localStorage.getItem(manualLocationStorageKey())?.trim();
      if (saved) return saved;
      const profile = window.JalSaathiProfile?.getProfile?.();
      if (Number.isSafeInteger(profile?.id) && getProfileLocation()) return "";
      return localStorage.getItem(MANUAL_LOCATION_KEY)?.trim() || "";
    } catch (error) {
      console.error("JalSaathi could not read the saved manual weather location:", error);
      return "";
    }
  };

  const saveManualLocation = (location) => {
    const value = String(location || "").trim();
    if (!value) throw new Error("Enter a city or locality.");
    try {
      localStorage.setItem(manualLocationStorageKey(), value);
    } catch (error) {
      console.error("JalSaathi could not save the manual weather location:", error);
      throw new Error("The location could not be saved in this browser.");
    }
    window.dispatchEvent(new CustomEvent("jalsaathi:weather-location-changed", { detail: { location: value } }));
    return value;
  };

  const selectionKey = (selection) => selection.coordinates
    ? `coordinates:${selection.coordinates.latitude.toFixed(6)},${selection.coordinates.longitude.toFixed(6)}`
    : `location:${selection.location || "configured"}`;

  const validateCoordinates = (coordinates) => {
    const { latitude, longitude } = coordinates;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("Your current location could not be validated.");
    }
    return { latitude, longitude };
  };

  const requestJson = async (path, selection, options = {}) => {
    const hasCoordinates = Boolean(selection.coordinates);
    const query = new URLSearchParams(options.query || "");
    if (!hasCoordinates && selection.location) query.set("location", selection.location);
    const queryString = query.toString();
    const url = `${path}${queryString ? `?${queryString}` : ""}`;
    const requestOptions = hasCoordinates ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection.coordinates),
      credentials: "same-origin",
    } : { credentials: "same-origin" };
    let response;
    for (let attempt = 0; attempt <= MAX_TRANSIENT_WEATHER_RETRIES; attempt += 1) {
      try {
        response = await fetch(url, requestOptions);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new Error(window.JalSaathiProfile?.apiErrorMessage?.(0, "", path) ||
          "The service is temporarily unavailable. Please try again later.");
      }
      if (response.ok || ![429, 503].includes(response.status) ||
          attempt === MAX_TRANSIENT_WEATHER_RETRIES) break;

      const retryAfter = response.headers?.get?.("retry-after");
      if (retryAfter) break;
      const delay = Math.min(MAX_WEATHER_RETRY_DELAY_MS, 250 * (2 ** attempt));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload && typeof payload.detail === "string" ? payload.detail : "";
      const error = new Error(window.JalSaathiProfile?.apiErrorMessage?.(
        response.status,
        detail,
        path,
      ) || "Weather data is unavailable. Check the provider configuration and try again.");
      error.status = response.status;
      const retryAfter = response.headers?.get?.("retry-after");
      if (retryAfter) {
        error.hasRetryAfter = true;
        const retryAfterSeconds = Number(retryAfter);
        const retryAfterDate = Date.parse(retryAfter);
        error.retryAfterSeconds = Number.isFinite(retryAfterSeconds)
          ? Math.max(0, retryAfterSeconds)
          : Number.isFinite(retryAfterDate)
            ? Math.max(0, (retryAfterDate - Date.now()) / 1000)
            : null;
      }
      throw error;
    }
    return payload;
  };

  const forecast = (selection, timestep, hours) => requestJson(
    "/weather/forecast",
    selection,
    { query: new URLSearchParams({ hours: String(hours), timestep }).toString() },
  );

  const load = (selection = {}, {
    refresh = false,
    includeHourly = true,
    includeDaily = true,
  } = {}) => {
    const normalized = selection.coordinates
      ? { coordinates: validateCoordinates(selection.coordinates) }
      : { location: selection.location?.trim() || "" };
    const key = `${selectionKey(normalized)}|hourly:${includeHourly}|daily:${includeDaily}`;
    const existing = cache.get(key);
    if (!refresh && existing && Date.now() - existing.time < CACHE_MILLISECONDS) {
      return Promise.resolve(existing.data);
    }
    if (inFlight.has(key)) return inFlight.get(key);

    const request = Promise.allSettled([
      requestJson("/weather/current", normalized),
      includeHourly ? forecast(normalized, "1h", 24) : Promise.resolve({ data: [] }),
      includeDaily ? forecast(normalized, "1d", 5) : Promise.resolve({ data: [] }),
    ]).then(([currentResult, hourlyResult, dailyResult]) => {
      if (currentResult.status === "rejected") throw currentResult.reason;
      if (!hasDisplayableWeather(currentResult.value)) {
        throw new Error("Weather service returned no usable current conditions.");
      }
      const data = {
        current: currentResult.value,
        hourly: hourlyResult.status === "fulfilled" && Array.isArray(hourlyResult.value.data)
          ? hourlyResult.value.data
          : [],
        daily: dailyResult.status === "fulfilled" && Array.isArray(dailyResult.value.data)
          ? dailyResult.value.data
          : [],
        hourlyError: hourlyResult.status === "rejected" ? hourlyResult.reason : null,
        dailyError: dailyResult.status === "rejected" ? dailyResult.reason : null,
        selection: normalized,
      };
      cache.set(key, { time: Date.now(), data });
      return data;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  };

  const loadCurrent = (selection = {}, { refresh = false } = {}) => {
    const normalized = selection.coordinates
      ? { coordinates: validateCoordinates(selection.coordinates) }
      : { location: selection.location?.trim() || "" };
    const key = selectionKey(normalized);
    const existing = currentCache.get(key);
    if (!refresh && existing && Date.now() - existing.time < CACHE_MILLISECONDS) {
      return Promise.resolve(existing.data);
    }
    if (currentInFlight.has(key)) return currentInFlight.get(key);

    const request = requestJson("/weather/current", normalized).then((current) => {
      const data = { current, hourly: [], daily: [], selection: normalized };
      currentCache.set(key, { time: Date.now(), data });
      return data;
    }).finally(() => currentInFlight.delete(key));
    currentInFlight.set(key, request);
    return request;
  };

  const geolocationPermission = async () => {
    if (!navigator.permissions?.query) return "unknown";
    try {
      return (await navigator.permissions.query({ name: "geolocation" })).state;
    } catch (error) {
      console.warn("JalSaathi could not read browser location permission:", error);
      return "unknown";
    }
  };

  const getCoordinates = () => new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new Error("Location access requires HTTPS or localhost."));
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error("Location services are unavailable in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const latitude = coords?.latitude;
        const longitude = coords?.longitude;
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
          reject(new Error("Your current location could not be validated."));
          return;
        }
        resolve({ latitude, longitude });
      },
      (error) => {
        const message = error.code === 1
          ? "Location permission is off."
          : error.code === 3
            ? "Your location request timed out."
            : "Your current location could not be determined.";
        reject(Object.assign(new Error(message), { geolocationCode: error.code }));
      },
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 8_000 },
    );
  });

  const savedLocationCandidates = () => {
    const candidates = [];
    const manualLocation = getManualLocation();
    const profileLocation = getProfileLocation();
    if (manualLocation) candidates.push({ location: manualLocation, source: "manual" });
    if (profileLocation && normalizeLocationKey(profileLocation) !== normalizeLocationKey(manualLocation)) {
      candidates.push({ location: profileLocation, source: "profile" });
    }
    return candidates;
  };

  const loadLocationFallback = async ({
    refresh = false,
    includeHourly = true,
    includeDaily = true,
    locationIssue = null,
    initialError = null,
  } = {}) => {
    const candidates = [
      ...savedLocationCandidates(),
      { location: "", source: "configured" },
    ];
    let lastError = initialError;
    let savedLocationFailed = false;
    for (const candidate of candidates) {
      try {
        const selection = candidate.location ? { location: candidate.location } : {};
        const data = await load(selection, { refresh, includeHourly, includeDaily });
        return {
          data,
          source: candidate.source,
          locationIssue: savedLocationFailed
            ? "saved-location-unavailable"
            : locationIssue,
        };
      } catch (error) {
        lastError = error;
        if (candidate.source !== "configured") savedLocationFailed = true;
      }
    }
    return {
      data: null,
      source: "unavailable",
      locationIssue: savedLocationFailed ? "saved-location-unavailable" : locationIssue,
      weatherError: lastError || new Error("Weather data is unavailable."),
    };
  };

  const loadAutomatic = async ({
    refresh = false,
    explicit = false,
    includeHourly = true,
    includeDaily = true,
  } = {}) => {
    const savedLocations = savedLocationCandidates();
    if (!explicit && savedLocations.length) {
      return loadLocationFallback({ refresh, includeHourly, includeDaily });
    }

    const permission = await geolocationPermission();
    let wasPreviouslyDenied = false;
    try { wasPreviouslyDenied = localStorage.getItem("jalsaathi.location-denied.v1") === "true"; } catch (error) {
      console.warn("JalSaathi could not read the location permission preference:", error);
    }
    if (permission === "granted") {
      try { localStorage.removeItem("jalsaathi.location-denied.v1"); } catch (error) {
        console.warn("JalSaathi could not clear the saved location permission state:", error);
      }
    }
    if (!explicit && (permission === "denied" || (wasPreviouslyDenied && permission !== "granted"))) {
      return loadLocationFallback({
        refresh,
        includeHourly,
        includeDaily,
        locationIssue: "permission-denied",
      });
    }

    let coordinates;
    try {
      coordinates = await getCoordinates();
    } catch (error) {
      if (error.geolocationCode === 1) {
        try { localStorage.setItem("jalsaathi.location-denied.v1", "true"); } catch (storageError) {
          console.warn("JalSaathi could not remember the denied location preference:", storageError);
        }
      }
      return loadLocationFallback({
        refresh,
        includeHourly,
        includeDaily,
        locationIssue: error.geolocationCode === 1
          ? "permission-denied"
          : "location-unavailable",
      });
    }

    try {
      return {
        data: await load({ coordinates }, { refresh, includeHourly, includeDaily }),
        source: "current-location",
      };
    } catch (error) {
      return loadLocationFallback({
        refresh,
        includeHourly,
        includeDaily,
        locationIssue: "current-location-unavailable",
        initialError: error,
      });
    }
  };

  const loadAutomaticWithFallback = async (options = {}) => {
    try {
      return await loadAutomatic(options);
    } catch (error) {
      return loadLocationFallback({
        ...options,
        locationIssue: "current-location-unavailable",
        initialError: error,
      });
    }
  };

  const formatNumber = (value, suffix = "") => isValidWeatherValue(value)
    ? `${window.JalSaathiI18n.formatNumber(Number(value))}${suffix}`
    : window.JalSaathiI18n.t("legacy.not.provided.20a04182");

  const isValidTemperature = isValidWeatherValue;

  const formatCurrentTemperature = (value) => {
    return isValidTemperature(value)
      ? window.JalSaathiI18n.formatTemperature(value)
      : translate("weather.shortUnavailable");
  };

  const publishCurrentWeather = (current) => {
    window.dispatchEvent(new CustomEvent("jalsaathi:weather-updated", {
      detail: {
        temperatureC: current?.temperature_c ?? null,
        condition: current ? condition(current.weather_code) : translate("legacy.unavailable.2c9c1f79"),
      },
    }));
  };

  const setTemperatureIndicator = (root, selector, value) => {
    const indicator = root.querySelector(selector);
    if (indicator instanceof HTMLElement) {
      indicator.hidden = !isValidTemperature(value);
    }
  };

  const formatTime = (value) => {
    if (!value) return window.JalSaathiI18n.t("legacy.not.provided.20a04182");
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? window.JalSaathiI18n.t("legacy.not.provided.20a04182")
      : window.JalSaathiI18n.formatDate(date, { dateStyle: "medium", timeStyle: "short" });
  };

  const weatherConditions = {
    1000: "Clear", 1001: "Cloudy", 1100: "Mostly clear", 1101: "Partly cloudy",
    1102: "Mostly cloudy", 2000: "Fog", 2100: "Light fog", 3000: "Light wind",
    3001: "Windy", 3002: "Strong wind", 4000: "Drizzle", 4001: "Rain",
    4200: "Light rain", 4201: "Heavy rain", 5000: "Snow", 5001: "Flurries",
    5100: "Light snow", 5101: "Heavy snow", 6000: "Freezing drizzle",
    6001: "Freezing rain", 6200: "Light freezing rain", 6201: "Heavy freezing rain",
    7000: "Ice pellets", 7101: "Heavy ice pellets", 7102: "Light ice pellets",
    8000: "Thunderstorm",
  };

  const condition = (code) => weatherConditions[Number(code)] || "Condition not provided";

  const weatherIllustration = (code) => {
    const numericCode = Number(code);
    if (!Number.isInteger(numericCode) || !weatherConditions[numericCode]) {
      return { type: "unknown", label: "Weather conditions unavailable" };
    }
    if (numericCode === 1000) return { type: "sunny", label: "Sunny weather" };
    if ([1100, 1101].includes(numericCode)) return { type: "partly-cloudy", label: "Partly cloudy weather" };
    if ([1001, 1102].includes(numericCode)) return { type: "cloudy", label: "Cloudy weather" };
    if ([2000, 2100].includes(numericCode)) return { type: "fog", label: "Foggy weather" };
    if ([3000, 3001, 3002].includes(numericCode)) return { type: "windy", label: "Windy weather" };
    if ([4000, 4200, 6000, 6200, 7102].includes(numericCode)) {
      return { type: "light-rain", label: `${weatherConditions[numericCode]} weather` };
    }
    if ([4201, 6201, 7101].includes(numericCode)) {
      return { type: "heavy-rain", label: `${weatherConditions[numericCode]} weather` };
    }
    if ([4001, 6001, 7000].includes(numericCode)) {
      return { type: "rain", label: `${weatherConditions[numericCode]} weather` };
    }
    if ([5000, 5001, 5100, 5101].includes(numericCode)) {
      return { type: "snow", label: `${weatherConditions[numericCode]} weather` };
    }
    if (numericCode === 8000) return { type: "thunderstorm", label: "Thunderstorm" };
    return { type: "unknown", label: "Weather conditions unavailable" };
  };

  const setValue = (root, selector, value) => {
    const element = root.querySelector(selector);
    if (element instanceof HTMLElement) element.textContent = value;
  };

  const setTemperatureValue = (root, selector, value) => {
    const element = root.querySelector(selector);
    if (!(element instanceof HTMLElement)) return;
    element.textContent = formatCurrentTemperature(value);
    element.classList.toggle("is-unavailable", !isValidTemperature(value));
  };

  const locationIssueMessage = (issue) => {
    const key = {
      "permission-denied": "weather.locationPermissionOff",
      "location-unavailable": "weather.locationUnavailable",
      "saved-location-unavailable": "weather.savedLocationUnavailable",
      "current-location-unavailable": "weather.currentLocationUnavailable",
    }[issue];
    return key ? translate(key) : "";
  };

  const renderDashboard = (root, result) => {
    const current = result.data?.current;
    const illustration = weatherIllustration(current?.weather_code);
    root.dataset.weatherCondition = illustration.type;
    const illustrationElement = root.querySelector("[data-weather-illustration]");
    if (illustrationElement instanceof HTMLElement) {
      illustrationElement.setAttribute("aria-label", illustration.label);
    }
    setValue(root, '[data-weather="location"]', result.source === "cached"
      ? result.cacheLocation
      : current ? displayLocation(current, result.source, result.data?.selection) ||
        (result.source === "current-location" ? translate("weather.currentLocation") : result.source === "manual"
          ? result.data?.selection?.location || translate("legacy.chosen.location.7ded283f")
          : translate("weather.configuredLocation"))
        : result.selection?.location || translate("weather.locationUnavailable"));
    setTemperatureValue(root, '[data-weather="temperature"]', current?.temperature_c);
    setTemperatureIndicator(root, ".temperature-indicator", current?.temperature_c);
    publishCurrentWeather(current);
    setValue(root, '[data-weather="condition"]', current
      ? condition(current.weather_code)
      : translate("weather.currentUnavailable"));
    setTemperatureValue(root, '[data-weather="feels_like"]', current?.feels_like_c);
    setValue(root, '[data-weather="humidity"]', formatNumber(current?.humidity_percent, "%"));
    setValue(root, '[data-weather="wind_speed"]', formatNumber(current?.wind_speed_mps, " m/s"));
    setValue(root, '[data-weather="rainfall"]', formatNumber(current?.rainfall_mm_per_hr, " mm/h"));
    setValue(root, '[data-weather="rain_probability"]', formatNumber(current?.precipitation_probability_percent, "%"));
    setValue(root, "[data-weather-updated]", result.source === "cached"
      ? `Saved weather · ${formatTime(result.cacheTime)}`
      : current?.observation_time
        ? `${current.is_stale ? "Cached observation" : "Last updated"} · ${formatTime(current.observation_time)}`
        : translate("legacy.not.provided.20a04182"));
    const status = root.querySelector("[data-dashboard-weather-message]");
    const locationPicker = root.querySelector("[data-weather-location-picker]");
    if (status instanceof HTMLElement) {
      status.textContent = result.source === "cached"
        ? translate("weather.savedWeatherRefreshing", { location: result.cacheLocation })
        : result.refreshError
          ? translate(result.cacheLocation ? "weather.refreshFallback" : "weather.refreshFallbackNoLocation", {
            location: result.cacheLocation || "",
          })
          : current
            ? locationIssueMessage(result.locationIssue)
            : translate("weather.currentUnavailable");
    }
    if (locationPicker instanceof HTMLElement) {
      locationPicker.hidden = Boolean(current && !result.locationIssue && !result.refreshError);
    }
    if (result.data?.daily?.length) {
      const today = result.data.daily[0];
      setValue(root, "[data-weather-high-low]", today.temperature_high_c != null && today.temperature_low_c != null
        ? `Next forecast day · ${formatCurrentTemperature(today.temperature_high_c)} / ${formatCurrentTemperature(today.temperature_low_c)}`
        : "Forecast high/low not provided");
    } else {
      setValue(root, "[data-weather-high-low]", "Forecast high/low unavailable");
    }
  };

  const initializeDashboard = (root) => {
    const status = root.querySelector("[data-dashboard-weather-message]");
    const loading = root.querySelector("[data-weather-loading]");
    const manualLocation = getManualLocation();
    const preferredLocation = manualLocation || getProfileLocation();
    const cached = readDisplayWeather({ location: preferredLocation || undefined });
    let hasWeather = Boolean(cached?.data?.current);
    let requestGeneration = 0;
    let lastResult = cached;
    if (cached) renderDashboard(root, cached);
    window.addEventListener("jalsaathi:language-changed", () => {
      if (lastResult) renderDashboard(root, lastResult);
    });
    if (!cached) {
      setValue(root, '[data-weather="location"]', preferredLocation || "Finding location…");
      setValue(root, '[data-weather="temperature"]', "Loading…");
      setValue(root, '[data-weather="condition"]', translate("legacy.audit.loading-weather.ff988149"));
      setValue(root, '[data-weather="feels_like"]', "Loading…");
      setValue(root, '[data-weather="humidity"]', "Loading…");
      setValue(root, '[data-weather="wind_speed"]', "Loading…");
      setValue(root, '[data-weather="rainfall"]', "Loading…");
      setValue(root, '[data-weather="rain_probability"]', "Loading…");
      setValue(root, "[data-weather-high-low]", "Loading forecast…");
      if (status instanceof HTMLElement) status.textContent = translate("legacy.audit.loading-weather.ff988149");
    }
    const setLoading = (isLoading) => {
      root.classList.toggle("is-loading", isLoading);
      if (loading instanceof HTMLElement) loading.hidden = !isLoading;
      if (status instanceof HTMLElement && isLoading && !hasWeather) {
        status.textContent = translate("legacy.audit.loading-weather.ff988149");
      }
    };
    const renderFailure = (error, generation, failureResult = {}) => {
      if (generation !== undefined && generation !== requestGeneration) return;
      if (error) console.warn("Dashboard weather refresh failed; retaining any saved weather.", error);
      if (hasWeather) {
        const latest = readDisplayWeather();
        if (status instanceof HTMLElement) {
          status.textContent = translate(
            latest?.cacheLocation ? "weather.refreshFallback" : "weather.refreshFallbackNoLocation",
            { location: latest?.cacheLocation || "" },
          );
        }
        return;
      }
      lastResult = {
        ...failureResult,
        data: null,
        source: "unavailable",
        weatherError: error,
      };
      renderDashboard(root, lastResult);
    };
    const commit = (result, generation) => {
      if (generation !== requestGeneration) return;
      if (!result.data?.current) {
        return false;
      }
      hasWeather = true;
      const saved = saveDisplayWeather(result.data, result.source);
      lastResult = {
        ...result,
        cacheTime: saved?.savedAt,
        cacheLocation: saved?.locationLabel,
      };
      renderDashboard(root, lastResult);
      return true;
    };
    const startRefresh = (generation, explicit = false) => {
      setLoading(true);
      loadAutomaticWithFallback({ refresh: true, explicit, includeHourly: false }).then((result) => {
        if (!commit(result, generation)) {
          renderFailure(
            result.weatherError || new Error("Weather data is unavailable."),
            generation,
            result,
          );
        }
      }).catch((error) => renderFailure(error, generation)).finally(() => {
        if (generation === requestGeneration) setLoading(false);
      });
    };
    const generation = ++requestGeneration;
    startRefresh(generation);
    window.addEventListener("jalsaathi:weather-location-changed", (event) => {
      const location = typeof event.detail?.location === "string" ? event.detail.location.trim() : "";
      if (!location) return;
      requestGeneration += 1;
      const currentGeneration = requestGeneration;
      const matchingCache = readDisplayWeather({ location });
      hasWeather = Boolean(matchingCache?.data?.current);
      if (matchingCache) {
        lastResult = matchingCache;
        renderDashboard(root, lastResult);
      }
      else {
        setValue(root, '[data-weather="location"]', location);
        setValue(root, '[data-weather="temperature"]', "Loading…");
        setValue(root, '[data-weather="condition"]', translate("legacy.audit.loading-weather.ff988149"));
        setValue(root, '[data-weather="feels_like"]', "Loading…");
        setValue(root, '[data-weather="humidity"]', "Loading…");
        setValue(root, '[data-weather="wind_speed"]', "Loading…");
        setValue(root, '[data-weather="rainfall"]', "Loading…");
        setValue(root, '[data-weather="rain_probability"]', "Loading…");
        setValue(root, "[data-weather-high-low]", "Loading forecast…");
        setValue(root, "[data-weather-updated]", "Loading…");
        root.dataset.weatherCondition = "unknown";
      }
      setLoading(true);
      load({ location }, { refresh: true }).then((data) => {
        commit({ data, source: "manual" }, currentGeneration);
      }).catch((error) => renderFailure(error, currentGeneration)).finally(() => {
        if (currentGeneration === requestGeneration) setLoading(false);
      });
    });
  };

  const initializeWeatherPage = (root) => {
    const locationForm = root.querySelector("[data-weather-location-form]");
    const input = locationForm?.elements.namedItem("location");
    const status = root.querySelector("[data-weather-status]");
    const currentRoot = root.querySelector("[data-weather-view]");
    const hourlyRows = root.querySelector("[data-forecast-rows]");
    const dailyRows = root.querySelector("[data-daily-forecast-rows]");
    if (!(currentRoot instanceof HTMLElement) || !(status instanceof HTMLElement)) return;

    const savedLocation = getManualLocation();
    const preferredLocation = savedLocation || getProfileLocation();
    const cached = readDisplayWeather({ location: preferredLocation || undefined });
    let hasWeather = Boolean(cached?.data?.current);
    let requestGeneration = 0;
    let lastResult = cached;
    if (!cached) {
      setValue(currentRoot, "[data-weather-location]", preferredLocation || "Finding location…");
      setValue(currentRoot, "[data-weather-temperature]", "Loading…");
      setValue(currentRoot, "[data-weather-condition]", translate("legacy.audit.loading-weather.ff988149"));
      setValue(currentRoot, "[data-weather-feels-like]", "Loading…");
      setValue(currentRoot, "[data-weather-high-low]", "Loading…");
      setValue(currentRoot, "[data-weather-updated]", "Loading…");
      for (const selector of [
        "[data-weather-humidity]",
        "[data-weather-wind]",
        "[data-weather-rainfall]",
        "[data-weather-rain-probability]",
      ]) setValue(currentRoot, selector, "Loading…");
    }

    const render = (result) => {
      lastResult = result;
      const data = result.data;
      const current = data?.current;
      setValue(currentRoot, "[data-weather-location]", result.source === "cached"
        ? result.cacheLocation
        : current ? displayLocation(current, result.source, data?.selection) ||
          (result.source === "current-location" ? translate("weather.currentLocation") : result.source === "manual"
            ? data?.selection?.location || translate("legacy.chosen.location.7ded283f")
            : translate("weather.configuredLocation"))
          : result.selection?.location || translate("weather.locationUnavailable"));
      setTemperatureValue(currentRoot, "[data-weather-temperature]", current?.temperature_c);
      setTemperatureIndicator(currentRoot, "[data-weather-temperature-indicator]", current?.temperature_c);
      publishCurrentWeather(current);
      setTemperatureValue(currentRoot, "[data-weather-feels-like]", current?.feels_like_c);
      setValue(currentRoot, "[data-weather-condition]", current
        ? condition(current.weather_code)
        : translate("weather.currentUnavailable"));
      setValue(currentRoot, "[data-weather-observation]", result.source === "cached"
        ? translate("weather.savedWeatherRefreshing", {
          location: result.cacheLocation || translate("weather.locationUnavailable"),
        })
        : current
          ? `${current.is_stale ? "Cached data" : "Provider data"} · ${formatTime(current.observation_time)}`
          : translate("legacy.not.provided.20a04182"));
      setValue(currentRoot, "[data-weather-humidity]", formatNumber(current?.humidity_percent, "%"));
      setValue(currentRoot, "[data-weather-wind]", formatNumber(current?.wind_speed_mps, " m/s"));
      setValue(currentRoot, "[data-weather-rainfall]", formatNumber(current?.rainfall_mm_per_hr, " mm/h"));
      setValue(currentRoot, "[data-weather-rain-probability]", formatNumber(current?.precipitation_probability_percent, "%"));
      const daily = data?.daily?.[0];
      setValue(currentRoot, "[data-weather-high-low]", daily?.temperature_high_c != null && daily?.temperature_low_c != null
        ? `${formatCurrentTemperature(daily.temperature_high_c)} / ${formatCurrentTemperature(daily.temperature_low_c)}`
        : translate("legacy.not.provided.20a04182"));
      setValue(currentRoot, "[data-weather-updated]", result.source === "cached"
        ? formatTime(result.cacheTime)
        : current?.observation_time ? formatTime(current.observation_time) : translate("legacy.not.provided.20a04182"));
      status.textContent = result.source === "cached"
        ? translate("weather.savedWeatherRefreshing", { location: result.cacheLocation })
        : result.refreshError
          ? translate(result.cacheLocation ? "weather.refreshFallback" : "weather.refreshFallbackNoLocation", {
            location: result.cacheLocation || "",
          })
          : current
            ? locationIssueMessage(result.locationIssue)
            : translate("weather.currentUnavailable");

      if (result.source !== "cached" && hourlyRows instanceof HTMLElement) {
        hourlyRows.innerHTML = (data?.hourly || []).map((item) => `<tr>
          <td>${escapeText(formatTime(item.time))}</td><td>${escapeText(formatCurrentTemperature(item.temperature_c))}</td>
          <td>${escapeText(formatCurrentTemperature(item.feels_like_c))}</td><td>${escapeText(formatNumber(item.rainfall_mm_per_hr, " mm/h"))}</td>
          <td>${escapeText(formatNumber(item.rain_probability_percent, "%"))}</td>
        </tr>`).join("");
      }
      if (result.source !== "cached" && dailyRows instanceof HTMLElement) {
        dailyRows.innerHTML = (data?.daily || []).map((item) => `<tr>
          <td>${escapeText(formatTime(item.time))}</td><td>${escapeText(condition(item.weather_code))}</td>
          <td>${escapeText(formatCurrentTemperature(item.temperature_high_c))}</td><td>${escapeText(formatCurrentTemperature(item.temperature_low_c))}</td>
          <td>${escapeText(formatNumber(item.rain_probability_percent, "%"))}</td>
        </tr>`).join("");
      }
      if (result.source !== "cached") {
        setValue(root, "[data-forecast-status]", data?.hourly?.length
          ? window.JalSaathiI18n.t("weather.hourlyPeriods", {
            value: window.JalSaathiI18n.formatNumber(data.hourly.length),
          })
          : data?.hourlyError?.message || "Hourly forecast unavailable");
        setValue(root, "[data-daily-forecast-status]", data?.daily?.length
          ? window.JalSaathiI18n.t("weather.dailyPeriods", {
            value: window.JalSaathiI18n.formatNumber(data.daily.length),
          })
          : data?.dailyError?.message || "Daily forecast unavailable");
      }
    };

    window.addEventListener("jalsaathi:language-changed", () => {
      if (lastResult) render(lastResult);
    });
    if (cached) render(cached);
    if (input instanceof HTMLInputElement) input.value = getManualLocation();
    const renderFailure = (error, generation, failureResult = {}) => {
      if (generation !== requestGeneration) return;
      if (error) console.warn("Weather refresh failed; retaining any saved weather.", error);
      if (hasWeather) {
        const latest = readDisplayWeather();
        status.textContent = translate(
          latest?.cacheLocation ? "weather.refreshFallback" : "weather.refreshFallbackNoLocation",
          { location: latest?.cacheLocation || "" },
        );
        return;
      }
      render({
        ...failureResult,
        data: null,
        source: "unavailable",
        weatherError: error,
      });
    };
    const applyResult = (result, generation) => {
      if (generation !== requestGeneration) return;
      if (!result.data?.current) {
        return false;
      }
      hasWeather = true;
      const saved = saveDisplayWeather(result.data, result.source);
      render({ ...result, cacheTime: saved?.savedAt, cacheLocation: saved?.locationLabel });
      return true;
    };
    locationForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!(input instanceof HTMLInputElement) || !input.value.trim()) return;
      const location = saveManualLocation(input.value);
      requestGeneration += 1;
      const generation = requestGeneration;
      const matchingCache = readDisplayWeather({ location });
      hasWeather = Boolean(matchingCache?.data?.current);
      if (matchingCache) render(matchingCache);
      else {
        status.textContent = translate("legacy.audit.loading-weather.ff988149");
        setValue(currentRoot, "[data-weather-location]", location);
        setValue(currentRoot, "[data-weather-temperature]", "Loading…");
        setValue(currentRoot, "[data-weather-condition]", translate("legacy.audit.loading-weather.ff988149"));
        setValue(currentRoot, "[data-weather-feels-like]", "Loading…");
        setValue(currentRoot, "[data-weather-high-low]", "Loading…");
        setValue(currentRoot, "[data-weather-updated]", "Loading…");
        for (const selector of [
          "[data-weather-humidity]",
          "[data-weather-wind]",
          "[data-weather-rainfall]",
          "[data-weather-rain-probability]",
        ]) setValue(currentRoot, selector, "Loading…");
      }
      load({ location }, { refresh: true }).then((data) => {
        applyResult({ data, source: "manual" }, generation);
      }).catch((error) => renderFailure(error, generation));
    });
    const generation = ++requestGeneration;
    if (!hasWeather) status.textContent = translate("legacy.audit.loading-weather.ff988149");
    loadAutomaticWithFallback({ refresh: true }).then((result) => {
      if (!applyResult(result, generation)) {
        renderFailure(
          result.weatherError || new Error("Weather data is unavailable."),
          generation,
          result,
        );
      }
    }).catch((error) => renderFailure(error, generation));
  };

  const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  window.JalSaathiWeather = {
    formatCurrentTemperature,
    formatCurrentCondition: condition,
    getManualLocation,
    saveManualLocation,
    getCoordinates,
    load,
    loadCurrent,
    loadAutomatic,
    initializeDashboard,
    initializeWeatherPage,
  };
})();
