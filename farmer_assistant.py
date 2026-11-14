import contextvars
import json
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import inspect, select, text
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    OpenAIError,
    RateLimitError,
)
from models import FarmerCrop, FarmerField, IrrigationSchedule
from model1.inference import load_artifact_bundle, predict_records as predict_model1_records
from model2_integration import load_production_model2_bundle
from weather_api.integrations.weather_api import get_current_weather, get_forecast
from schemas import AssistantLanguageCode

assistant_request_context: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "assistant_request_context",
    default=None,
)

ASSISTANT_INSTRUCTIONS = """
You are JalSaathi's educational farming assistant. Give concise, practical,
general information about crops, weather, and water management. Use the
authenticated farmer context only when it is explicitly available in the current
request. Distinguish verified field facts from general guidance, and clearly label
measured values, model outputs, and missing information. Do not invent irrigation
quantities, schedules, measurements, or Model 2 or Model 4 predictions. When a
model is unavailable or data is missing, say so and provide the next best safe
advice. Do not present general guidance as a field-specific recommendation, and
never imply that you control irrigation equipment. Encourage local agronomic
advice when a decision depends on crop stage, soil, climate, or measured field
conditions.
""".strip()

MODEL2_EXPLANATION_INSTRUCTIONS = """
Explain the server-provided Model 2 result and its documented limitations in
plain language. Do not generate, revise, estimate, or restate its water quantity.
Do not treat it as an irrigation instruction, claim independent real-world
validation, or add field facts not included in the server-provided result. The
exact result is returned separately by the application and must remain the
authoritative value.
""".strip()


def set_assistant_request_context(db, farmer_id: int, farmer=None) -> None:
    assistant_request_context.set({
        "db": db,
        "farmer_id": farmer_id,
        "farmer": farmer,
    })


def clear_assistant_request_context() -> None:
    assistant_request_context.set(None)


SEASON_GUIDANCE = {
    "kharif": "Kharif crops are usually sown with monsoon onset in June–October and need warm, wet conditions.",
    "rabi": "Rabi crops are typically grown in the cooler months of November–February and benefit from lower temperatures.",
    "zaid": "Zaid crops are usually grown in the warm summer period around March–May and need careful water management.",
}


def _infer_relevant_context(question: str | None) -> set[str]:
    normalized = (question or "").lower()
    relevant = {"field", "crop", "weather", "sensor", "irrigation", "stress", "season"}
    keywords = {
        "field": ["field", "plot", "land", "acre", "hectare"],
        "crop": ["crop", "plant", "harvest", "growth stage", "variety", "stage"],
        "weather": ["weather", "rain", "rainfall", "temperature", "humidity", "forecast", "cloud", "storm"],
        "sensor": ["soil", "moisture", "sensor", "reading", "wetness", "dryness"],
        "irrigation": ["irrigation", "water", "schedule", "watering", "drip", "canal", "reservoir"],
        "stress": ["stress", "healthy", "crop health", "wilting", "disease", "vigor"],
        "season": ["season", "kharif", "rabi", "zaid", "sowing", "planting", "best time", "suitable crop"],
    }
    for category, values in keywords.items():
        if any(token in normalized for token in values):
            relevant.add(category)
    return relevant


def _model_status_notes(question: str | None) -> list[str]:
    normalized = (question or "").lower()
    notes: list[str] = []
    if any(token in normalized for token in ["water requirement", "water need", "water required", "irrigation requirement", "how much water"]):
        try:
            load_production_model2_bundle()
            note = "Water requirement: Model 2 bundle is available, but the app still requires validated field inputs before it can generate a real estimate."
        except Exception:
            note = "Water requirement: Model 2 is fail-closed in this app because the validated production artifact and required measured rainfall/soil inputs are not available for a field-specific estimate."
        notes.append(note)
    if any(token in normalized for token in ["future soil moisture", "soil moisture forecast", "24h moisture", "moisture prediction", "dryness forecast"]):
        notes.append(
            "Future soil moisture: Model 3 exists, but it requires zone/weather/soil inputs that are not all stored for the farmer's fields; no field-specific future moisture prediction is generated here."
        )
    if any(token in normalized for token in ["crop stress", "stress", "wilting", "crop health", "heat stress", "water stress"]):
        notes.append(
            "Crop stress: Model 4 is available only when the app has all 20 soil/nutrient/plant-category inputs; the current farmer field schema does not store those values, so no field-specific stress prediction is generated here."
        )
    if any(token in normalized for token in ["weather-based irrigation", "weather prediction", "irrigation prediction", "rainfall forecast", "humidity forecast"]):
        notes.append(
            "Weather-based irrigation proxy: Model 1's reduced-weather proxy is available only when fresh field temperature and humidity are available and within the model's training range."
        )
    if any(token in normalized for token in ["kharif", "rabi", "zaid", "sowing", "planting", "season", "suitable crop", "best season"]):
        notes.extend(
            [
                f"Seasonal guidance: {SEASON_GUIDANCE['kharif']}",
                f"Seasonal guidance: {SEASON_GUIDANCE['rabi']}",
                f"Seasonal guidance: {SEASON_GUIDANCE['zaid']}",
            ]
        )
    return notes


