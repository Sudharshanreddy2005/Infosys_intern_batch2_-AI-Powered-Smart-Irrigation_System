
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py models.py schemas.py farmer_assistant.py sarvam_translation.py model2_integration.py ./
COPY model1/ ./model1/
COPY irrigation_optimizer/ ./irrigation_optimizer/
COPY weather_api/ ./weather_api/
COPY model2/ ./model2/
COPY model3/ ./model3/
COPY model4/ ./model4/
COPY templates/ ./templates/
COPY static/ ./static/

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
