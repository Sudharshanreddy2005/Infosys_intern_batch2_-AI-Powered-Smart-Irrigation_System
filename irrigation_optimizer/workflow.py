from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from models import IrrigationReservoir, IrrigationSchedule


class ScheduleConflict(Exception):
    pass


class InsufficientWater(Exception):
    def __init__(self, shortage_liters: float):
        self.shortage_liters = shortage_liters


def reservoir_response(reservoir: IrrigationReservoir) -> dict:
    free_liters = max(0.0, reservoir.available_liters - reservoir.reserved_liters)
    return {
        "id": reservoir.id,
        "farmer_id": reservoir.farmer_id,
        "field_id": reservoir.field_id,
        "name": reservoir.name,
        "capacity_liters": reservoir.capacity_liters,
        "available_liters": reservoir.available_liters,
        "reserved_liters": reservoir.reserved_liters,
        "remaining_liters": free_liters,
        "updated_at": reservoir.updated_at,
    }


def schedule_response(schedule: IrrigationSchedule) -> dict:
    return {
        "id": schedule.id,
        "field_id": schedule.field_id,
        "field_name": schedule.field_name,
        "crop_name": schedule.crop_name,
        "reservoir_id": schedule.reservoir_id,
        "scheduled_date": schedule.scheduled_date,
        "start_time": schedule.start_time,
        "end_time": schedule.end_time,
        "water_liters": schedule.water_liters,
        "duration_minutes": schedule.duration_minutes,
        "irrigation_method": schedule.irrigation_method,
        "status": schedule.status,
        "plan": schedule.plan_snapshot,
        "created_at": schedule.created_at,
        "updated_at": schedule.updated_at,
    }


def _owned_schedule(db: Session, farmer_id: int, schedule_id: int) -> IrrigationSchedule:
    schedule = db.scalar(
        select(IrrigationSchedule)
        .where(
            IrrigationSchedule.id == schedule_id,
            IrrigationSchedule.farmer_id == farmer_id,
        )
        .with_for_update()
    )
    if schedule is None:
        raise HTTPException(status_code=404, detail="Irrigation schedule not found.")
    return schedule


def _reserve_for_confirmation(
    db: Session,
    reservoir: IrrigationReservoir,
    schedule: IrrigationSchedule,
) -> None:
    result = db.execute(
        update(IrrigationReservoir)
        .where(
            IrrigationReservoir.id == reservoir.id,
            IrrigationReservoir.farmer_id == schedule.farmer_id,
            IrrigationReservoir.available_liters - IrrigationReservoir.reserved_liters
            >= schedule.water_liters,
        )
        .values(reserved_liters=IrrigationReservoir.reserved_liters + schedule.water_liters)
    )
    if result.rowcount != 1:
        raise InsufficientWater(
            max(
                0.0,
                schedule.water_liters
                - max(0.0, reservoir.available_liters - reservoir.reserved_liters),
            )
        )


def confirm_schedule(db: Session, farmer_id: int, schedule_id: int) -> IrrigationSchedule:
    db.rollback()
    try:
        claimed = db.execute(
            update(IrrigationSchedule)
            .where(
                IrrigationSchedule.id == schedule_id,
                IrrigationSchedule.farmer_id == farmer_id,
                IrrigationSchedule.status == "recommended",
            )
            .values(status="confirmed")
        )
        if claimed.rowcount != 1:
            db.rollback()
            schedule = db.scalar(
                select(IrrigationSchedule).where(
                    IrrigationSchedule.id == schedule_id,
                    IrrigationSchedule.farmer_id == farmer_id,
                )
            )
            if schedule is None:
                raise HTTPException(status_code=404, detail="Irrigation schedule not found.")
            raise ScheduleConflict("Only an unconfirmed recommendation can be confirmed.")
        schedule = db.scalar(
            select(IrrigationSchedule).where(
                IrrigationSchedule.id == schedule_id,
                IrrigationSchedule.farmer_id == farmer_id,
            )
        )
        if schedule is None:
            raise HTTPException(status_code=404, detail="Irrigation schedule not found.")
        reservoir = db.scalar(
            select(IrrigationReservoir)
            .where(
                IrrigationReservoir.id == schedule.reservoir_id,
                IrrigationReservoir.farmer_id == farmer_id,
            )
            .with_for_update()
        )
        if reservoir is None:
            raise HTTPException(status_code=404, detail="Reservoir not found.")
        _reserve_for_confirmation(db, reservoir, schedule)
        db.commit()
    except (HTTPException, InsufficientWater, ScheduleConflict):
        db.rollback()
        raise
    schedule.status = "confirmed"
    db.refresh(schedule)
    return schedule


