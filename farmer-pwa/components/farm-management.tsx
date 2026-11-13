"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useFarmData } from "@/components/farm-data-provider";
import { FieldCard } from "@/components/field-card";
import { useI18n } from "@/components/i18n-provider";
import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadingState } from "@/components/states";
import type { ApiError, FarmCrop, FarmField } from "@/lib/types";

type FieldForm = {
  name: string;
  location: string;
  crop: string;
  area: string;
  area_unit: "acres" | "hectares";
  latitude: string;
  longitude: string;
  coordinatesConfirmed: boolean;
};

type CropForm = {
  name: string;
  variety: string;
  field_id: string;
  growth_stage: string;
  planting_date: string;
  expected_harvest_date: string;
};

const emptyField: FieldForm = {
  name: "",
  location: "",
  crop: "",
  area: "",
  area_unit: "acres",
  latitude: "",
  longitude: "",
  coordinatesConfirmed: false,
};

const emptyCrop: CropForm = {
  name: "",
  variety: "",
  field_id: "",
  growth_stage: "",
  planting_date: "",
  expected_harvest_date: "",
};

function failureMessage(error: unknown, t: (source: string) => string): string {
  const apiError = error as ApiError;
  if (apiError.status === 401) return t("Your session expired. Your form is still here. Sign in again to continue.");
  if (apiError.status === 409) return t(apiError.message);
  return t("Could not save your changes. Check the form and try again.");
}

function issueFields(error: unknown, t: (source: string) => string): Record<string, string> {
  const issues = (error as ApiError).validationErrors ?? [];
  return issues.reduce<Record<string, string>>((result, issue) => {
    if (issue.field) result[issue.field] = t("The server rejected this value. Check it and try again.");
    return result;
  }, {});
}

function WriteAvailability({ online }: { online: boolean }) {
  const { t } = useI18n();
  return online ? null : <p className="offline-hint" role="status">{t("You're offline.")} {t("Changes are available when you reconnect.")}</p>;
}