def _weather_note_for_field(field) -> str:
    if field.latitude is None or field.longitude is None:
        return "; weather unavailable (no coordinates saved)"
    location = f"{field.latitude:.6f},{field.longitude:.6f}"
    try:
        current = get_current_weather(location)
        temp = current.get("temperature_c")
        humidity = current.get("humidity_percent")
        forecast = get_forecast(location, hours=12, timestep="1h")
        forecast_note = ""
        if isinstance(forecast, list) and forecast:
            next_period = forecast[0]
            next_temp = next_period.get("temperature_c")
            rain_prob = next_period.get("precipitation_probability_percent")
            if next_temp is not None or rain_prob is not None:
                forecast_note = (
                    f"; next 12h forecast: temp={next_temp if next_temp is not None else 'unknown'}°C, "
                    f"rain_prob={rain_prob if rain_prob is not None else 'unknown'}%"
                )
        if temp is None and humidity is None:
            return f"; current weather unavailable{forecast_note}"
        if temp is None:
            temp = "unknown"
        if humidity is None:
            humidity = "unknown"
        proxy_note = ""
        try:
            bundle = load_artifact_bundle(
                Path(__file__).resolve().parent / "model1" / "artifacts" / "reduced_weather_proxy_v1.joblib"
            )
            proxy = predict_model1_records(
                bundle,
                [{"temperature_c": float(temp), "humidity_percent": float(humidity)}],
            )[0]
            proxy_note = (
                "; Model 1 weather proxy: "
                f"prediction={proxy.get('prediction')}, "
                f"probability={proxy.get('proxy_positive_probability')}"
            )
        except Exception:
            proxy_note = "; Model 1 weather proxy unavailable"
        return (
            f"; current weather: {temp}°C, humidity {humidity}%, "
            f"stale={current.get('is_stale')}, age={current.get('data_age_minutes')} min"
            f"{proxy_note}{forecast_note}"
        )
    except Exception:
        return "; current weather unavailable"


def _sensor_summary_for_field(db, field_id: int, farmer_field_ids: set[int]) -> str:
    try:
        inspector = inspect(db.bind)
        if not inspector.has_table("sensor_readings"):
            return "sensor data unavailable"
        columns = [column["name"] for column in inspector.get_columns("sensor_readings")]
        if not columns or "field_id" not in columns:
            return "sensor data unavailable"
        order_column = "recorded_at" if "recorded_at" in columns else "timestamp" if "timestamp" in columns else None
        if order_column is None:
            return "sensor data unavailable"
        metric_names = [
            name for name in ("soil_moisture", "soil_moisture_percent", "moisture_percent", "moisture", "temperature_c", "temperature", "humidity_percent", "humidity")
            if name in columns
        ]
        if not metric_names:
            return "sensor data unavailable"
        summaries = []
        for field in sorted(farmer_field_ids):
            selected = ["field_id", order_column] + metric_names
            selector = ", ".join(selected)
            rows = db.execute(
                text(
                    f"SELECT {selector} FROM sensor_readings "
                    "WHERE field_id = :field_id "
                    f"ORDER BY {order_column} DESC LIMIT 5"
                ),
                {"field_id": field},
            ).fetchall()
            for row in rows:
                values = {column: row[index] for index, column in enumerate(selected)}
                metric_text = ", ".join(
                    f"{metric}={values.get(metric)}" for metric in metric_names if values.get(metric) is not None
                ) or "no measurements"
                summaries.append(
                    f"field_id={values.get('field_id')}, {metric_text}, at={values.get(order_column)}"
                )
        if not summaries:
            return "no recent sensor values for your fields"
        return "; ".join(summaries[:10])
    except Exception:
        return "sensor data unavailable"


