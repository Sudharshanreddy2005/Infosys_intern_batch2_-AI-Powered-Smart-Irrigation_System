import time
import config
from weather_api import get_forecast

config.CACHE_MINUTES = 0.1      # 6 seconds, only for this test

print("1st call (API hit):")
a = get_forecast(hours=24)
print("2nd call, different hours (should say 'Using cached data'):")
b = get_forecast(hours=12)
print(len(a), len(b))
assert 0 < len(a) <= 24
assert len(b) == min(12, len(a))

print("Waiting 7s for cache to expire...")
time.sleep(7)
print("3rd call (fresh API hit, no cache message):")
get_forecast()
