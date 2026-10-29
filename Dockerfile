
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py models.py schemas.py farmer_assistant.py sarvam_translation.py ./
COPY backend/models/model1/ ./backend/models/model1/
COPY weather_api/ ./weather_api/
COPY irrigation_optimizer/ ./irrigation_optimizer/
COPY templates/ ./templates/
COPY static/ ./static/

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
