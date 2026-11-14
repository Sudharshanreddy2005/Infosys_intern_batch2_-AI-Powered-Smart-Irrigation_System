(() => {
  "use strict";

  const normalizeNumber = (value) => {
    if ((typeof value !== "number" && typeof value !== "string") ||
        (typeof value === "string" && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const formatTemperature = (value, unavailable = "—") => {
    const number = normalizeNumber(value);
    if (number === null) return unavailable;
    const rounded = Math.round(Math.abs(number)) * Math.sign(number);
    return `${rounded === 0 ? 0 : rounded}°C`;
  };
  const decimalDigitStarts = [0x0966, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66];
  const latinizeDigits = (value) => Array.from(String(value), (character) => {
    const codePoint = character.codePointAt(0);
    const start = decimalDigitStarts.find((digitStart) =>
      codePoint >= digitStart && codePoint <= digitStart + 9);
    return start === undefined ? character : String(codePoint - start);
  }).join("");
  const normalizeAssistantText = (value) => latinizeDigits(value).replace(
    /(-?\d+(?:[.,]\d+)?)\s*°\s*C\b/gi,
    (_match, number) => formatTemperature(number.replace(",", "."), "—"),
  );

  const formatting = Object.freeze({
    formatTemperature,
    normalizeAssistantText,
    numberOptions: (options = {}) => ({
      maximumFractionDigits: 20,
      ...options,
      numberingSystem: "latn",
    }),
    dateOptions: (options = {}) => ({
      ...options,
      numberingSystem: "latn",
    }),
  });

  if (typeof window !== "undefined") window.JalSaathiNumberFormat = formatting;
  if (typeof module !== "undefined" && module.exports) module.exports = formatting;
})();
