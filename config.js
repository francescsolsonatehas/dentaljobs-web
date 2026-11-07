// Configuración del frontend: URL base del backend.
//
// - En GitHub Pages (producción) apunta al backend en Render.
// - En cualquier otro caso (desarrollo local servido por Express) usa el
//   mismo origen, así que basta con cadena vacía.
//
// ⚠️ Al crear el servicio en Render, sustituir por la URL real si difiere.
window.API_URL = window.location.hostname.endsWith("github.io")
  ? "https://dentaljobs-docker.onrender.com"
  : "";

// Mapa (ver mapa.js): servidor de tiles. Por defecto, el de OpenStreetMap, que es
// gratuito pero "best effort" (https://operations.osmfoundation.org/policies/tiles/):
// exige mostrar la atribución y puede bloquear si el volumen de uso crece. Si algún
// día hace falta otro proveedor, basta con cambiar `url` y `attribution` aquí.
window.MAPA_TILES = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  maxZoom: 19
};
