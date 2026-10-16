
import random
from datetime import datetime

import requests

API_URL = "http://127.0.0.1:8000/sensor-data"


sensor_data = {
    "sensor_id": "SM_001",
    "field_id": "FIELD_001",
    "soil_moisture": round(random.uniform(20, 80), 2),
    "timestamp": datetime.now().isoformat(),
}


print("Sending sensor data:")
print(sensor_data)

try:
    response = requests.post(
        API_URL,
        json=sensor_data,
        timeout=10,
    )

    print("\nAPI response status:", response.status_code)
    print(response.json())

except requests.RequestException as error:
    print("Could not connect to the API:", error)
    
#The simulator generates one random moisture reading between 20 and 80 and sends it to the API. 
#It uses simulated data, so you do not need a physical sensor.