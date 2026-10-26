(() => {
  "use strict";

  const MANUAL_LOCATION_KEY = "jalsaathi.weather.manual-location.v1";
  const DISPLAY_CACHE_KEY = "jalsaathi.weather.display-cache.v1";
  const CACHE_MILLISECONDS = 10 * 60 * 1000;
  const DISPLAY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
  const inFlight = new Map();
  const cache = new Map();
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

  const displayLocation = (current, source, selection = {}) => {
    const candidate = source === "current-location"
      ? current?.locality || current?.location_name
      : selection.location || current?.location_name || current?.location;
    if (typeof candidate === "string" && candidate.trim() && !isCoordinateLocation(candidate)) {
      return candidate.trim().slice(0, 120);
    }
    return source === "configured" ? "Configured location" : "";
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
  ].some((field) => {
    const value = current[field];
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  });

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
    if (!hasDisplayableWeather(current) || !["current-location", "manual", "configured"].includes(source)) return;
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
      localStorage.setItem(MANUAL_LOCATION_KEY, value);
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
    const response = await fetch(url, hasCoordinates ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection.coordinates),
      credentials: "same-origin",
    } : { credentials: "same-origin" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload && typeof payload.detail === "string"
        ? payload.detail
        : "Weather data is unavailable. Check the provider configuration and try again.");
    }
    return payload;
  };

  const forecast = (selection, timestep, hours) => requestJson(
    "/weather/forecast",
    selection,
    { query: new URLSearchParams({ hours: String(hours), timestep }).toString() },
  );

  const load = (selection = {}, { refresh = false } = {}) => {
    const normalized = selection.coordinates
      ? { coordinates: validateCoordinates(selection.coordinates) }
      : { location: selection.location?.trim() || "" };
    const key = selectionKey(normalized);
    const existing = cache.get(key);
    if (!refresh && existing && Date.now() - existing.time < CACHE_MILLISECONDS) {
      return Promise.resolve(existing.data);
    }
    if (inFlight.has(key)) return inFlight.get(key);

    const request = Promise.allSettled([
      requestJson("/weather/current", normalized),
      forecast(normalized, "1h", 24),
      forecast(normalized, "1d", 5),
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

  const loadAutomatic = async ({ refresh = false, explicit = false } = {}) => {
    const manualLocation = getManualLocation();
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
    const loadLocationFallback = async (locationError) => {
      let manualError = null;
      if (manualLocation) {
        try {
          return {
            data: await load({ location: manualLocation }, { refresh }),
            source: "manual",
            locationError,
          };
        } catch (error) {
          manualError = error;
        }
      }
      try {
        return {
          data: await load({}, { refresh }),
          source: "configured",
          locationError: manualError
            ? `${locationError} Saved city weather was unavailable; showing the configured location.`
            : locationError,
        };
      } catch (weatherError) {
        return {
          data: null,
          source: "unavailable",
          locationError: manualError
            ? `${locationError} Saved city and configured weather are unavailable.`
            : locationError,
          weatherError,
        };
      }
    };
    if (!explicit && (permission === "denied" || (wasPreviouslyDenied && permission !== "granted"))) {
      return loadLocationFallback("Location permission is off.");
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
      return loadLocationFallback(error.message);
    }
    return { data: await load({ coordinates }, { refresh }), source: "current-location" };
  };

  const formatNumber = (value, suffix = "") => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`
    : "Not provided";

  const formatCurrentTemperature = (value) => {
    if ((typeof value !== "number" && typeof value !== "string") ||
        (typeof value === "string" && value.trim() === "")) return "Unavailable";
    const temperature = Number(value);
    return Number.isFinite(temperature) ? `${Math.round(temperature)}°C` : "Unavailable";
  };

  const publishCurrentWeather = (current) => {
    window.dispatchEvent(new CustomEvent("jalsaathi:weather-updated", {
      detail: {
        temperatureC: current?.temperature_c ?? null,
        condition: current ? condition(current.weather_code) : "Unavailable",
      },
    }));
  };

  const setTemperatureIndicator = (root, selector, value) => {
    const indicator = root.querySelector(selector);
    if (indicator instanceof HTMLElement) {
      indicator.hidden = formatCurrentTemperature(value) === "Unavailable";
    }
  };

  const formatTime = (value) => {
    if (!value) return "Not provided";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
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
        (result.source === "current-location" ? "Current location" : result.source === "manual"
          ? result.data?.selection?.location || "Chosen location"
          : "Configured location")
        : result.selection?.location || "Location unavailable");
    setValue(root, '[data-weather="temperature"]', formatCurrentTemperature(current?.temperature_c));
    setTemperatureIndicator(root, ".temperature-indicator", current?.temperature_c);
    publishCurrentWeather(current);
    setValue(root, '[data-weather="condition"]', current
      ? condition(current.weather_code)
      : result.weatherError?.message || "Weather unavailable");
    setValue(root, '[data-weather="feels_like"]', current ? formatNumber(current.feels_like_c, "°C") : "Not provided");
    setValue(root, '[data-weather="humidity"]', current ? formatNumber(current.humidity_percent, "%") : "Not provided");
    setValue(root, '[data-weather="wind_speed"]', current ? formatNumber(current.wind_speed_mps, " m/s") : "Not provided");
    setValue(root, '[data-weather="rainfall"]', current ? formatNumber(current.rainfall_mm_per_hr, " mm/h") : "Not provided");
    setValue(root, '[data-weather="rain_probability"]', current ? formatNumber(current.precipitation_probability_percent, "%") : "Not provided");
    setValue(root, "[data-weather-updated]", result.source === "cached"
      ? `Saved weather · ${formatTime(result.cacheTime)}`
      : current?.observation_time
        ? `${current.is_stale ? "Cached observation" : "Last updated"} · ${formatTime(current.observation_time)}`
        : "Last updated unavailable");
    const status = root.querySelector("[data-dashboard-weather-message]");
    if (status instanceof HTMLElement) {
      status.textContent = result.source === "cached"
        ? `Showing saved weather for ${result.cacheLocation} · Refreshing in the background.`
        : result.refreshError
          ? `Unable to refresh · showing the last successful weather${result.cacheLocation ? ` for ${result.cacheLocation}` : ""}.`
          : result.locationError
        ? `${result.locationError}${result.source === "configured" ? "" : " Choose a city on the Weather page."}`
        : result.source === "current-location"
          ? "Weather for your current location."
          : result.source === "manual"
            ? "Weather for your chosen location."
            : current ? "Weather for the configured location." : "Weather is unavailable. Choose a city on the Weather page.";
    }
    if (result.data?.daily?.length) {
      const today = result.data.daily[0];
      setValue(root, "[data-weather-high-low]", today.temperature_high_c != null && today.temperature_low_c != null
        ? `Next forecast day · ${formatNumber(today.temperature_high_c, "°C")} / ${formatNumber(today.temperature_low_c, "°C")}`
        : "Forecast high/low not provided");
    } else {
      setValue(root, "[data-weather-high-low]", "Forecast high/low unavailable");
    }
  };

  const initializeDashboard = (root) => {
    const status = root.querySelector("[data-dashboard-weather-message]");
    const loading = root.querySelector("[data-weather-loading]");
    const manualLocation = getManualLocation();
    const cached = readDisplayWeather({ location: manualLocation || undefined });
    let hasWeather = Boolean(cached?.data?.current);
    let refreshSucceeded = false;
    let liveLocationResolved = false;
    let requestGeneration = 0;
    if (cached) renderDashboard(root, cached);
    else {
      setValue(root, '[data-weather="location"]', manualLocation || "Finding location…");
      setValue(root, '[data-weather="temperature"]', "Loading…");
      setValue(root, '[data-weather="condition"]', "Loading weather…");
      setValue(root, '[data-weather="feels_like"]', "Loading…");
      setValue(root, '[data-weather="humidity"]', "Loading…");
      setValue(root, '[data-weather="wind_speed"]', "Loading…");
      setValue(root, '[data-weather="rainfall"]', "Loading…");
      setValue(root, '[data-weather="rain_probability"]', "Loading…");
      setValue(root, "[data-weather-high-low]", "Loading forecast…");
      if (status instanceof HTMLElement) status.textContent = "Loading weather…";
    }
    const setLoading = (isLoading) => {
      root.classList.toggle("is-loading", isLoading);
      if (loading instanceof HTMLElement) loading.hidden = !isLoading;
      if (status instanceof HTMLElement && isLoading && !hasWeather) status.textContent = "Loading weather…";
    };
    const renderFailure = (error, generation) => {
      if (generation !== undefined && generation !== requestGeneration) return;
      if (hasWeather) {
        const latest = readDisplayWeather();
        if (status instanceof HTMLElement) {
          status.textContent = `Unable to refresh · showing the last successful weather${latest?.cacheLocation ? ` for ${latest.cacheLocation}` : ""}.`;
        }
        return;
      }
      renderDashboard(root, { data: null, source: "unavailable", weatherError: error });
    };
    const commit = (result, generation, { fallback = false } = {}) => {
      if (generation !== requestGeneration || (fallback && liveLocationResolved)) return;
      if (!result.data?.current) {
        return false;
      }
      refreshSucceeded = true;
      if (result.source === "current-location") liveLocationResolved = true;
      hasWeather = true;
      const saved = saveDisplayWeather(result.data, result.source);
      renderDashboard(root, {
        ...result,
        cacheTime: saved?.savedAt,
        cacheLocation: saved?.locationLabel,
      });
      return true;
    };
    const startRefresh = (generation, explicit = false) => {
      setLoading(true);
      const location = getManualLocation();
      let fallbackDone = false;
      let automaticDone = false;
      let fallbackError = null;
      let automaticError = null;
      const showFailureWhenSettled = () => {
        if (generation !== requestGeneration || refreshSucceeded || !fallbackDone || !automaticDone) return;
        renderFailure(automaticError || fallbackError || new Error("Weather data is unavailable."), generation);
      };
      load({ location }, { refresh: true }).then((data) => {
        if (!commit({ data, source: location ? "manual" : "configured" }, generation, { fallback: true })) {
          fallbackError = new Error("Weather data is unavailable.");
        }
      }).catch((error) => {
        fallbackError = error;
      }).finally(() => {
        fallbackDone = true;
        showFailureWhenSettled();
      });
      loadAutomatic({ refresh: true, explicit }).then((result) => {
        if (!commit(result, generation)) {
          automaticError = result.weatherError || new Error("Weather data is unavailable.");
        }
      }).catch((error) => {
        automaticError = error;
      }).finally(() => {
        automaticDone = true;
        if (generation === requestGeneration) setLoading(false);
        showFailureWhenSettled();
      });
    };
    const generation = ++requestGeneration;
    startRefresh(generation);
    window.addEventListener("jalsaathi:weather-location-changed", (event) => {
      const location = typeof event.detail?.location === "string" ? event.detail.location.trim() : "";
      if (!location) return;
      requestGeneration += 1;
      liveLocationResolved = true;
      const currentGeneration = requestGeneration;
      const matchingCache = readDisplayWeather({ location });
      hasWeather = Boolean(matchingCache?.data?.current);
      if (matchingCache) renderDashboard(root, matchingCache);
      else {
        setValue(root, '[data-weather="location"]', location);
        setValue(root, '[data-weather="temperature"]', "Loading…");
        setValue(root, '[data-weather="condition"]', "Loading weather…");
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
    const cached = readDisplayWeather({ location: savedLocation || undefined });
    let hasWeather = Boolean(cached?.data?.current);
    let requestGeneration = 0;
    let liveLocationResolved = false;
    let refreshSucceeded = false;
    if (!cached) {
      setValue(currentRoot, "[data-weather-location]", savedLocation || "Finding location…");
      setValue(currentRoot, "[data-weather-temperature]", "Loading…");
      setValue(currentRoot, "[data-weather-condition]", "Loading weather…");
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
      const data = result.data;
      const current = data?.current;
      setValue(currentRoot, "[data-weather-location]", result.source === "cached"
        ? result.cacheLocation
        : current ? displayLocation(current, result.source, data?.selection) ||
          (result.source === "current-location" ? "Current location" : result.source === "manual"
            ? data?.selection?.location || "Chosen location"
            : "Configured location")
          : result.selection?.location || "Location unavailable");
      setValue(currentRoot, "[data-weather-temperature]", formatCurrentTemperature(current?.temperature_c));
      setTemperatureIndicator(currentRoot, "[data-weather-temperature-indicator]", current?.temperature_c);
      publishCurrentWeather(current);
      setValue(currentRoot, "[data-weather-feels-like]", current ? formatNumber(current.feels_like_c, "°C") : "Not provided");
      setValue(currentRoot, "[data-weather-condition]", current ? condition(current.weather_code) : result.weatherError?.message || "Unavailable");
      setValue(currentRoot, "[data-weather-observation]", result.source === "cached"
        ? `Saved weather · ${formatTime(result.cacheTime)}`
        : current
          ? `${current.is_stale ? "Cached data" : "Provider data"} · ${formatTime(current.observation_time)}`
          : "Current weather unavailable");
      setValue(currentRoot, "[data-weather-humidity]", current ? formatNumber(current.humidity_percent, "%") : "Not provided");
      setValue(currentRoot, "[data-weather-wind]", current ? formatNumber(current.wind_speed_mps, " m/s") : "Not provided");
      setValue(currentRoot, "[data-weather-rainfall]", current ? formatNumber(current.rainfall_mm_per_hr, " mm/h") : "Not provided");
      setValue(currentRoot, "[data-weather-rain-probability]", current ? formatNumber(current.precipitation_probability_percent, "%") : "Not provided");
      const daily = data?.daily?.[0];
      setValue(currentRoot, "[data-weather-high-low]", daily?.temperature_high_c != null && daily?.temperature_low_c != null
        ? `${formatNumber(daily.temperature_high_c, "°C")} / ${formatNumber(daily.temperature_low_c, "°C")}`
        : "Not provided");
      setValue(currentRoot, "[data-weather-updated]", result.source === "cached"
        ? formatTime(result.cacheTime)
        : current?.observation_time ? formatTime(current.observation_time) : "Not provided");
      status.textContent = result.source === "cached"
        ? `Showing saved weather for ${result.cacheLocation} · Refreshing in the background.`
        : result.refreshError
          ? `Unable to refresh · showing the last successful weather${result.cacheLocation ? ` for ${result.cacheLocation}` : ""}.`
          : result.locationError
        ? `${result.locationError}${result.source === "configured" ? " Showing configured location." : ""}`
        : result.weatherError?.message
          || (result.source === "current-location"
            ? "Weather for your current location"
            : result.source === "manual"
              ? "Chosen location"
              : "Configured location");

      if (result.source !== "cached" && hourlyRows instanceof HTMLElement) {
        hourlyRows.innerHTML = (data?.hourly || []).map((item) => `<tr>
          <td>${escapeText(formatTime(item.time))}</td><td>${escapeText(formatNumber(item.temperature_c, "°C"))}</td>
          <td>${escapeText(formatNumber(item.feels_like_c, "°C"))}</td><td>${escapeText(formatNumber(item.rainfall_mm_per_hr, " mm/h"))}</td>
          <td>${escapeText(formatNumber(item.rain_probability_percent, "%"))}</td>
        </tr>`).join("");
      }
      if (result.source !== "cached" && dailyRows instanceof HTMLElement) {
        dailyRows.innerHTML = (data?.daily || []).map((item) => `<tr>
          <td>${escapeText(formatTime(item.time))}</td><td>${escapeText(condition(item.weather_code))}</td>
          <td>${escapeText(formatNumber(item.temperature_high_c, "°C"))}</td><td>${escapeText(formatNumber(item.temperature_low_c, "°C"))}</td>
          <td>${escapeText(formatNumber(item.rain_probability_percent, "%"))}</td>
        </tr>`).join("");
      }
      if (result.source !== "cached") {
        setValue(root, "[data-forecast-status]", data?.hourly?.length
          ? `${data.hourly.length} hourly periods${data.hourlyError ? " · daily data unavailable" : ""}`
          : data?.hourlyError?.message || "Hourly forecast unavailable");
        setValue(root, "[data-daily-forecast-status]", data?.daily?.length
          ? `${data.daily.length} daily periods`
          : data?.dailyError?.message || "Daily forecast unavailable");
      }
    };

    if (cached) render(cached);
    if (input instanceof HTMLInputElement) input.value = getManualLocation();
    const renderFailure = (error, generation) => {
      if (generation !== requestGeneration) return;
      if (hasWeather) {
        const latest = readDisplayWeather();
        status.textContent = `Unable to refresh · showing the last successful weather${latest?.cacheLocation ? ` for ${latest.cacheLocation}` : ""}.`;
        return;
      }
      render({ data: null, source: "unavailable", weatherError: error });
    };
    const applyResult = (result, generation, fallback = false, deferFailure = false) => {
      if (generation !== requestGeneration || (fallback && liveLocationResolved)) return;
      if (!result.data?.current) {
        if (!deferFailure) renderFailure(result.weatherError || new Error("Weather data is unavailable."), generation);
        return false;
      }
      refreshSucceeded = true;
      if (result.source === "current-location") liveLocationResolved = true;
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
      liveLocationResolved = true;
      const matchingCache = readDisplayWeather({ location });
      hasWeather = Boolean(matchingCache?.data?.current);
      if (matchingCache) render(matchingCache);
      else {
        status.textContent = "Loading weather…";
        setValue(currentRoot, "[data-weather-location]", location);
        setValue(currentRoot, "[data-weather-temperature]", "Loading…");
        setValue(currentRoot, "[data-weather-condition]", "Loading weather…");
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
    if (!hasWeather) status.textContent = "Loading weather…";
    const fallbackLocation = getManualLocation();
    let fallbackDone = false;
    let automaticDone = false;
    let fallbackError = null;
    let automaticError = null;
    const showFailureWhenSettled = () => {
      if (generation !== requestGeneration || refreshSucceeded || !fallbackDone || !automaticDone) return;
      renderFailure(automaticError || fallbackError || new Error("Weather data is unavailable."), generation);
    };
    load({ location: fallbackLocation }, { refresh: true }).then((data) => {
      if (!applyResult({ data, source: fallbackLocation ? "manual" : "configured" }, generation, true, true)) {
        fallbackError = new Error("Weather data is unavailable.");
      }
    }).catch((error) => {
      fallbackError = error;
    }).finally(() => {
      fallbackDone = true;
      showFailureWhenSettled();
    });
    loadAutomatic({ refresh: true }).then((result) => {
      if (!applyResult(result, generation, false, true)) {
        automaticError = result.weatherError || new Error("Weather data is unavailable.");
      }
    }).catch((error) => {
      automaticError = error;
    }).finally(() => {
      automaticDone = true;
      showFailureWhenSettled();
    });
  };

  const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  window.JalSaathiWeather = {
    formatCurrentTemperature,
    getManualLocation,
    saveManualLocation,
    getCoordinates,
    load,
    loadAutomatic,
    initializeDashboard,
    initializeWeatherPage,
  };
})();