def _summarize_farmer_data(db, farmer_id: int, question: str | None = None) -> str:
    if db is None or farmer_id is None:
        return ""

    field_rows = list(
        db.scalars(
            select(FarmerField).where(FarmerField.farmer_id == farmer_id).order_by(FarmerField.id)
        ).all()
    )
    crop_rows = list(
        db.scalars(
            select(FarmerCrop).where(FarmerCrop.farmer_id == farmer_id).order_by(FarmerCrop.id)
        ).all()
    )
    schedule_rows = list(
        db.scalars(
            select(IrrigationSchedule)
            .where(IrrigationSchedule.farmer_id == farmer_id)
            .order_by(IrrigationSchedule.scheduled_date.desc(), IrrigationSchedule.id.desc())
            .limit(10)
        ).all()
    )
    relevant_topics = _infer_relevant_context(question)
    farmer_field_ids = {field.id for field in field_rows}
    model_notes = _model_status_notes(question)

    field_lines = []
    for field in field_rows:
        crop_name = next(
            (crop.name for crop in crop_rows if crop.field_id == field.id),
            field.crop,
        )
        weather_note = _weather_note_for_field(field) if "weather" in relevant_topics else "; weather not requested"
        field_lines.append(
            f"- Field '{field.name}' ({field.area} {field.area_unit})"
            f" at {field.location or 'location not saved'}"
            f"; crop: {crop_name or 'not set'}{weather_note}"
        )

    if not field_lines:
        field_lines.append("- No registered fields yet.")

    crop_lines = []
    for crop in crop_rows:
        crop_lines.append(
            f"- Crop '{crop.name}' on field_id={crop.field_id or 'unassigned'}; "
            f"stage={crop.growth_stage or 'not set'}; planted={crop.planting_date or 'unknown'}; "
            f"harvest={crop.expected_harvest_date or 'unknown'}"
        )
    if not crop_lines:
        crop_lines.append("- No crop records yet.")

    schedule_lines = []
    for schedule in schedule_rows:
        schedule_lines.append(
            f"- Schedule {schedule.id}: field_id={schedule.field_id}, {schedule.crop_name}, "
            f"{schedule.status}, {schedule.scheduled_date}, water={schedule.water_liters} L, "
            f"duration={schedule.duration_minutes} min"
        )
    if not schedule_lines:
        schedule_lines.append("- No irrigation schedules yet.")

    sensor_summary = _sensor_summary_for_field(db, None, farmer_field_ids) if "sensor" in relevant_topics else "sensor data not requested"

    context_lines = [
        "Farmer context summary:\n",
        f"- Farmer ID: {farmer_id}\n",
        f"- Registered field count: {len(field_rows)}\n",
        *field_lines,
        "\nCrop records:\n",
        *crop_lines,
        "\nRecent irrigation schedules:\n",
        *schedule_lines,
        f"\nSensor status: {sensor_summary}\n",
    ]
    if model_notes:
        context_lines.extend(["\nModel status:\n", *[f"- {note}\n" for note in model_notes]])
    context_lines.append(
        "Use this information as the current farmer context and answer only with facts from it."
    )
    return "".join(context_lines)


ASSISTANT_LANGUAGE_NAMES = {
    "en-IN": "English",
    "te-IN": "Telugu",
    "hi-IN": "Hindi",
    "kn-IN": "Kannada",
    "ta-IN": "Tamil",
    "ml-IN": "Malayalam",
}


