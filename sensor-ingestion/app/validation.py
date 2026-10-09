def clean_sensor_data(data):
    data.soil_moisture = round(data.soil_moisture, 2)
    return data

#This function rounds the moisture reading to two decimal places. For example, 42.56789 becomes 42.57.
#The IDs are already cleaned by the validator in schemas.py