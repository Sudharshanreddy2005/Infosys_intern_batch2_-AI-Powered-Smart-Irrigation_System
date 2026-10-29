import os
from pathlib import Path

from dotenv import load_dotenv
from sarvamai import SarvamAI


load_dotenv(Path(__file__).with_name(".env"))
api_key = os.getenv("SARVAM_API_KEY", "").strip()
if not api_key:
    raise SystemExit("Set SARVAM_API_KEY in the project .env file before running this script.")

client = SarvamAI(api_subscription_key=api_key)
response = client.chat.completions(
    model="sarvam-105b-conversations",
    messages=[{"role": "user", "content": "Say hello in one sentence."}],
)
print(response.choices[0].message.content)
