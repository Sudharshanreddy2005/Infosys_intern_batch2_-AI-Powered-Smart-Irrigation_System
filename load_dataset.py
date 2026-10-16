import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import URL

PROJECT_ROOT = Path(__file__).resolve().parent
load_dotenv(PROJECT_ROOT / ".env")

db_password = os.getenv("DB_PASSWORD")
if not db_password:
    raise ValueError("DB_PASSWORD is not configured in the environment or .env file.")

csv_path = PROJECT_ROOT / "data" / "cleaned_dataset.csv"
if not csv_path.is_file():
    raise FileNotFoundError(f"Dataset not found at {csv_path}")

df = pd.read_csv(csv_path)
if "timestamp" not in df.columns:
    raise ValueError("Dataset does not contain the required timestamp column.")
df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

database_url = URL.create(
    drivername="postgresql+psycopg",
    username=os.getenv("DB_USER", "irrigation_user"),
    password=db_password,
    host=os.getenv("DB_HOST", "localhost"),
    port=int(os.getenv("DB_PORT", "5433")),
    database=os.getenv("DB_NAME", "smart_irrigation_db"),
)
engine = create_engine(database_url, pool_pre_ping=True)

try:
    with engine.begin() as connection:
        if inspect(connection).has_table("sensor_readings"):
            raise RuntimeError(
                "sensor_readings already exists; refusing to import duplicates. "
                "Back up and review the existing table before any replacement."
            )
        df.to_sql(
            name="sensor_readings",
            con=connection,
            if_exists="fail",
            index=False,
            chunksize=1000,
        )
finally:
    engine.dispose()

print(f"Imported {len(df)} historical records into sensor_readings.")
