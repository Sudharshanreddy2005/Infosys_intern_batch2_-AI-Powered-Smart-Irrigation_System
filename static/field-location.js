(function () {
  "use strict";

  const requestCurrentCoordinates = (geolocation = navigator.geolocation) =>
    new Promise((resolve, reject) => {
      if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
        reject(new Error("unavailable"));
        return;
      }

      geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords || {};
          if (
            !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            !Number.isFinite(longitude) || longitude < -180 || longitude > 180
          ) {
            reject(new Error("invalid"));
            return;
          }
          resolve({ latitude, longitude });
        },
        (error) => {
          const codes = {
            1: "permission-denied",
            2: "position-unavailable",
            3: "timeout",
          };
          reject(new Error(codes[error.code] || "unavailable"));
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    });

  window.JalSaathiFieldLocation = Object.freeze({ requestCurrentCoordinates });
})();
