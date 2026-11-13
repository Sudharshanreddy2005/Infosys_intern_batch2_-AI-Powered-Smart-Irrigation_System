from datetime import date, datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    Boolean,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Farmer(Base):
    __tablename__ = "farmers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))
    state: Mapped[str | None] = mapped_column(String(80))
    district: Mapped[str | None] = mapped_column(String(100))
    village: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class FarmerField(Base):
    __tablename__ = "farmer_fields"
    __table_args__ = (Index("ix_farmer_fields_owner_name", "farmer_id", "name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    crop: Mapped[str | None] = mapped_column(String(80))
    area: Mapped[float] = mapped_column(Float, nullable=False)
    area_unit: Mapped[str] = mapped_column(String(16), nullable=False)
    location: Mapped[str | None] = mapped_column(String(200))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

class FarmerSensorReading(Base):
    __tablename__ = "farmer_sensor_readings"
    __table_args__ = (
        CheckConstraint(
            "soil_moisture_percent >= 0 AND soil_moisture_percent <= 100",
            name="ck_farmer_sensor_moisture_range",
        ),
        CheckConstraint(
            "humidity_percent IS NULL OR "
            "(humidity_percent >= 0 AND humidity_percent <= 100)",
            name="ck_farmer_sensor_humidity_range",
        ),
        CheckConstraint(
            "ph IS NULL OR (ph >= 0 AND ph <= 14)",
            name="ck_farmer_sensor_ph_range",
        ),
        CheckConstraint(
            "electrical_conductivity_us_cm IS NULL OR "
            "electrical_conductivity_us_cm >= 0",
            name="ck_farmer_sensor_ec_nonnegative",
        ),
        Index(
            "ix_farmer_sensor_readings_owner_field_time",
            "farmer_id",
            "field_id",
            "recorded_at",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_id: Mapped[int] = mapped_column(
        ForeignKey("farmer_fields.id", ondelete="CASCADE"),
        nullable=False,
    )

    soil_moisture_percent: Mapped[float] = mapped_column(
        Float, nullable=False
    )
    soil_temperature_c: Mapped[float | None] = mapped_column(Float)
    humidity_percent: Mapped[float | None] = mapped_column(Float)
    ph: Mapped[float | None] = mapped_column(Float)

    # Electrical conductivity is stored in microsiemens per centimetre.
    electrical_conductivity_us_cm: Mapped[float | None] = mapped_column(Float)

    # Time the measurement was taken, and time it was saved by the server.
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

class FarmerSensorDevice(Base):
    __tablename__ = "farmer_sensor_devices"
    __table_args__ = (
        UniqueConstraint(
            "field_id",
            name="uq_farmer_sensor_device_field",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    field_id: Mapped[int] = mapped_column(
        ForeignKey("farmer_fields.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    device_id: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        unique=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
    )


class FarmerCrop(Base):
    __tablename__ = "farmer_crops"
    __table_args__ = (Index("ix_farmer_crops_owner_field", "farmer_id", "field_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_id: Mapped[int | None] = mapped_column(
        ForeignKey("farmer_fields.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    variety: Mapped[str | None] = mapped_column(String(100))
    planting_date: Mapped[date | None] = mapped_column(Date)
    expected_harvest_date: Mapped[date | None] = mapped_column(Date)
    growth_stage: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class IrrigationReservoir(Base):
    __tablename__ = "irrigation_reservoirs"
    __table_args__ = (
        CheckConstraint("capacity_liters > 0", name="ck_irrigation_reservoir_capacity_positive"),
        CheckConstraint("available_liters >= 0", name="ck_irrigation_reservoir_available_nonnegative"),
        CheckConstraint("available_liters <= capacity_liters", name="ck_irrigation_reservoir_within_capacity"),
        CheckConstraint("reserved_liters >= 0", name="ck_irrigation_reservoir_reserved_nonnegative"),
        CheckConstraint("reserved_liters <= available_liters", name="ck_irrigation_reservoir_reserved_within_available"),
        Index("ix_irrigation_reservoir_owner_field", "farmer_id", "field_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_id: Mapped[int | None] = mapped_column(
        ForeignKey("farmer_fields.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    capacity_liters: Mapped[float] = mapped_column(Float, nullable=False)
    available_liters: Mapped[float] = mapped_column(Float, nullable=False)
    reserved_liters: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class IrrigationSchedule(Base):
    __tablename__ = "irrigation_schedules"
    __table_args__ = (
        CheckConstraint(
            "status IN ('recommended', 'insufficient_water', 'confirmed', 'completed', 'cancelled')",
            name="ck_irrigation_schedule_status",
        ),
        CheckConstraint("water_liters >= 0", name="ck_irrigation_schedule_water_nonnegative"),
        CheckConstraint("duration_minutes >= 0", name="ck_irrigation_schedule_duration_nonnegative"),
        Index("ix_irrigation_schedule_owner_field", "farmer_id", "field_id"),
        Index("ix_irrigation_schedule_reservoir_status", "reservoir_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_id: Mapped[int] = mapped_column(
        ForeignKey("farmer_fields.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reservoir_id: Mapped[int] = mapped_column(
        ForeignKey("irrigation_reservoirs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_name: Mapped[str] = mapped_column(String(100), nullable=False)
    crop_name: Mapped[str] = mapped_column(String(80), nullable=False)
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[str | None] = mapped_column(String(5))
    end_time: Mapped[str | None] = mapped_column(String(5))
    water_liters: Mapped[float] = mapped_column(Float, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    irrigation_method: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    plan_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
