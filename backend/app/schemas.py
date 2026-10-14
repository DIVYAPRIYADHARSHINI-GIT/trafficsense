"""Request models (responses are plain JSON dicts documented in the README / OpenAPI)."""

from __future__ import annotations

import datetime as dt
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .dataset import parse_hour

WeatherInput = Literal["sunny", "cloudy", "rainy"]
WeatherOrAuto = Literal["sunny", "cloudy", "rainy", "auto"]


class PredictRequest(BaseModel):
    road: str = Field(..., min_length=1, examples=["Highway 101"])
    date: dt.date = Field(..., examples=["2026-10-20"])
    time: str = Field(..., description="Hour of travel, e.g. '08:00', '8', '5:30 PM'", examples=["08:00"])
    weather: WeatherOrAuto = Field("sunny", description="'auto' blends the historical weather mix for that month")
    is_holiday: Optional[bool] = Field(None, description="Override holiday detection (default: auto-detect)")

    @field_validator("weather", mode="before")
    @classmethod
    def _lower(cls, value):
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("time")
    @classmethod
    def _valid_time(cls, value: str) -> str:
        hour = parse_hour(value)
        if hour != hour:  # NaN
            raise ValueError("time must look like 'HH:MM' (24h), 'H', or 'H:MM AM/PM'")
        return f"{int(hour):02d}:00"

    @property
    def hour(self) -> int:
        return int(self.time[:2])
