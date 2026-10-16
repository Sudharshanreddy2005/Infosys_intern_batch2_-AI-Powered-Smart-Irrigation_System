from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.engine import URL


# Read the database password from the existing .env file
env_path = Path(".env")

if not env_path.exists():
    raise FileNotFoundError(
        "The .env file was not found. Make sure you run this script "
        "from your project folder."
    )

password_line = next(
    (
        line for line in env_path.read_text().splitlines()
        if line.startswith("DB_PASSWORD=")
    ),
    None,
)

if password_line is None:
    raise ValueError("DB_PASSWORD was not found in the .env file.")

db_password = password_line.split("=", 1)[1].strip()

# Connect to the PostgreSQL container through your Windows computer
database_url = URL.create(
    drivername="postgresql+psycopg",
    username="irrigation_user",
    password=db_password,
    host="localhost",
    port=5433,
    database="smart_irrigation_db",
)

engine = create_engine(database_url)

# Read the original dataset without removing or renaming columns
csv_path = Path("data") / "cleaned_dataset.csv"

if not csv_path.exists():
    raise FileNotFoundError(
        "Dataset not found at data/cleaned_dataset.csv"
    )

df = pd.read_csv(csv_path)

# Convert the timestamp column to a timezone-aware datetime
df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

print(f"Dataset rows: {len(df)}")
print(f"Dataset columns: {len(df.columns)}")
print("Loading dataset into PostgreSQL...")

# Create the table and insert all records
df.to_sql(
    name="sensor_readings",
    con=engine,
    if_exists="fail",
    index=False,
    chunksize=1000,
)

print("Dataset loaded successfully!")
print("Table name: sensor_readings")
print(f"Rows inserted: {len(df)}")
print(f"Columns stored: {len(df.columns)}")

engine.dispose()