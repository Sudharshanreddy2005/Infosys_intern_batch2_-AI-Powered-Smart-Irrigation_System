
# Sensor Data Ingestion

This module receives and validates soil moisture sensor data
for the AI-Powered Smart Irrigation System.

## Features

- REST API for soil moisture readings
- Sensor and field ID validation
- Soil moisture range validation
- Data cleaning and decimal rounding
- Sample sensor data simulator
- Automated API tests

## Requirements

Install dependencies using:

    python -m pip install -r requirements.txt

## Run the API

From the sensor-ingestion folder, activate the virtual
environment and run:

    python -m uvicorn app.main:app --reload

## API documentation

Open http://127.0.0.1:8000/docs

## Run the sensor simulator

Open a second terminal in the sensor-ingestion folder,
activate the virtual environment, and run:

    python simulator/sensor_simulator.py

## Run automated tests

From the sensor-ingestion folder, run:

    python -m pytest -v

## Notes

This initial version does not store sensor readings in a database.
