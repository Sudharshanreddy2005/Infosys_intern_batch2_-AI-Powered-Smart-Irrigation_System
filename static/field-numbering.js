(function () {
  "use strict";

  const withDisplayNumbers = (fields) => {
    if (!Array.isArray(fields)) throw new TypeError("Fields must be an array.");
    return fields.map((field, index) => ({
      ...field,
      displayNumber: index + 1,
    }));
  };

  window.JalSaathiFieldNumbering = Object.freeze({ withDisplayNumbers });
})();
