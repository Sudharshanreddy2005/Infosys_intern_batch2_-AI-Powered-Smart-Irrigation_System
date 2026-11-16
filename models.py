from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    Text,
    text,
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
    web_push_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    sms_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
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
    __table_args__ = (
        Index("ix_farmer_fields_owner_name", "farmer_id", "name"),
        UniqueConstraint("id", "farmer_id", name="uq_farmer_fields_id_owner"),
    )

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
        ForeignKeyConstraint(
            ["field_id", "farmer_id"],
            ["farmer_fields.id", "farmer_fields.farmer_id"],
            ondelete="CASCADE",
            name="fk_farmer_sensor_readings_owned_field",
        ),
        CheckConstraint(
            "soil_moisture_percent IS NOT NULL "
            "OR soil_temperature_c IS NOT NULL "
            "OR humidity_percent IS NOT NULL "
            "OR ph IS NOT NULL "
            "OR electrical_conductivity_us_cm IS NOT NULL",
            name="ck_farmer_sensor_readings_has_measurement",
        ),
        CheckConstraint(
            "soil_moisture_percent IS NULL OR "
            "(soil_moisture_percent >= 0 AND soil_moisture_percent <= 100)",
            name="ck_farmer_sensor_readings_moisture_range",
        ),
        CheckConstraint(
            "humidity_percent IS NULL OR "
            "(humidity_percent >= 0 AND humidity_percent <= 100)",
            name="ck_farmer_sensor_readings_humidity_range",
        ),
        CheckConstraint(
            "soil_temperature_c IS NULL OR "
            "(soil_temperature_c >= -50 AND soil_temperature_c <= 100)",
            name="ck_farmer_sensor_readings_temperature_range",
        ),
        CheckConstraint(
            "ph IS NULL OR (ph >= 0 AND ph <= 14)",
            name="ck_farmer_sensor_readings_ph_range",
        ),
        CheckConstraint(
            "electrical_conductivity_us_cm IS NULL OR "
            "electrical_conductivity_us_cm >= 0",
            name="ck_farmer_sensor_readings_ec_nonnegative",
        ),
        CheckConstraint(
            "source IN ('sensor', 'farmer_entered', 'test_fixture')",
            name="ck_farmer_sensor_readings_source",
        ),
        Index(
            "ix_farmer_sensor_readings_owner_field_time",
            "farmer_id",
            "field_id",
            "recorded_at",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(Integer, nullable=False)
    field_id: Mapped[int] = mapped_column(Integer, nullable=False)

    soil_moisture_percent: Mapped[float | None] = mapped_column(Float)
    soil_temperature_c: Mapped[float | None] = mapped_column(Float)
    humidity_percent: Mapped[float | None] = mapped_column(Float)
    ph: Mapped[float | None] = mapped_column(Float)
    electrical_conductivity_us_cm: Mapped[float | None] = mapped_column(Float)

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    source: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default="sensor",
    )

    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    created_at: Mapped[datetime] = mapped_column(
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

    name: Mapped[str] = mapped_column(String(100), nullable=False)

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


class AssistantConversation(Base):
    __tablename__ = "assistant_conversations"
    __table_args__ = (
        Index("ix_assistant_conversations_owner_updated", "farmer_id", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_id: Mapped[int | None] = mapped_column(
        ForeignKey("farmer_fields.id", ondelete="SET NULL"), nullable=True, index=True
    )
    crop_id: Mapped[int | None] = mapped_column(
        ForeignKey("farmer_crops.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    messages: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class DailyFarmTask(Base):
    __tablename__ = "daily_farm_tasks"
    __table_args__ = (
        Index("ix_daily_farm_tasks_owner_status", "farmer_id", "completed_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    field_name: Mapped[str | None] = mapped_column(String(100))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class DailyFarmReminderSetting(Base):
    __tablename__ = "daily_farm_reminder_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    interval_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=2, server_default="2")
    custom_interval_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_notification_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class FarmNotificationSubscription(Base):
    __tablename__ = "farm_notification_subscriptions"
    __table_args__ = (
        Index(
            "uq_farm_notification_active_endpoint",
            "endpoint",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
            sqlite_where=text("revoked_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    endpoint: Mapped[str] = mapped_column(String(500), nullable=False)
    p256dh: Mapped[str | None] = mapped_column(String(255))
    auth: Mapped[str | None] = mapped_column(String(255))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["field_id", "farmer_id"],
            ["farmer_fields.id", "farmer_fields.farmer_id"],
            ondelete="CASCADE",
            name="fk_alerts_owned_field",
        ),
        CheckConstraint(
            "severity IN ('low', 'medium', 'high')",
            name="ck_alerts_severity",
        ),
        CheckConstraint(
            "status IN ('unresolved', 'resolved')",
            name="ck_alerts_status",
        ),
        Index(
            "uq_alerts_unresolved_field_type",
            "farmer_id",
            "field_id",
            "alert_type",
            unique=True,
            postgresql_where=text("status = 'unresolved'"),
            sqlite_where=text("status = 'unresolved'"),
        ),
        Index("ix_alerts_farmer_created", "farmer_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(Integer, nullable=False)
    field_id: Mapped[int] = mapped_column(Integer, nullable=False)
    alert_type: Mapped[str] = mapped_column(String(80), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unresolved", server_default="unresolved")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )