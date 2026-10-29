(function () {
  "use strict";

  const STORAGE_KEY = "jalsaathi.demo.fields.v1";
  const seedFields = [
    { id: "sample-north", name: "Field 1 - North Plot", location: "North Plot", crop: "Paddy", area: 2.5, areaUnit: "acres", moisture: null, moistureSource: "demonstration", lastIrrigated: "", plantingDate: "", boundary: null },
    { id: "sample-east", name: "Field 2 - East Plot", location: "East Plot", crop: "Sugarcane", area: 3, areaUnit: "acres", moisture: null, moistureSource: "demonstration", lastIrrigated: "", plantingDate: "", boundary: null },
    { id: "sample-south", name: "Field 3 - South Field", location: "South Field", crop: "Ragi", area: 1.75, areaUnit: "acres", moisture: null, moistureSource: "demonstration", lastIrrigated: "", plantingDate: "", boundary: null },
  ];
  let memoryFields = seedFields;
  let serverFields = [];
  let persistenceWarning = "";

  const normalize = (value) => {
    if (!Array.isArray(value)) throw new Error("Saved field data is not a list.");
    return value.map((field) => {
      if (
        !field || typeof field !== "object" || typeof field.id !== "string" ||
        typeof field.name !== "string" || typeof field.location !== "string" ||
        typeof field.crop !== "string" || !Number.isFinite(Number(field.area)) ||
        typeof field.areaUnit !== "string"
      ) throw new Error("Saved field data contains an invalid record.");
      const moisture = field.moistureSource !== "user-provided" || field.moisture === null || field.moisture === undefined || field.moisture === "" ? null : Number(field.moisture);
      const latitude = field.latitude === null || field.latitude === undefined || field.latitude === ""
        ? null
        : Number(field.latitude);
      const longitude = field.longitude === null || field.longitude === undefined || field.longitude === ""
        ? null
        : Number(field.longitude);
      if (Number(field.area) <= 0 || (moisture !== null && (!Number.isFinite(moisture) || moisture < 0 || moisture > 100))) {
        throw new Error("Saved field data contains an out-of-range area or moisture value.");
      }
      if (
        (latitude !== null && (typeof field.latitude === "boolean" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
        (longitude !== null && (typeof field.longitude === "boolean" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) ||
        ((latitude === null) !== (longitude === null))
      ) {
        throw new Error("Saved field data contains an invalid coordinate pair.");
      }
      return {
        ...field,
        area: Number(field.area),
        latitude,
        longitude,
        moisture,
        boundary: Array.isArray(field.boundary) ? field.boundary : null,
        plantingDate: typeof field.plantingDate === "string" ? field.plantingDate : "",
        lastIrrigated: typeof field.lastIrrigated === "string" ? field.lastIrrigated : "",
        moistureSource: field.moistureSource === "user-provided" ? "user-provided" : "demonstration",
      };
    });
  };

  const load = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      memoryFields = saved === null ? seedFields.map((field) => ({ ...field })) : normalize(JSON.parse(saved));
    } catch (error) {
      persistenceWarning = "Saved demonstration field data could not be read; changes may not persist.";
      console.error("JalSaathi field data load failed:", error);
      memoryFields = seedFields.map((field) => ({ ...field }));
    }
  };

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryFields));
    } catch (error) {
      persistenceWarning = "Browser storage is unavailable; field changes will last only until this page is closed.";
      console.error("JalSaathi field data could not be saved:", error);
    }
    window.dispatchEvent(new CustomEvent("jalsaathi:fields-changed", { detail: getFields() }));
  };

  const getFields = () => memoryFields.map((field) => ({ ...field, boundary: field.boundary ? field.boundary.map((point) => [...point]) : null }));
  const getPersistenceWarning = () => persistenceWarning;
  const addField = (field) => {
    const record = normalize([{ ...field, id: field.id || `demo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }])[0];
    if (memoryFields.some((item) => item.id === record.id)) throw new Error("Field ID must be unique.");
    memoryFields = [...memoryFields, record];
    save();
    return { ...record };
  };
  const updateField = (id, changes) => {
    const index = memoryFields.findIndex((field) => field.id === id);
    if (index < 0) throw new Error("The field to update no longer exists.");
    const updated = normalize([{ ...memoryFields[index], ...changes, id }])[0];
    memoryFields = memoryFields.map((field, fieldIndex) => fieldIndex === index ? updated : field);
    save();
    return { ...updated };
  };
  const deleteField = (id) => {
    const existing = memoryFields.find((field) => field.id === id);
    if (!existing) return null;
    memoryFields = memoryFields.filter((field) => field.id !== id);
    save();
    return { ...existing };
  };

  const fromServer = (field) => ({
    id: String(field.id),
    name: field.name,
    location: field.location || "",
    crop: field.crop || "",
    area: Number(field.area),
    areaUnit: field.area_unit,
    latitude: field.latitude === null || field.latitude === undefined ? null : Number(field.latitude),
    longitude: field.longitude === null || field.longitude === undefined ? null : Number(field.longitude),
    moisture: null,
    moistureSource: "server",
    lastIrrigated: "",
    plantingDate: "",
    boundary: null,
  });

  const loadServerFields = async () => {
    const records = await window.JalSaathiProfile.apiRequest("/api/fields");
    if (!Array.isArray(records)) throw new Error("The field response has an invalid format.");
    serverFields = records.map(fromServer);
    window.dispatchEvent(new CustomEvent("jalsaathi:fields-changed", { detail: getServerFields() }));
    return getServerFields();
  };

  const serverPayload = (field) => ({
    name: field.name,
    location: field.location || null,
    crop: field.crop || null,
    area: Number(field.area),
    area_unit: field.areaUnit,
    latitude: field.latitude === null || field.latitude === undefined || field.latitude === ""
      ? null
      : Number(field.latitude),
    longitude: field.longitude === null || field.longitude === undefined || field.longitude === ""
      ? null
      : Number(field.longitude),
  });

  const addServerField = async (field) => {
    const created = await window.JalSaathiProfile.apiRequest("/api/fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serverPayload(field)),
    });
    await loadServerFields();
    return fromServer(created);
  };

  const updateServerField = async (id, field) => {
    const updated = await window.JalSaathiProfile.apiRequest(`/api/fields/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serverPayload(field)),
    });
    await loadServerFields();
    return fromServer(updated);
  };

  const deleteServerField = async (id) => {
    const existing = serverFields.find((field) => field.id === id);
    await window.JalSaathiProfile.apiRequest(`/api/fields/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadServerFields();
    return existing || null;
  };

  const getServerFields = () => serverFields.map((field) => ({ ...field }));

  load();
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || event.newValue === null) return;
    try {
      memoryFields = normalize(JSON.parse(event.newValue));
      window.dispatchEvent(new CustomEvent("jalsaathi:fields-changed", { detail: getFields() }));
    } catch (error) {
      persistenceWarning = "Updated field data from another tab could not be read.";
      console.error("JalSaathi field data sync failed:", error);
    }
  });
  window.JalSaathiFieldStore = {
    getFields,
    getPersistenceWarning,
    addField,
    updateField,
    deleteField,
    getServerFields,
    loadServerFields,
    addServerField,
    updateServerField,
    deleteServerField,
  };
})();
