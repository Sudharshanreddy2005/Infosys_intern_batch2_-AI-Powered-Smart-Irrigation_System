
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
<<<<<<< HEAD
COPY templates/ ./templates/
COPY static/ ./static/
=======
COPY models.py schemas.py ./
COPY weather_api ./weather_api
COPY static ./static
COPY templates ./templates
>>>>>>> raashi-milestone1-backend-db

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
