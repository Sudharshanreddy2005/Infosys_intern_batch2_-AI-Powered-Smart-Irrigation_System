document.addEventListener('DOMContentLoaded', async () => {
  const weatherCard = document.querySelector('.weather-card');
  if (!(weatherCard instanceof HTMLElement)) return;

  const setWeatherValue = (field, value) => {
    const target = weatherCard.querySelector(`[data-weather="${field}"]`);
    if (target instanceof HTMLElement) target.textContent = value;
  };

  try {
    const response = await fetch('/weather/current');
    if (!response.ok) {
      setWeatherValue('condition', 'Weather unavailable');
      setWeatherValue('location', 'Location not configured');
      return;
    }

    const weather = await response.json();
    setWeatherValue('location', weather.location || 'Configured location');
    setWeatherValue(
      'temperature',
      weather.temperature_c === null || weather.temperature_c === undefined
        ? 'Not provided'
        : `${weather.temperature_c}°C`,
    );
    setWeatherValue('condition', 'Current provider observation');
    setWeatherValue(
      'humidity',
      weather.humidity_percent === null || weather.humidity_percent === undefined
        ? 'Not provided'
        : `${weather.humidity_percent}%`,
    );
    setWeatherValue(
      'wind_speed',
      weather.wind_speed_mps === null || weather.wind_speed_mps === undefined
        ? 'Not provided'
        : `${weather.wind_speed_mps} m/s`,
    );
    setWeatherValue(
      'rainfall',
      weather.rainfall_mm_per_hr === null || weather.rainfall_mm_per_hr === undefined
        ? 'Not provided'
        : `${weather.rainfall_mm_per_hr} mm/h`,
    );
    weatherCard.dataset.weatherCondition = 'unknown';
    if (weather.is_stale) {
      setWeatherValue(
        'condition',
        `Cached observation · ${weather.data_age_minutes} min old`,
      );
    }
  } catch {
    setWeatherValue('condition', 'Weather service unavailable');
    setWeatherValue('location', 'Location not configured');
  }
});
