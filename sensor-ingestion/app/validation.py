def clean_sensor_data(data):
    return data.model_copy(update={"soil_moisture": round(data.soil_moisture, 2)})