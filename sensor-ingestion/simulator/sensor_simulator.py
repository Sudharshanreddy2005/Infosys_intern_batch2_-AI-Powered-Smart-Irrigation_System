import os
import random
from datetime import datetime, timezone

import requests


def main() -> int:
    sensor_id = os.getenv("SENSOR_ID", "").strip()
    field_id = os.getenv("SENSOR_FIELD_ID", "").strip()
    sensor_token = os.getenv("SENSOR_TOKEN", "")
    if not sensor_id or not field_id.isdigit() or not sensor_token:
        raise RuntimeError(
            "Set SENSOR_ID, SENSOR_FIELD_ID, and SENSOR_TOKEN for a registered device."
        )

    api_url = os.getenv("SENSOR_API_URL", "http://127.0.0.1:8003").rstrip("/")
    payload = {
        "sensor_id": sensor_id,
        "field_id": int(field_id),
        "soil_moisture": round(random.uniform(20, 80), 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    response = requests.post(
        f"{api_url}/sensor-data",
        json=payload,
        headers={"X-Sensor-Token": sensor_token},
        timeout=10,
    )
    response.raise_for_status()
    print({"status_code": response.status_code, "response": response.json()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
