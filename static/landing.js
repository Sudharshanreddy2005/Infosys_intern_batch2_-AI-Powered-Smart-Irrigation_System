document.addEventListener("DOMContentLoaded", async () => {
  const links = document.querySelectorAll("[data-dashboard-link]");
  if (!links.length) return;
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (response.status === 401) return;
    if (!response.ok) throw new Error("The account could not be checked.");
    links.forEach((link) => {
      link.href = "/dashboard";
      link.textContent = "Go to Dashboard";
    });
    document.querySelectorAll('a[href="/static/auth.html?view=login"]').forEach((link) => {
      link.hidden = true;
    });
  } catch (error) {
    console.error("JalSaathi landing page could not check the current account:", error);
  }
});
