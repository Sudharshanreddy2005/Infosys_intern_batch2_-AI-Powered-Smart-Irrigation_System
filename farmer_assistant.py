import json
import os

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    OpenAIError,
    RateLimitError,
)

ASSISTANT_INSTRUCTIONS = """
You are JalSaathi's educational farming assistant. Give concise, practical,
general information about crops, weather, and water management. Do not claim to
know a farmer's field, current weather, sensor readings, or crop records unless
they are explicitly provided in this conversation. Do not invent irrigation
quantities, schedules, measurements, or Model 2 predictions. Do not present
general guidance as a field-specific recommendation, and never imply that you
control irrigation equipment. Encourage local agronomic advice when a decision
depends on crop stage, soil, climate, or measured field conditions.
""".strip()

MODEL2_EXPLANATION_INSTRUCTIONS = """
Explain the server-provided Model 2 result and its documented limitations in
plain language. Do not generate, revise, estimate, or restate its water quantity.
Do not treat it as an irrigation instruction, claim independent real-world
validation, or add field facts not included in the server-provided result. The
exact result is returned separately by the application and must remain the
authoritative value.
""".strip()


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


async def _request_response(input_text: str, instructions: str) -> str:
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
        async with AsyncOpenAI(
            api_key=api_key,
            timeout=20.0,
            max_retries=0,
        ) as client:
            response = await client.responses.create(
                model=model,
                instructions=instructions,
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


async def answer_farmer_question(question: str) -> str:
    return await _request_response(question, ASSISTANT_INSTRUCTIONS)


async def explain_model2_prediction(
    question: str,
    trusted_prediction: dict,
) -> str:
    input_text = (
        f"Farmer's explanation request:\n{question}\n\n"
        "Server-provided Model 2 prediction metadata:\n"
        f"{json.dumps(trusted_prediction, allow_nan=False, sort_keys=True)}"
    )
    return await _request_response(input_text, MODEL2_EXPLANATION_INSTRUCTIONS)
