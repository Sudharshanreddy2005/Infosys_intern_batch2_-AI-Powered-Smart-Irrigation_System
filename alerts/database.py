
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from models import Alert


def create_alert(db: Session, alert_data: dict) -> tuple[Alert | None, bool]:
    values = {
        key: value
        for key, value in alert_data.items()
        if key in {
            "farmer_id",
            "field_id",
            "alert_type",
            "severity",
            "message",
            "reason",
            "is_read",
            "status",
        }
    }
    dialect = db.get_bind().dialect.name
    insert = {
        "postgresql": postgresql_insert,
        "sqlite": sqlite_insert,
    }.get(dialect)
    if insert is None:
        existing = db.scalar(
            select(Alert).where(
                Alert.farmer_id == values["farmer_id"],
                Alert.field_id == values["field_id"],
                Alert.alert_type == values["alert_type"],
                Alert.status == "unresolved",
            )
        )
        if existing:
            return existing, False
        alert = Alert(**values)
        db.add(alert)
        db.flush()
        return alert, True

    statement = insert(Alert).values(**values).on_conflict_do_nothing(
        index_elements=["farmer_id", "field_id", "alert_type"],
        index_where=Alert.status == "unresolved",
    ).returning(Alert.id)
    alert_id = db.execute(statement).scalar_one_or_none()
    if alert_id is not None:
        return db.get(Alert, alert_id), True

    existing = db.scalar(
        select(Alert).where(
            Alert.farmer_id == values["farmer_id"],
            Alert.field_id == values["field_id"],
            Alert.alert_type == values["alert_type"],
            Alert.status == "unresolved",
        )
    )
    return existing, False


def get_farmer_alerts(
    db: Session,
    farmer_id: int,
    unread_only: bool = False,
):
    """Get alerts belonging to a farmer."""

    query = select(Alert).where(Alert.farmer_id == farmer_id)

    if unread_only:
        query = query.where(Alert.is_read.is_(False))

    query = query.order_by(Alert.created_at.desc())

    return db.scalars(query).all()


def mark_alert_as_read(
    db: Session,
    alert_id: int,
    farmer_id: int,
):
    """Mark a farmer's alert as read."""

    alert = db.scalar(
        select(Alert).where(
            Alert.id == alert_id,
            Alert.farmer_id == farmer_id,
        )
    )

    if alert is None:
        return None

    alert.is_read = True
    db.commit()
    db.refresh(alert)

    return alert


def resolve_alert(
    db: Session,
    alert_id: int,
    farmer_id: int,
):
    """Mark a farmer's alert as resolved."""

    alert = db.scalar(
        select(Alert).where(
            Alert.id == alert_id,
            Alert.farmer_id == farmer_id,
        )
    )

    if alert is None:
        return None

    alert.status = "resolved"
    db.commit()
    db.refresh(alert)

    return alert