class AssistantServiceError(Exception):
    def __init__(
        self,
        status_code: int,
        detail: str,
        *,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.retry_after = retry_after


async def _request_response(
    input_text: str,
    instructions: str,
    language_code: AssistantLanguageCode,
) -> str:
    if not isinstance(input_text, str):
        raise AssistantServiceError(400, "The question must be submitted as plain text.")
    input_text = input_text.strip()
    if not input_text:
        raise AssistantServiceError(400, "Enter a question.")
    if len(input_text) > 5000:
        raise AssistantServiceError(400, "The question exceeds the allowed length.")

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise AssistantServiceError(
            503,
            "The farmer assistant is unavailable because its server configuration is incomplete.",
        )

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip()
    if not model or len(model) > 100:
        raise AssistantServiceError(
            503,
            "The farmer assistant is unavailable because its server configuration is invalid.",
        )

    try:
        language_name = ASSISTANT_LANGUAGE_NAMES[language_code]
    except KeyError as error:
        raise AssistantServiceError(
            400,
            "The selected language is not available for the farmer assistant.",
        ) from error
    localized_instructions = (
        f"{instructions}\n\n"
        f"Respond entirely in natural, farmer-friendly {language_name}. "
        "Keep product names and technical identifiers unchanged. Preserve all "
        "provided numbers, measurements, units, and sensor values exactly; "
        "never invent or alter them."
    )
    try:
        async with AsyncOpenAI(
            api_key=api_key,
            timeout=20.0,
            max_retries=0,
        ) as client:
            response = await client.responses.create(
                model=model,
                instructions=localized_instructions,
                input=input_text,
                max_output_tokens=500,
            )
    except AuthenticationError as error:
        raise AssistantServiceError(
            503,
            "The farmer assistant is unavailable because the provider configuration was rejected.",
        ) from error
    except RateLimitError as error:
        raise AssistantServiceError(
            429,
            "The farmer assistant is temporarily busy. Please try again later.",
            retry_after=30,
        ) from error
    except APITimeoutError as error:
        raise AssistantServiceError(
            504,
            "The farmer assistant did not respond in time. Please try again.",
        ) from error
    except APIConnectionError as error:
        raise AssistantServiceError(
            503,
            "The farmer assistant provider is currently unreachable.",
        ) from error
    except APIStatusError as error:
        raise AssistantServiceError(
            502,
            "The farmer assistant provider could not complete the request.",
        ) from error
    except OpenAIError as error:
        raise AssistantServiceError(
            502,
            "The farmer assistant provider could not complete the request.",
        ) from error

    answer = response.output_text
    if not isinstance(answer, str) or not answer.strip():
        raise AssistantServiceError(
            502,
            "The farmer assistant returned an empty response. Please try again.",
        )
    return answer.strip()


async def answer_farmer_question(
    question: str,
    language_code: AssistantLanguageCode = "en-IN",
) -> str:
    if not isinstance(question, str):
        raise AssistantServiceError(400, "The question must be submitted as plain text.")
    normalized_question = question.strip()
    if not normalized_question:
        raise AssistantServiceError(400, "Enter a question.")
    if len(normalized_question) > 1500:
        raise AssistantServiceError(400, "The question exceeds the allowed length.")
    try:
        ASSISTANT_LANGUAGE_NAMES[language_code]
    except KeyError as error:
        raise AssistantServiceError(
            400,
            "The selected language is not available for the farmer assistant.",
        ) from error

    context = assistant_request_context.get()
    final_question = normalized_question
    if context:
        farmer_data = _summarize_farmer_data(
            context.get("db"),
            context.get("farmer_id"),
            normalized_question,
        )
        if farmer_data:
            final_question = f"{farmer_data}\n\nFarmer question:\n{normalized_question}"

    return await _request_response(final_question, ASSISTANT_INSTRUCTIONS, language_code)


async def explain_model2_prediction(
    question: str,
    trusted_prediction: dict,
    language_code: AssistantLanguageCode = "en-IN",
) -> str:
    if not isinstance(question, str):
        raise AssistantServiceError(400, "The question must be submitted as plain text.")
    normalized_question = question.strip()
    if not normalized_question:
        raise AssistantServiceError(400, "Enter a question.")
    if len(normalized_question) > 1500:
        raise AssistantServiceError(400, "The question exceeds the allowed length.")
    if not isinstance(trusted_prediction, dict):
        raise AssistantServiceError(
            400,
            "The Model 2 prediction metadata is incomplete.",
        )
    try:
        ASSISTANT_LANGUAGE_NAMES[language_code]
    except KeyError as error:
        raise AssistantServiceError(
            400,
            "The selected language is not available for the farmer assistant.",
        ) from error
    input_text = (
        f"Farmer's explanation request:\n{normalized_question}\n\n"
        "Server-provided Model 2 prediction metadata:\n"
        f"{json.dumps(trusted_prediction, allow_nan=False, sort_keys=True)}"
    )
    return await _request_response(
        input_text,
        MODEL2_EXPLANATION_INSTRUCTIONS,
        language_code,
    )
