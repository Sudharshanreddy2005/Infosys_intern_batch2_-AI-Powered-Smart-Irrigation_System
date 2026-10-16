
from fastapi import FastAPI

from app.schemas import SensorData
from app.validation import clean_sensor_data

app = FastAPI(
    title="Smart Irrigation Sensor Data API",
    version="1.0.0",
)


@app.get("/")
def home():
    return {
        "message": "Sensor Data Ingestion API is running"
    }


@app.post("/sensor-data")
def receive_sensor_data(data: SensorData):
    cleaned_data = clean_sensor_data(data)

    return {
        "status": "success",
        "message": "Sensor data received successfully",
        "data": cleaned_data,
    }
    
#This is main API. It provides two endpoints:
#Endpoint and Purpose
#GET /Checks whether the API is running
#POST /sensor-data Receives, validates and cleans sensor data