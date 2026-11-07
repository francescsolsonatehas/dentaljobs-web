// Mapa de DentalJobs: la búsqueda de siempre, con los resultados situados. Mismo
// selector de tipo (empleo, suplencias, colaboraciones), mismos filtros y mismos
// resultados que la lista (app.publicaciones.cargar); lo que cambia es cómo se enseñan.
//   - El dentista ve las ofertas de las clínicas, en su sede (o en el centro de su ciudad
//     si no tiene la dirección localizada).
//   - La clínica ve las solicitudes de los dentistas y los dentistas por lo que marcan en
//     su perfil (días → "Suplencias", semana → "Colaboraciones"), siempre en el centro de
//     su ciudad.
// Cada punto abre las mismas tarjetas que la lista, separadas por apartado. Nunca se
// muestra la dirección ni la ubicación exacta de un dentista.
//
// Leaflet se carga solo al abrir el mapa por primera vez (desde cdnjs, versión fija y
// con SRI), así que no pesa en el resto de la web. Los tiles son los de OpenStreetMap;
// la URL y la atribución salen de window.MAPA_TILES (config.js), para poder cambiar de
// servidor de tiles sin tocar este fichero.

(function () {
  const LEAFLET = {
    css: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
    cssSri: "sha384-c6Rcwz4e4CITMbu/NBmnNS8yN2sC3cUElMEMfP3vqqKFp7GOYaaBBCqmaWBjmkjb",
    js: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
    jsSri: "sha384-NElt3Op+9NBMCYaef5HxeJmU4Xeard/Lku8ek6hoPTvYkQPh3zLIrJP7KiRocsxO"
  };
  const TILES_POR_DEFECTO = {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19
  };
  const VISTA_ESPANA = { centro: [40.2, -3.7], zoom: 6 };

  const el = (id) => document.getElementById(id);

  let leafletCargado = null;
  function cargarLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletCargado) return leafletCargado;
    leafletCargado = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET.css;
      css.integrity = LEAFLET.cssSri;
      css.crossOrigin = "anonymous";
      document.head.appendChild(css);

      const js = document.createElement("script");
      js.src = LEAFLET.js;
      js.integrity = LEAFLET.jsSri;
      js.crossOrigin = "anonymous";
      js.onload = () => resolve();
      js.onerror = () => { leafletCargado = null; reject(new Error("No se pudo cargar el mapa")); };
      document.head.appendChild(js);
    });
    return leafletCargado;
  }

  // Enlace "Cómo llegar": URL de navegación de Google Maps. Sin API ni clave: solo abre
  // Google Maps en otra pestaña hacia las coordenadas de la clínica.
  const urlComoLlegar = (lat, lon) =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lon}`)}`;

  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  // Dónde va cada resultado: una oferta de clínica, en su sede; si no, en el centro de
  // su ciudad (lo que guarda la publicación). Un dentista, siempre en su ciudad.
  const posicion = (x) => {
    const lat = x.sede_lat ?? x.lat, lon = x.sede_lon ?? x.lon;
    return lat != null && lon != null ? { lat: Number(lat), lon: Number(lon) } : null;
  };

  app.mapa = {
    _mapa: null,
    _capa: null,

    // Pestaña "Mapa": abre la búsqueda (el apartado que estuviera elegido) en el mapa
    async abrir(btn) {
      app.filtros.activarPestanya(btn || el("btnMapa"));
      this._montar();
      try {
        await cargarLeaflet();
      } catch (error) {
        el("mapaLienzo").innerHTML = `<div class="empty-state"><h3>No se pudo cargar el mapa</h3><p>Comprueba tu conexión y vuelve a intentarlo.</p></div>`;
        return;
      }
      this._iniciarMapa();
      return app.filtros.cambiarTipo();
    },

    _montar() {
      const cont = el("mapaContainer");
      if (cont.dataset.montado) return;
      cont.dataset.montado = "1";
      cont.innerHTML = `
        <div class="mapa-panel">
          <div id="mapaResumen" class="mapa-resumen"></div>
          <div id="mapaLienzo" class="mapa-lienzo"></div>
          <div id="mapaLeyenda" class="mapa-leyenda"></div>
        </div>`;
    },

    // Lista o mapa, según la pestaña (estadoApp.enMapa). Lo llaman el cambio de pestaña
    // y cada búsqueda.
    sincronizarVista() {
      const cont = el("mapaContainer");
      if (!cont) return;
      const veniaDelMapa = cont.style.display !== "none";
      cont.style.display = estadoApp.enMapa ? "" : "none";
      if (estadoApp.enMapa) {
        el("publicacionesContainer").style.display = "none";
        el("suplenciasCalendarioContainer").style.display = "none";
        el("colaboracionesCalendarioContainer").style.display = "none";
        if (this._mapa) setTimeout(() => this._mapa.invalidateSize(), 0);
      } else if (veniaDelMapa) {
        el("publicacionesContainer").style.display = "";
      }
    },

    _iniciarMapa() {
      if (this._mapa) {
        // El contenedor estaba oculto: Leaflet necesita recalcular su tamaño
        setTimeout(() => this._mapa.invalidateSize(), 0);
        return;
      }
      const tiles = { ...TILES_POR_DEFECTO, ...(window.MAPA_TILES || {}) };
      this._mapa = L.map("mapaLienzo", { scrollWheelZoom: true }).setView(VISTA_ESPANA.centro, VISTA_ESPANA.zoom);
      L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: tiles.maxZoom }).addTo(this._mapa);
      this._capa = L.layerGroup().addTo(this._mapa);
    },

    // Los resultados de la búsqueda (los mismos que la lista), agrupados por punto
    pintar(publicaciones, dentistas = []) {
      if (!this._mapa) return; // Leaflet aún cargando: abrir() vuelve a buscar al terminar
      this._capa.clearLayers();
      const puntos = new Map();
      let sinUbicacion = 0;
      const anadir = (x, campo) => {
        const pos = posicion(x);
        if (!pos) { sinUbicacion++; return; }
        const clave = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
        if (!puntos.has(clave)) puntos.set(clave, { ...pos, publicaciones: [], dentistas: [] });
        puntos.get(clave)[campo].push(x);
      };
      publicaciones.forEach(p => anadir(p, "publicaciones"));
      dentistas.forEach(d => anadir(d, "dentistas"));

      const veClinicas = estadoApp.tipoUsuario !== "clinica";
      for (const punto of puntos.values()) {
        const n = punto.publicaciones.length + punto.dentistas.length;
        const icono = veClinicas
          ? L.divIcon({ className: "mapa-pin-wrap", html: `<div class="mapa-pin mapa-pin-oferta"><span>${n}</span></div>`, iconSize: [34, 42], iconAnchor: [17, 40] })
          : L.divIcon({ className: "mapa-pin-wrap", html: `<div class="mapa-zona"><span>🦷 ${n}</span></div>`, iconSize: [64, 30], iconAnchor: [32, 15] });
        L.marker([punto.lat, punto.lon], { icon: icono, title: this._titulo(punto) })
          .on("click", () => this._abrirPunto(punto))
          .addTo(this._capa);
      }

      el("mapaResumen").textContent = this._resumen(dentistas, puntos.size, sinUbicacion);
      el("mapaLeyenda").innerHTML = veClinicas
        ? `<span><i class="mapa-chip mapa-chip-oferta"></i> Clínica (el número son sus ofertas que encajan con la búsqueda)</span>`
        : `<span><i class="mapa-chip mapa-chip-zona"></i> Dentistas de la localidad (el número es lo que encaja con la búsqueda)</span>
           <span>Se sitúan en su ciudad: nunca se muestra su dirección.</span>`;
      this._encuadrar([...puntos.values()].map(p => [p.lat, p.lon]));
    },

    // La misma frase que la lista ("💼 Ofertas de empleo: 33 · … — de 10 clínicas"), más
    // en cuántos puntos y cuántas no se pueden situar
    _resumen(dentistas, nPuntos, sinUbicacion) {
      const { texto } = app.publicaciones.resumenBusqueda(dentistas);
      if (!texto) return "No hay resultados con estos filtros.";
      const fuera = sinUbicacion ? ` · ${plural(sinUbicacion, "sin ubicación (no sale en el mapa)", "sin ubicación (no salen en el mapa)")}` : "";
      return `${texto}, en ${plural(nPuntos, "punto", "puntos")} del mapa${fuera}`;
    },

    // Una clínica o un dentista: su nombre (con la sede); varios: la ciudad
    _titulo(punto) {
      const autores = new Set([...punto.publicaciones.map(p => p.usuario_id), ...punto.dentistas.map(d => d.id)]);
      const primero = punto.publicaciones[0];
      if (autores.size === 1) {
        if (!primero) return punto.dentistas[0].nombre;
        const sede = primero.sede_nombre && primero.sede_nombre !== primero.usuario_nombre ? ` · ${primero.sede_nombre}` : "";
        return `${primero.usuario_nombre || ""}${sede}`;
      }
      return (primero ? primero.ciudad : punto.dentistas[0].ciudad) || "Esta zona";
    },

    // Lo de un punto, con las mismas tarjetas que la lista, separadas por apartado
    async _abrirPunto(punto) {
      const contexto = await app.publicaciones.contextoTarjetas();
      const tarjetas = punto.publicaciones.map(p => app.publicaciones.tarjetaHtml(p, contexto));
      const deClinica = punto.publicaciones.find(p => p.usuario_tipo === "clinica");
      let aviso = "";
      if (deClinica) {
        const precision = deClinica.sede_lat != null ? deClinica.sede_precision : "ciudad";
        aviso = `<div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin:0 0 1rem;">
          <span class="mapa-popup-suave">${precision === "direccion" ? "📍 En su dirección"
            : precision === "calle" ? "📍 Ubicación aproximada (a nivel de calle)" : "📍 Ubicación aproximada (centro de la localidad)"}</span>
          <a class="btn-outline btn-small" href="${urlComoLlegar(punto.lat, punto.lon)}" target="_blank" rel="noopener noreferrer">📍 Cómo llegar</a>
        </div>`;
      } else {
        aviso = `<p class="mapa-popup-suave" style="margin:0 0 1rem;">📍 Situados en la ciudad, no en su domicilio.</p>`;
      }
      el("interesadosBody").innerHTML = aviso + app.publicaciones.agruparHtml(punto.publicaciones, tarjetas, {
        enModal: true, dentistas: punto.dentistas, diasElegidos: app.filtros.diasElegidos()
      });
      const modal = el("modalInteresados");
      modal.querySelector(".modal-header h2").textContent = this._titulo(punto);
      modal.classList.add("active");
    },

    _encuadrar(puntos) {
      if (puntos.length) {
        this._mapa.fitBounds(L.latLngBounds(puntos), { padding: [40, 40], maxZoom: 12 });
      } else {
        this._mapa.setView(VISTA_ESPANA.centro, VISTA_ESPANA.zoom);
      }
    }
  };
})();
