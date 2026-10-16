document.addEventListener('DOMContentLoaded', async () => {
  const carousel = document.querySelector('[data-field-carousel]');
  const fieldImage = document.querySelector('[data-field-image]');
  const fieldName = document.querySelector('[data-field-name]');
  const fieldCrop = document.querySelector('[data-field-crop]');
  const fieldStatus = document.querySelector('[data-field-status]');
  const irrigationTime = document.querySelector('[data-irrigation-time]');
  const irrigationDuration = document.querySelector('[data-irrigation-duration]');
  const fieldNote = document.querySelector('[data-field-note]');
  const slideButtons = [...document.querySelectorAll('[data-field-slide]')];

  if (
    carousel instanceof HTMLElement &&
    fieldImage instanceof HTMLImageElement &&
    fieldName instanceof HTMLElement &&
    fieldCrop instanceof HTMLElement &&
    fieldStatus instanceof HTMLElement &&
    irrigationTime instanceof HTMLElement &&
    irrigationDuration instanceof HTMLElement &&
    fieldNote instanceof HTMLElement &&
    slideButtons.length > 0
  ) {
    const fields = [
      {
        name: 'Field 1 - North Plot',
        crop: 'Paddy',
        image: '/static/images/field-rice.jpg',
        status: 'Optimal',
        statusClass: 'status-green',
        time: 'Tomorrow, 6:00 AM',
        duration: '1 hour',
        note: 'Based on soil moisture (32%) and the weather forecast, light irrigation tomorrow should maintain healthy crop growth.',
      },
      {
        name: 'Field 2 - East Plot',
        crop: 'Sugarcane',
        image: '/static/images/field-sugarcane.jpg',
        status: 'Needs Water',
        statusClass: 'status-yellow',
        time: 'Today, 5:00 PM',
        duration: '2 hours',
        note: 'Based on soil moisture (18%) and weather forecast, irrigate 2 hours today to maintain optimal crop health.',
      },
      {
        name: 'Field 3 - South Field',
        crop: 'Ragi',
        image: '/static/images/field-ragi.jpg',
        status: 'Low Moisture',
        statusClass: 'status-red',
        time: 'Today, 4:00 PM',
        duration: '1.5 hours',
        note: 'Based on soil moisture (12%) and the weather forecast, irrigate today to reduce moisture stress in the Ragi field.',
      },
    ];
    let activeIndex = 1;
    let autoplayTimer = 0;

    const showField = (index) => {
      activeIndex = (index + fields.length) % fields.length;
      const field = fields[activeIndex];

      carousel.classList.remove('is-changing');
      void carousel.offsetWidth;
      carousel.classList.add('is-changing');
      fieldImage.src = field.image;
      fieldImage.alt = `${field.crop} crop in ${field.name}`;
      fieldName.textContent = field.name;
      fieldCrop.textContent = field.crop;
      fieldStatus.textContent = field.status;
      fieldStatus.classList.remove('status-green', 'status-yellow', 'status-red');
      fieldStatus.classList.add(field.statusClass);
      irrigationTime.textContent = field.time;
      irrigationDuration.textContent = field.duration;
      fieldNote.textContent = field.note;

      slideButtons.forEach((button, buttonIndex) => {
        const isActive = buttonIndex === activeIndex;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
    };

    const stopAutoplay = () => {
      window.clearInterval(autoplayTimer);
      autoplayTimer = 0;
    };

    const startAutoplay = () => {
      stopAutoplay();
      if (!document.hidden) {
        autoplayTimer = window.setInterval(() => showField(activeIndex + 1), 4000);
      }
    };

    slideButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.fieldSlide);
        if (Number.isInteger(index)) {
          showField(index);
          startAutoplay();
        }
      });
    });

    carousel.addEventListener('mouseenter', stopAutoplay);
    carousel.addEventListener('mouseleave', startAutoplay);
    carousel.addEventListener('focusin', stopAutoplay);
    carousel.addEventListener('focusout', (event) => {
      if (!carousel.contains(event.relatedTarget)) {
        startAutoplay();
      }
    });
    document.addEventListener('visibilitychange', startAutoplay);
    startAutoplay();
  }

  try {
    const response = await fetch('/api/dashboard');
    if (!response.ok) {
      throw new Error('Unable to load dashboard data');
    }

    const data = await response.json();

    if (data.weather && typeof data.weather === 'object') {
      const weatherCard = document.querySelector('.weather-card');
      const weatherFields = ['temperature', 'condition', 'location', 'humidity', 'wind_speed', 'rainfall'];
      weatherFields.forEach((field) => {
        const value = field === 'condition' ? data.weather.description : data.weather[field];
        const target = document.querySelector(`[data-weather="${field}"]`);
        if (target && value !== undefined && value !== null && String(value).trim()) {
          target.textContent = String(value);
        }
      });

      if (weatherCard && typeof data.weather.description === 'string') {
        const description = data.weather.description.toLocaleLowerCase();
        const condition = /thunder|storm|rain|drizzle|shower/.test(description)
          ? 'rain'
          : /partly|mostly/.test(description)
            ? 'partly-cloudy'
            : /cloud|overcast/.test(description)
              ? 'cloudy'
              : /sun|clear/.test(description)
                ? 'sunny'
                : 'unknown';
        weatherCard.dataset.weatherCondition = condition;
      }
    }
  } catch (error) {
    console.warn('Dashboard data unavailable:', error.message);
  }
});