export function FieldsManagement() {
  const { data, online, createField, updateField, deleteField } = useFarmData();
  const { t, formatNumber } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FarmField | null>(null);
  const [form, setForm] = useState<FieldForm>(emptyField);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FarmField | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!data) return <AppShell><LoadingState /></AppShell>;

  function openForm(field?: FarmField) {
    setEditing(field ?? null);
    setForm(field ? {
      name: field.name,
      location: field.location ?? "",
      crop: field.crop ?? "",
      area: String(field.area),
      area_unit: field.area_unit === "hectares" ? "hectares" : "acres",
      latitude: field.latitude == null ? "" : String(field.latitude),
      longitude: field.longitude == null ? "" : String(field.longitude),
      coordinatesConfirmed: field.latitude != null && field.longitude != null,
    } : emptyField);
    setErrors({});
    setMessage("");
    setFormOpen(true);
  }

  function validateField(values: FieldForm): Record<string, string> {
    const result: Record<string, string> = {};
    if (!values.name.trim()) result.name = t("Enter a field name.");
    else if (values.name.length > 80) result.name = t("Use no more than {limit} characters.", { limit: 80 });
    if (!values.location.trim()) result.location = t("Enter a field location or village.");
    else if (values.location.length > 100) result.location = t("Use no more than {limit} characters.", { limit: 100 });
    if (!["Paddy", "Sugarcane", "Ragi", "Maize", "Cotton", "Other"].includes(values.crop)) result.crop = t("Choose a crop type.");
    const area = Number(values.area);
    if (!values.area || !Number.isFinite(area) || area < 0.01) result.area = t("Enter an area of at least 0.01.");
    else if (area > 10_000_000) result.area = t("Area must not exceed 10,000,000.");
    const hasLat = values.latitude.trim() !== "";
    const hasLon = values.longitude.trim() !== "";
    if (hasLat !== hasLon) {
      result.latitude = t("Enter both coordinates, or leave both blank.");
      result.longitude = t("Enter both coordinates, or leave both blank.");
    } else if (hasLat && hasLon) {
      const latitude = Number(values.latitude);
      const longitude = Number(values.longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) result.latitude = t("Latitude must be between -90 and 90.");
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) result.longitude = t("Longitude must be between -180 and 180.");
      if (!values.coordinatesConfirmed) result.coordinatesConfirmed = t("Confirm that these coordinates represent the field.");
    }
    return result;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || saving) return;
    const invalid = validateField(form);
    setErrors(invalid);
    setMessage("");
    if (Object.keys(invalid).length) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        location: form.location.trim(),
        crop: form.crop,
        area: Number(form.area),
        area_unit: form.area_unit,
        latitude: form.latitude.trim() ? Number(form.latitude) : null,
        longitude: form.longitude.trim() ? Number(form.longitude) : null,
      };
      if (editing) await updateField(editing.id, payload);
      else await createField(payload);
      setMessage(t(editing ? "Field updated." : "Field added."));
      setFormOpen(false);
      setEditing(null);
    } catch (error) {
      setErrors((previous) => ({ ...previous, ...issueFields(error, t) }));
      setMessage(failureMessage(error, t));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || !online || deleting) return;
    setDeleting(true);
    setMessage("");
    try {
      await deleteField(pendingDelete.id);
      setMessage(t("Field deleted."));
      setPendingDelete(null);
    } catch (error) {
      setMessage(failureMessage(error, t));
    } finally {
      setDeleting(false);
    }
  }

  const setFieldValue = (key: keyof FieldForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };
  const fieldError = (key: string) => errors[key] ? <span className="form-field-error" role="alert">{errors[key]}</span> : null;

  return <AppShell>
    <section className="page-title page-title-row">
      <div><p className="eyebrow">{t("YOUR FARM")}</p><h1>{t("My fields")}</h1><p className="muted">{t("Field details saved to your account. Soil sensor readings are not connected.")}</p></div>
      <div className="management-heading-actions"><Link className="secondary-button" href="/crops">{t("Manage crops")}</Link><button className="primary-button compact-button" type="button" onClick={() => openForm()} disabled={!online}>{t("Add field")}</button></div>
    </section>
    <WriteAvailability online={online} />
    {message && <p className={`notice ${message.includes("could not") || message.includes("expired") || message.includes("rejected") || message.includes("Confirm or") ? "notice-error" : ""}`} role="status">{message}{message.includes("Sign in again") && <> <Link href="/login">{t("Sign in")}</Link></>}</p>}
    {data.fields.length ? <div className="management-list">{data.fields.map((field, index) => <article className="management-card" key={field.id}>
      <FieldCard field={field} crops={data.crops} index={index} />
      <div className="management-card-actions"><Link className="touch-link" href={`/fields/${field.id}`}>{t("View details")}</Link><button className="secondary-button" type="button" onClick={() => openForm(field)} disabled={!online}>{t("Edit field")}</button><button className="danger-button" type="button" onClick={() => setPendingDelete(field)} disabled={!online}>{t("Delete field")}</button></div>
      <p className="management-area">{formatNumber(field.area)} {field.area_unit}</p>
    </article>)}</div> : <EmptyState title={t("No fields registered yet")}>{t("Your registered fields will appear here.")}</EmptyState>}
    {formOpen && <div className="form-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}>
      <section className="form-sheet" role="dialog" aria-modal="true" aria-labelledby="field-form-title">
        <div className="form-sheet-heading"><h2 id="field-form-title">{t(editing ? "Edit field" : "Add field")}</h2><button className="icon-button" type="button" onClick={() => setFormOpen(false)} disabled={saving} aria-label={t("Close form")}>×</button></div>
        <p className="muted">{t("Field details are saved to your JalSaathi account.")}</p>
        <form className="management-form" onSubmit={(event) => void submit(event)} noValidate>
          <label className="form-field" htmlFor="field-name">{t("Field Name")}<input id="field-name" className="form-input" value={form.name} maxLength={80} disabled={!online || saving} onChange={(event) => setFieldValue("name", event.target.value)} aria-invalid={Boolean(errors.name)} />{fieldError("name")}</label>
          <label className="form-field" htmlFor="field-location">{t("Field Location or Village")}<input id="field-location" className="form-input" value={form.location} maxLength={100} disabled={!online || saving} onChange={(event) => setFieldValue("location", event.target.value)} aria-invalid={Boolean(errors.location)} />{fieldError("location")}</label>
          <label className="form-field" htmlFor="field-crop">{t("Crop Type")}<select id="field-crop" className="form-input" value={form.crop} disabled={!online || saving} onChange={(event) => setFieldValue("crop", event.target.value)}><option value="">{t("Select a crop")}</option>{form.crop && !["Paddy", "Sugarcane", "Ragi", "Maize", "Cotton", "Other"].includes(form.crop) && <option value={form.crop}>{form.crop}</option>}{["Paddy", "Sugarcane", "Ragi", "Maize", "Cotton", "Other"].map((crop) => <option key={crop} value={crop}>{t(crop)}</option>)}</select>{fieldError("crop")}</label>
          <div className="form-field"><label htmlFor="field-area">{t("Field Area")}</label><div className="form-inline"><input id="field-area" className="form-input" type="number" min="0.01" max="10000000" step="0.01" value={form.area} disabled={!online || saving} onChange={(event) => setFieldValue("area", event.target.value)} aria-invalid={Boolean(errors.area)} /><select className="form-input" aria-label={t("Field area unit")} value={form.area_unit} disabled={!online || saving} onChange={(event) => setFieldValue("area_unit", event.target.value as FieldForm["area_unit"])}><option value="acres">{t("Acres")}</option><option value="hectares">{t("Hectares")}</option></select></div>{fieldError("area")}</div>
          <fieldset className="coordinate-fields"><legend>{t("Field coordinates")} <span>{t("(optional)")}</span></legend><p className="muted">{t("Coordinates are used for field-specific weather.")}</p>
            <div className="form-inline"><label className="form-field" htmlFor="field-latitude">{t("Latitude")}<input id="field-latitude" className="form-input" type="number" min="-90" max="90" step="any" value={form.latitude} disabled={!online || saving} onChange={(event) => setFieldValue("latitude", event.target.value)} aria-invalid={Boolean(errors.latitude)} />{fieldError("latitude")}</label><label className="form-field" htmlFor="field-longitude">{t("Longitude")}<input id="field-longitude" className="form-input" type="number" min="-180" max="180" step="any" value={form.longitude} disabled={!online || saving} onChange={(event) => setFieldValue("longitude", event.target.value)} aria-invalid={Boolean(errors.longitude)} />{fieldError("longitude")}</label></div>
            {form.latitude && form.longitude && <label className="check-field"><input type="checkbox" checked={form.coordinatesConfirmed} disabled={!online || saving} onChange={(event) => setFieldValue("coordinatesConfirmed", event.target.checked)} />{t("I confirm these saved coordinates represent this field's actual location.")}</label>}{fieldError("coordinatesConfirmed")}
          </fieldset>
          <div className="form-sheet-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)} disabled={saving}>{t("Cancel")}</button><button className="primary-button" type="submit" disabled={!online || saving}>{saving ? t("Saving…") : t(editing ? "Save Changes" : "Save Field")}</button></div>
          {!online && <WriteAvailability online={online} />}
          {message && <p className="notice notice-error" role="alert">{message}{message.includes("Sign in again") && <> <Link href="/login">{t("Sign in")}</Link></>}</p>}
        </form>
      </section>
    </div>}
    {pendingDelete && <div className="form-sheet-backdrop"><section className="confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="delete-field-title"><h2 id="delete-field-title">{t("Delete field?")}</h2><p>{t("Are you sure you want to delete this field? This action cannot be undone.")}</p>{message && <p role="alert">{message}</p>}<div className="form-sheet-actions"><button className="secondary-button" type="button" onClick={() => setPendingDelete(null)} disabled={deleting}>{t("Cancel")}</button><button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={!online || deleting}>{deleting ? t("Deleting…") : t("Delete field")}</button></div><WriteAvailability online={online} /></section></div>}
  </AppShell>;
}

