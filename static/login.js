const togglePassword = document.getElementById("togglePassword");
const passwordInput = document.getElementById("password");
const eyeIcon = document.getElementById("eyeIcon");

if (togglePassword && passwordInput && eyeIcon) {
  togglePassword.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";

    eyeIcon.innerHTML = isPassword
      ? `
        <path d="M3 3l18 18"/>
        <path d="M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6"/>
        <path d="M9.9 4.2A10.6 10.6 0 0 1 12 4c6.5 0 10 8 10 8a16.8 16.8 0 0 1-3.1 4.4"/>
        <path d="M6.1 6.1C3.5 8 2 12 2 12s3.5 8 10 8a10.8 10.8 0 0 0 4.1-.8"/>
      `
      : `
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>
        <circle cx="12" cy="12" r="3"/>
      `;
  });
}
