(() => {
  const views = ["login", "register", "forgot", "reset"];
  const requestedView = new URLSearchParams(window.location.search).get("view");
  const activeView = views.includes(requestedView) ? requestedView : "login";
  const authCard = document.querySelector(`[data-auth-view="${activeView}"]`);

  if (authCard) {
    authCard.hidden = false;
    document.title = `${{
      login: "Sign in",
      register: "Create account",
      forgot: "Forgot password",
      reset: "Reset password",
    }[activeView]} | JalSaathi`;
  }

  const getErrorNode = (id) => document.querySelector(`[data-error-for="${id}"]`);
  const clearFieldError = (input) => {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    const errorNode = getErrorNode(input.id);
    if (errorNode) errorNode.textContent = "";
  };

  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (!input) return;
      const showPassword = input.type === "password";
      input.type = showPassword ? "text" : "password";
      button.setAttribute("aria-label", showPassword ? "Hide password" : "Show password");
      button.setAttribute("aria-pressed", String(showPassword));
    });
  });

  function passwordStrength(password) {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password) && password.length >= 10) score += 1;
    return score;
  }

  document.querySelectorAll("[data-strength-for]").forEach((indicator) => {
    const input = document.getElementById(indicator.dataset.strengthFor);
    if (!input) return;
    input.addEventListener("input", () => {
      const score = passwordStrength(input.value);
      indicator.dataset.level = String(score);
      const strengthText = ["", "Weak password", "Fair password", "Good password", "Strong password"][score];
      const hint = indicator.querySelector("small");
      if (hint) hint.textContent = strengthText || "Use at least 12 characters.";
    });
  });

  document.querySelectorAll(".form-field input, .form-field select, input[name='terms']").forEach((input) => {
    input.addEventListener("input", () => clearFieldError(input));
    input.addEventListener("change", () => clearFieldError(input));
  });

  function clearFormState(form) {
    form.querySelectorAll("[aria-invalid='true']").forEach((input) => clearFieldError(input));
    const message = form.querySelector("[data-form-message]");
    if (message) {
      message.textContent = "";
      message.classList.remove("is-error");
    }
  }

  function setFieldError(input, message, errors) {
    input.setAttribute("aria-invalid", "true");
    const errorNode = getErrorNode(input.id);
    if (errorNode) errorNode.textContent = message;
    errors.push(input);
  }

  function validContact(value) {
    const trimmed = value.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function validPassword(value) {
    return value.length >= 12;
  }

  function getRequiredValue(form, name) {
    return String(new FormData(form).get(name) || "").trim();
  }

  function messageFor(form, text, isError = false) {
    const node = form.querySelector("[data-form-message]");
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("is-error", isError);
  }

  function setLoading(button, loading, labelText) {
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
    button.setAttribute("aria-busy", String(loading));
    const label = button.querySelector(".button-label");
    if (label) label.textContent = loading ? "Please wait..." : labelText;
  }

  function runDemoSubmission(form, button, label, resultText, onComplete) {
    setLoading(button, true, label);
    window.setTimeout(() => {
      setLoading(button, false, label);
      messageFor(form, resultText);
      if (onComplete) onComplete();
    }, 450);
  }

  async function submitAccountForm(path, payload) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const detail = result && typeof result.detail === "string"
        ? result.detail
        : "Your request could not be completed. Please try again.";
      throw new Error(detail);
    }
    return result;
  }

  document.querySelectorAll("[data-auth-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearFormState(form);
      const errors = [];
      const formName = form.dataset.authForm;
      const button = form.querySelector(".primary-button");
      const label = button?.querySelector(".button-label")?.textContent || "Continue";

      if (formName === "login" || formName === "forgot") {
        const contact = form.elements.namedItem("contact");
        const contactValue = getRequiredValue(form, "contact");
        if (!contactValue) setFieldError(contact, "Enter your email address or phone number.", errors);
        else if (!validContact(contactValue)) setFieldError(contact, "Enter a valid email address or phone number.", errors);
        if (formName === "login") {
          const password = form.elements.namedItem("password");
          if (!password.value) setFieldError(password, "Enter your password.", errors);
        }
      }

      if (formName === "register") {
        const name = form.elements.namedItem("name");
        const phone = form.elements.namedItem("phone");
        const email = form.elements.namedItem("email");
        const password = form.elements.namedItem("password");
        const confirmPassword = form.elements.namedItem("confirmPassword");
        const state = form.elements.namedItem("state");
        const district = form.elements.namedItem("district");
        const village = form.elements.namedItem("village");
        const terms = form.elements.namedItem("terms");

        [
          [name, "Enter your full name."],
          [phone, "Enter your phone number."],
          [email, "Enter your email address."],
          [password, "Create a password."],
          [confirmPassword, "Confirm your password."],
          [state, "Select your state."],
          [district, "Enter your district."],
          [village, "Enter your village or town."],
        ].forEach(([input, error]) => {
          if (!input.value.trim()) setFieldError(input, error, errors);
        });

        if (phone.value.trim()) {
          const digits = phone.value.replace(/\D/g, "");
          if (digits.length < 7 || digits.length > 15) setFieldError(phone, "Enter a valid phone number.", errors);
        }
        if (email.value.trim() && !validEmail(email.value)) setFieldError(email, "Enter a valid email address.", errors);
        if (password.value && !validPassword(password.value)) {
          setFieldError(password, "Use at least 12 characters.", errors);
        }
        if (confirmPassword.value && password.value !== confirmPassword.value) {
          setFieldError(confirmPassword, "Passwords do not match.", errors);
        }
        if (!terms.checked) {
          terms.setAttribute("aria-invalid", "true");
          terms.setAttribute("aria-describedby", "register-terms-error");
          const errorNode = getErrorNode("register-terms");
          if (errorNode) errorNode.textContent = "Please agree to the Terms and Privacy Policy.";
          errors.push(terms);
        } else {
          terms.removeAttribute("aria-invalid");
          terms.removeAttribute("aria-describedby");
        }
      }

      if (formName === "reset") {
        const code = form.elements.namedItem("code");
        const password = form.elements.namedItem("password");
        const confirmPassword = form.elements.namedItem("confirmPassword");
        if (!code.value.trim()) setFieldError(code, "Enter the verification code.", errors);
        else if (!/^\d{6}$/.test(code.value.trim())) setFieldError(code, "Enter a 6-digit code.", errors);
        if (!password.value) setFieldError(password, "Create a new password.", errors);
        else if (!validPassword(password.value)) {
          setFieldError(password, "Use at least 12 characters.", errors);
        }
        if (!confirmPassword.value) setFieldError(confirmPassword, "Confirm your new password.", errors);
        else if (password.value !== confirmPassword.value) setFieldError(confirmPassword, "Passwords do not match.", errors);
      }

      if (errors.length) {
        messageFor(form, "Please check the highlighted fields.", true);
        errors[0].focus();
        return;
      }

      if (formName === "login" || formName === "register") {
        const originalLabel = label;
        setLoading(button, true, originalLabel);
        try {
          if (formName === "login") {
            await submitAccountForm("/api/auth/login", {
              email: getRequiredValue(form, "contact"),
              password: form.elements.namedItem("password").value,
            });
          } else {
            const countryCode = form.elements.namedItem("countryCode").value;
            const phone = form.elements.namedItem("phone").value.replace(/[^\d]/g, "");
            await submitAccountForm("/api/auth/register", {
              name: getRequiredValue(form, "name"),
              email: getRequiredValue(form, "email"),
              password: form.elements.namedItem("password").value,
              phone: `${countryCode} ${phone}`,
              state: getRequiredValue(form, "state"),
              district: getRequiredValue(form, "district"),
              village: getRequiredValue(form, "village"),
            });
          }
          window.location.assign("/dashboard");
        } catch (error) {
          messageFor(
            form,
            error instanceof Error ? error.message : "Your request could not be completed.",
            true,
          );
          setLoading(button, false, originalLabel);
        }
        return;
      }

      if (formName === "forgot") {
        runDemoSubmission(form, button, label, "");
        window.setTimeout(() => {
          const confirmation = form.querySelector("[data-forgot-confirmation]");
          if (confirmation) confirmation.hidden = false;
          messageFor(form, "Demo request validated. No email or SMS was sent.");
        }, 450);
        return;
      }

      runDemoSubmission(
        form,
        button,
        label,
        "Password reset is not configured for this service. Please contact support.",
      );
    });
  });
})();