export function CropsManagement() {
  const { data, online, createCrop, updateCrop, deleteCrop } = useFarmData();
  const { t, formatDateTime } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FarmCrop | null>(null);
  const [form, setForm] = useState<CropForm>(emptyCrop);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FarmCrop | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!data) return <AppShell><LoadingState /></AppShell>;
  const savedFields = data.fields;

  function openForm(crop?: FarmCrop) {
    setEditing(crop ?? null);
    setForm(crop ? {
      name: crop.name,
      variety: crop.variety ?? "",
      field_id: crop.field_id == null ? "" : String(crop.field_id),
      growth_stage: crop.growth_stage ?? "",
      planting_date: crop.planting_date ?? "",
      expected_harvest_date: crop.expected_harvest_date ?? "",
    } : emptyCrop);
    setErrors({});
    setMessage("");
    setFormOpen(true);
  }

  function validateCrop(values: CropForm): Record<string, string> {
    const result: Record<string, string> = {};
    if (!values.name.trim()) result.name = t("Enter a crop name.");
    else if (values.name.length > 80) result.name = t("Use no more than {limit} characters.", { limit: 80 });
    if (values.variety.length > 100) result.variety = t("Use no more than {limit} characters.", { limit: 100 });
    if (values.growth_stage.length > 80) result.growth_stage = t("Use no more than {limit} characters.", { limit: 80 });
    if (values.planting_date && values.expected_harvest_date && values.expected_harvest_date < values.planting_date) {
      result.expected_harvest_date = t("Expected harvest date cannot be before planting date.");
    }
    if (values.field_id && !savedFields.some((field) => String(field.id) === values.field_id)) result.field_id = t("Choose a field from your account.");
    return result;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || saving) return;
    const invalid = validateCrop(form);
    setErrors(invalid);
    setMessage("");
    if (Object.keys(invalid).length) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        variety: form.variety.trim() || null,
        field_id: form.field_id ? Number(form.field_id) : null,
        growth_stage: form.growth_stage.trim() || null,
        planting_date: form.planting_date || null,
        expected_harvest_date: form.expected_harvest_date || null,
      };
      if (editing) await updateCrop(editing.id, payload);
      else await createCrop(payload);
      setMessage(t(editing ? "Crop updated." : "Crop added."));
      setFormOpen(false);
      setEditing(null);
    } catch (error) {
      setErrors((previous) => ({ ...previous, ...issueFields(error, t) }));
      setMessage(failureMessage(error, t));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || !online || deleting) return;
    setDeleting(true);
    setMessage("");
    try {
      await deleteCrop(pendingDelete.id);
      setMessage(t("Crop deleted."));
      setPendingDelete(null);
    } catch (error) {
      setMessage(failureMessage(error, t));
    } finally {
      setDeleting(false);
    }
  }

  const setCropValue = (key: keyof CropForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };
  const fieldError = (key: string) => errors[key] ? <span className="form-field-error" role="alert">{errors[key]}</span> : null;

  return <AppShell>
    <section className="page-title page-title-row"><div><p className="eyebrow">{t("YOUR FARM")}</p><h1>{t("My crops")}</h1><p className="muted">{t("Crop information saved to your JalSaathi account.")}</p></div><div className="management-heading-actions"><Link className="secondary-button" href="/fields">{t("Back to fields")}</Link><button className="primary-button compact-button" type="button" onClick={() => openForm()} disabled={!online}>{t("Add crop")}</button></div></section>
    <WriteAvailability online={online} />
    {message && <p className="notice" role="status">{message}{message.includes("Sign in again") && <> <Link href="/login">{t("Sign in")}</Link></>}</p>}
    {data.crops.length ? <div className="management-list">{data.crops.map((crop) => <article className="management-card crop-management-card" key={crop.id}>
      <h2>{crop.name}</h2><dl className="detail-list"><div><dt>{t("Variety")}</dt><dd>{crop.variety || t("Not provided")}</dd></div><div><dt>{t("Field")}</dt><dd>{data.fields.find((field) => field.id === crop.field_id)?.name ?? t("Not assigned")}</dd></div><div><dt>{t("Growth stage")}</dt><dd>{crop.growth_stage || t("Not provided")}</dd></div><div><dt>{t("Planting date")}</dt><dd>{crop.planting_date ? formatDateTime(`${crop.planting_date}T00:00:00`, { dateStyle: "medium" }) : t("Not provided")}</dd></div><div><dt>{t("Expected harvest date")}</dt><dd>{crop.expected_harvest_date ? formatDateTime(`${crop.expected_harvest_date}T00:00:00`, { dateStyle: "medium" }) : t("Not provided")}</dd></div></dl>
      <div className="management-card-actions"><button className="secondary-button" type="button" onClick={() => openForm(crop)} disabled={!online}>{t("Edit crop")}</button><button className="danger-button" type="button" onClick={() => setPendingDelete(crop)} disabled={!online}>{t("Delete crop")}</button></div>
    </article>)}</div> : <EmptyState title={t("No crops saved yet")}>{t("Add a crop to associate it with one of your fields.")}</EmptyState>}
    {formOpen && <div className="form-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}>
      <section className="form-sheet" role="dialog" aria-modal="true" aria-labelledby="crop-form-title">
        <div className="form-sheet-heading"><h2 id="crop-form-title">{t(editing ? "Edit crop" : "Add crop")}</h2><button className="icon-button" type="button" onClick={() => setFormOpen(false)} disabled={saving} aria-label={t("Close form")}>×</button></div>
        <form className="management-form" onSubmit={(event) => void submit(event)} noValidate>
          <label className="form-field" htmlFor="crop-name">{t("Crop name")}<input id="crop-name" className="form-input" value={form.name} maxLength={80} disabled={!online || saving} onChange={(event) => setCropValue("name", event.target.value)} aria-invalid={Boolean(errors.name)} />{fieldError("name")}</label>
          <label className="form-field" htmlFor="crop-variety">{t("Variety")}<input id="crop-variety" className="form-input" value={form.variety} maxLength={100} disabled={!online || saving} onChange={(event) => setCropValue("variety", event.target.value)} aria-invalid={Boolean(errors.variety)} />{fieldError("variety")}</label>
          <label className="form-field" htmlFor="crop-field">{t("Field")}<select id="crop-field" className="form-input" value={form.field_id} disabled={!online || saving} onChange={(event) => setCropValue("field_id", event.target.value)}><option value="">{t("No field selected")}</option>{data.fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>{fieldError("field_id")}</label>
          <label className="form-field" htmlFor="crop-growth-stage">{t("Growth stage")}<input id="crop-growth-stage" className="form-input" value={form.growth_stage} maxLength={80} disabled={!online || saving} onChange={(event) => setCropValue("growth_stage", event.target.value)} aria-invalid={Boolean(errors.growth_stage)} />{fieldError("growth_stage")}</label>
          <label className="form-field" htmlFor="crop-planting-date">{t("Planting date")}<input id="crop-planting-date" className="form-input" type="date" value={form.planting_date} disabled={!online || saving} onChange={(event) => setCropValue("planting_date", event.target.value)} aria-invalid={Boolean(errors.planting_date)} />{fieldError("planting_date")}</label>
          <label className="form-field" htmlFor="crop-harvest-date">{t("Expected harvest date")}<input id="crop-harvest-date" className="form-input" type="date" value={form.expected_harvest_date} disabled={!online || saving} onChange={(event) => setCropValue("expected_harvest_date", event.target.value)} aria-invalid={Boolean(errors.expected_harvest_date)} />{fieldError("expected_harvest_date")}</label>
          {message && <p className="notice notice-error" role="alert">{message}{message.includes("Sign in again") && <> <Link href="/login">{t("Sign in")}</Link></>}</p>}
          <div className="form-sheet-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)} disabled={saving}>{t("Cancel")}</button><button className="primary-button" type="submit" disabled={!online || saving}>{saving ? t("Saving…") : t(editing ? "Save Changes" : "Save Crop")}</button></div>
          <WriteAvailability online={online} />
        </form>
      </section>
    </div>}
    {pendingDelete && <div className="form-sheet-backdrop"><section className="confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="delete-crop-title"><h2 id="delete-crop-title">{t("Delete crop?")}</h2><p>{t("Are you sure you want to delete this crop? This action cannot be undone.")}</p><div className="form-sheet-actions"><button className="secondary-button" type="button" onClick={() => setPendingDelete(null)} disabled={deleting}>{t("Cancel")}</button><button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={!online || deleting}>{deleting ? t("Deleting…") : t("Delete crop")}</button></div><WriteAvailability online={online} /></section></div>}
  </AppShell>;
}