def cancel_schedule(db: Session, farmer_id: int, schedule_id: int) -> IrrigationSchedule:
    schedule = _owned_schedule(db, farmer_id, schedule_id)
    if schedule.status not in {"recommended", "insufficient_water", "confirmed"}:
        raise ScheduleConflict("This schedule can no longer be cancelled.")
    previous_status = schedule.status
    try:
        changed = db.execute(
            update(IrrigationSchedule)
            .where(
                IrrigationSchedule.id == schedule.id,
                IrrigationSchedule.farmer_id == farmer_id,
                IrrigationSchedule.status == previous_status,
            )
            .values(status="cancelled", updated_at=func.now())
        )
        if changed.rowcount != 1:
            raise ScheduleConflict("The schedule has already changed.")
        if previous_status == "confirmed":
            released = db.execute(
                update(IrrigationReservoir)
                .where(
                    IrrigationReservoir.id == schedule.reservoir_id,
                    IrrigationReservoir.farmer_id == farmer_id,
                    IrrigationReservoir.reserved_liters >= schedule.water_liters,
                )
                .values(
                    reserved_liters=IrrigationReservoir.reserved_liters
                    - schedule.water_liters,
                    updated_at=func.now(),
                )
            )
            if released.rowcount != 1:
                raise ScheduleConflict(
                    "The reserved water balance changed; schedule was not cancelled."
                )
        db.commit()
    except ScheduleConflict:
        db.rollback()
        raise
    schedule.status = "cancelled"
    db.refresh(schedule)
    return schedule


def complete_schedule(db: Session, farmer_id: int, schedule_id: int) -> IrrigationSchedule:
    schedule = _owned_schedule(db, farmer_id, schedule_id)
    if schedule.status != "confirmed":
        raise ScheduleConflict("Only a confirmed schedule can be marked completed.")
    try:
        changed = db.execute(
            update(IrrigationSchedule)
            .where(
                IrrigationSchedule.id == schedule.id,
                IrrigationSchedule.farmer_id == farmer_id,
                IrrigationSchedule.status == "confirmed",
            )
            .values(status="completed", updated_at=func.now())
        )
        if changed.rowcount != 1:
            raise ScheduleConflict("The schedule has already changed.")
        used = db.execute(
            update(IrrigationReservoir)
            .where(
                IrrigationReservoir.id == schedule.reservoir_id,
                IrrigationReservoir.farmer_id == farmer_id,
                IrrigationReservoir.reserved_liters >= schedule.water_liters,
                IrrigationReservoir.available_liters >= schedule.water_liters,
            )
            .values(
                reserved_liters=IrrigationReservoir.reserved_liters
                - schedule.water_liters,
                available_liters=IrrigationReservoir.available_liters
                - schedule.water_liters,
                updated_at=func.now(),
            )
        )
        if used.rowcount != 1:
            raise ScheduleConflict("The reservoir balance changed; schedule was not completed.")
        db.commit()
    except ScheduleConflict:
        db.rollback()
        raise
    schedule.status = "completed"
    db.refresh(schedule)
    return schedule
