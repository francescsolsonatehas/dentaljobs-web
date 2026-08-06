// Configuración del frontend: URL base del backend.
//
// - En GitHub Pages (producción) apunta al backend en Render.
// - En cualquier otro caso (desarrollo local servido por Express) usa el
//   mismo origen, así que basta con cadena vacía.
//
// ⚠️ Al crear el servicio en Render, sustituir por la URL real si difiere.
window.API_URL = window.location.hostname.endsWith("github.io")
  ? "https://dentaljobs.onrender.com"
  : "";
