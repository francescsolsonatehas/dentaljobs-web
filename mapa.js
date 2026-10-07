// Mapa de DentalJobs. Enseña lo mismo que la app a cada rol:
//   - la clínica ve DENTISTAS (como en "Dentistas" y "Publicaciones de dentistas"): cada
//     dentista con su disponibilidad (suplencias, semana, desde cuándo, jornada) y sus
//     publicaciones (solicitud de empleo, colaboración), situado en su ciudad;
//   - el dentista ve CLÍNICAS con sus ofertas activas por tipo (oferta de empleo,
//     suplencia, colaboración), como en "Publicaciones de clínicas".
// Nunca se muestra la dirección ni la ubicación exacta de un dentista.
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

  const esc = (t) => utils.escapeHtml(String(t ?? ""));
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

  const FILTROS_HTML = `
    <div class="mapa-filtros">
      <div class="filter-group">
        <label for="mapaCiudad">Ciudad</label>
        <input id="mapaCiudad" placeholder="Ej: Lleida" autocomplete="off">
      </div>
      <div class="filter-group">
        <label for="mapaRadio">Radio</label>
        <select id="mapaRadio" title="Busca a esta distancia de la ciudad indicada">
          <option value="">Solo esa ciudad</option>
          <option value="10">a 10 km</option>
          <option value="25">a 25 km</option>
          <option value="30">a 30 km</option>
          <option value="50">a 50 km</option>
          <option value="100">a 100 km</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="mapaEspecialidad">Especialidad</label>
        <select id="mapaEspecialidad"><option value="">Todas las especialidades</option></select>
      </div>
      <div class="filter-group mapa-solo-clinicas">
        <label for="mapaTipo">Tipo de oferta</label>
        <select id="mapaTipo">
          <option value="">Todos los tipos</option>
          <option value="oferta">💼 Ofertas de empleo</option>
          <option value="suplencia">🚨 Suplencias</option>
          <option value="colaboracion">🤝 Colaboraciones</option>
        </select>
      </div>
      <div class="filter-group mapa-solo-clinicas">
        <label for="mapaOfertas">Ofertas</label>
        <select id="mapaOfertas">
          <option value="">Todas las clínicas</option>
          <option value="activas">Con ofertas activas</option>
          <option value="busca">Que buscan esa especialidad</option>
        </select>
      </div>
      <div class="filter-group mapa-solo-dentistas">
        <label for="mapaDisponibilidad">Disponibilidad</label>
        <select id="mapaDisponibilidad">
          <option value="">Cualquiera</option>
          <option value="inmediata">Inmediata</option>
          <option value="proxima">A partir de una fecha</option>
          <option value="suplencias">Para suplencias</option>
          <option value="colaboraciones">Para colaboraciones</option>
        </select>
      </div>
      <div class="filter-group mapa-solo-dentistas">
        <label for="mapaFecha">Disponible el día</label>
        <input id="mapaFecha" type="date" title="Dentistas que han marcado ese día para suplencias">
      </div>
      <div class="filter-group mapa-solo-dentistas">
        <label for="mapaJornada">Jornada</label>
        <select id="mapaJornada">
          <option value="">Cualquiera</option>
          <option value="completa">Completa</option>
          <option value="parcial">Parcial</option>
        </select>
      </div>
      <div class="filter-group mapa-solo-dentistas">
        <label for="mapaTurno">Turno</label>
        <select id="mapaTurno">
          <option value="">Cualquiera</option>
          <option value="manana">Mañana</option>
          <option value="tarde">Tarde</option>
        </select>
      </div>
      <div class="filter-group mapa-solo-dentistas">
        <label for="mapaPublicacion">Publicaciones</label>
        <select id="mapaPublicacion">
          <option value="">Todos los dentistas</option>
          <option value="solicitud">Con solicitud de empleo</option>
          <option value="colaboracion">Con colaboración</option>
        </select>
      </div>
    </div>`;

  const TIPOS_OFERTA = [
    ["oferta", "💼", "oferta de empleo", "ofertas de empleo"],
    ["suplencia", "🚨", "suplencia", "suplencias"],
    ["colaboracion", "🤝", "colaboración", "colaboraciones"]
  ];
  const JORNADAS = { completa: "Jornada completa", parcial: "Jornada parcial", ambas: "Jornada completa o parcial" };

  app.mapa = {
    modo: null,
    _mapa: null,
    _capa: null,
    _observador: null,
    _peticion: 0,

    // Cada rol ve a la otra parte: la clínica, dentistas; el dentista, clínicas.
    _esClinica() { return estadoApp.tipoUsuario === "clinica"; },

    // Abre la pestaña "Mapa" dentro de la pantalla de la plataforma.
    async abrir(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = false;
      estadoApp.filtros.verColaboraciones = false;
      estadoApp.vistaActual = "mapa";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      (btn || el("btnMapa")).classList.add("active");

      const titulo = el("filtrosTitle");
      titulo.textContent = "🗺️ Mapa";
      titulo.style.display = "block";

      // Esconder lo propio del listado (calendarios, conmutadores…) y mostrar el mapa
      app.filtros.sincronizarUISuplencias();
      el("filtros").classList.add("mapa-activo");
      el("publicacionesContainer").style.display = "none";
      el("mapaContainer").style.display = "";

      this._vigilarSalida();
      this._montarInterfaz();

      try {
        await cargarLeaflet();
      } catch (error) {
        el("mapaLienzo").innerHTML = `<div class="empty-state"><h3>No se pudo cargar el mapa</h3><p>Comprueba tu conexión y vuelve a intentarlo.</p></div>`;
        return;
      }
      this._iniciarMapa();
      return this.cargar();
    },

    // Cualquier otra pestaña (por clic o por una notificación) quita la clase "active"
    // del botón Mapa: es la señal para devolver la pantalla al listado.
    _vigilarSalida() {
      if (this._observador) return;
      this._observador = new MutationObserver(() => {
        if (!el("btnMapa").classList.contains("active")) this.cerrar();
      });
      this._observador.observe(el("btnMapa"), { attributes: true, attributeFilter: ["class"] });
    },

    cerrar() {
      el("filtros").classList.remove("mapa-activo");
      el("mapaContainer").style.display = "none";
      el("publicacionesContainer").style.display = "";
    },

    _montarInterfaz() {
      const cont = el("mapaContainer");
      if (!cont.dataset.montado) {
        cont.dataset.montado = "1";
        cont.innerHTML = `
          <div class="mapa-panel">
            <div class="mapa-modos" id="mapaModos">
              <button type="button" id="mapaModoDentistas" onclick="app.mapa.cambiarModo('dentistas')">🦷 Dentistas</button>
              <button type="button" id="mapaModoClinicas" onclick="app.mapa.cambiarModo('clinicas')">🏥 Clínicas</button>
            </div>
            ${FILTROS_HTML}
            <div id="mapaResumen" class="mapa-resumen"></div>
            <div id="mapaLienzo" class="mapa-lienzo"></div>
            <div id="mapaLeyenda" class="mapa-leyenda"></div>
          </div>`;

        const recargar = () => this.cargar();
        ["mapaRadio", "mapaEspecialidad", "mapaTipo", "mapaOfertas", "mapaDisponibilidad", "mapaFecha", "mapaJornada", "mapaTurno", "mapaPublicacion"]
          .forEach(id => el(id).addEventListener("change", recargar));
        app.ciudades.montar(el("mapaCiudad"), null, null, recargar);
        el("mapaCiudad").addEventListener("change", recargar);
        el("mapaCiudad").addEventListener("keydown", (e) => { if (e.key === "Enter") recargar(); });
      }
      this._rellenarEspecialidades();
      this._ajustarRol();
    },

    // El modo por defecto y los modos disponibles dependen del rol: la clínica ve
    // dentistas (y también clínicas); el dentista solo ve clínicas, igual que en la app.
    _ajustarRol() {
      const clinica = this._esClinica();
      const modoValido = clinica || this.modo === "clinicas";
      if (!this.modo || !modoValido) this.modo = clinica ? "dentistas" : "clinicas";
      el("mapaModos").style.display = clinica ? "" : "none";
      this._aplicarModo();
    },

    // Especialidades: las mismas del resto de la app (por si aún no estaban cargadas
    // la primera vez que se abrió el mapa)
    _rellenarEspecialidades() {
      const sel = el("mapaEspecialidad");
      if (sel.options.length > 1) return;
      (estadoApp.especialidades || []).forEach(e => {
        const o = document.createElement("option");
        o.value = e.id;
        o.textContent = e.nombre;
        sel.appendChild(o);
      });
    },

    cambiarModo(modo) {
      if (modo === this.modo) return;
      this.modo = modo;
      this._aplicarModo();
      this.cargar();
    },

    _aplicarModo() {
      const clinicas = this.modo === "clinicas";
      el("mapaModoClinicas").classList.toggle("active", clinicas);
      el("mapaModoDentistas").classList.toggle("active", !clinicas);
      document.querySelectorAll("#mapaContainer .mapa-solo-clinicas").forEach(g => { g.style.display = clinicas ? "" : "none"; });
      document.querySelectorAll("#mapaContainer .mapa-solo-dentistas").forEach(g => { g.style.display = clinicas ? "none" : ""; });
      el("mapaLeyenda").innerHTML = clinicas
        ? `<span><i class="mapa-chip mapa-chip-registrada"></i> Clínica sin ofertas</span>
           <span><i class="mapa-chip mapa-chip-oferta"></i> Clínica con ofertas activas (el número es el total)</span>`
        : `<span><i class="mapa-chip mapa-chip-zona"></i> Dentistas en la localidad (el número es el total)</span>
           <span>Se sitúan en su ciudad: nunca se muestra su dirección.</span>`;
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

    _parametros() {
      const p = new URLSearchParams();
      const ciudad = el("mapaCiudad").value.trim();
      const radio = el("mapaRadio").value;
      const esp = el("mapaEspecialidad").value;
      if (ciudad) {
        p.set("ciudad", ciudad);
        if (radio) p.set("radioKm", radio);
      }
      if (esp) p.set("especialidad", esp);
      if (this.modo === "clinicas") {
        const ofertas = el("mapaOfertas").value;
        if (ofertas === "activas") p.set("conOfertas", "1");
        if (ofertas === "busca" && esp) p.set("busca", "1");
        if (el("mapaTipo").value) p.set("tipo", el("mapaTipo").value);
      } else {
        for (const [param, id] of [["disponibilidad", "mapaDisponibilidad"], ["fecha", "mapaFecha"], ["jornada", "mapaJornada"], ["turno", "mapaTurno"], ["publicacion", "mapaPublicacion"]]) {
          const v = el(id).value;
          if (v) p.set(param, v);
        }
      }
      return p.toString();
    },

    async cargar() {
      if (!this._mapa) return;
      const peticion = ++this._peticion;
      const qs = this._parametros();
      const esClinicas = this.modo === "clinicas";
      try {
        if (!esClinicas && !estadoApp.usuario) {
          this._capa.clearLayers();
          el("mapaResumen").textContent = "Inicia sesión para ver los dentistas.";
          return;
        }
        const data = await utils.request(`/mapa/${esClinicas ? "clinicas" : "dentistas"}${qs ? "?" + qs : ""}`);
        if (peticion !== this._peticion) return; // llegó una respuesta más reciente
        if (esClinicas) this._pintarClinicas(data); else this._pintarDentistas(data);
      } catch (error) {
        if (peticion === this._peticion) utils.mostrarAlerta(error.message, "error");
      }
    },

    _encuadrar(puntos, centro, radioKm) {
      if (puntos.length) {
        this._mapa.fitBounds(L.latLngBounds(puntos), { padding: [40, 40], maxZoom: 12 });
      } else if (centro) {
        this._mapa.setView([centro.lat, centro.lon], 9);
      } else {
        this._mapa.setView(VISTA_ESPANA.centro, VISTA_ESPANA.zoom);
      }
      if (centro && radioKm) {
        L.circle([centro.lat, centro.lon], { radius: radioKm * 1000, color: "#2563eb", weight: 1, fillOpacity: 0.05, interactive: false }).addTo(this._capa);
      }
    },

    _radioActivo() {
      return el("mapaCiudad").value.trim() ? parseFloat(el("mapaRadio").value) || 0 : 0;
    },

    // ---------- Clínicas (las ve el dentista; también las clínicas) ----------

    _pintarClinicas(data) {
      this._capa.clearLayers();
      const clinicas = data.clinicas || [];
      const puntos = [];
      for (const c of clinicas) {
        const icono = L.divIcon({
          className: "mapa-pin-wrap",
          html: `<div class="mapa-pin ${c.tiene_ofertas ? "mapa-pin-oferta" : "mapa-pin-registrada"}"><span>${c.tiene_ofertas ? c.ofertas_activas : "🏥"}</span></div>`,
          iconSize: [34, 42],
          iconAnchor: [17, 40],
          popupAnchor: [0, -36]
        });
        L.marker([c.lat, c.lon], { icon: icono, title: c.nombre })
          .bindPopup(this._popupClinica(c), { minWidth: 230 })
          .addTo(this._capa);
        puntos.push([c.lat, c.lon]);
      }
      el("mapaResumen").textContent = clinicas.length
        ? plural(clinicas.length, "clínica en el mapa", "clínicas en el mapa")
        : "No hay clínicas con estos filtros.";
      this._encuadrar(puntos, data.centro, this._radioActivo());
    },

    _popupClinica(c) {
      const id = Number(c.id);
      const lugar = [c.sede_nombre && c.sede_nombre !== c.nombre ? c.sede_nombre : null, c.ciudad].filter(Boolean).join(" · ");
      // "💼 2 ofertas de empleo · 🚨 1 suplencia · 🤝 1 colaboración"
      const desglose = TIPOS_OFERTA
        .filter(([tipo]) => (c.por_tipo || {})[tipo] > 0)
        .map(([tipo, icono, uno, varios]) => `<span class="mapa-chip-tipo">${icono} ${plural(c.por_tipo[tipo], uno, varios)}</span>`)
        .join("");
      const ofertas = c.tiene_ofertas
        ? `<div class="mapa-chips">${desglose}</div>`
        : `<span class="mapa-popup-suave">Sin ofertas activas</span>`;
      const aproximada = c.precision === "ciudad"
        ? `<p class="mapa-popup-suave">📍 Ubicación aproximada (centro de la localidad)</p>`
        : (c.precision === "calle" ? `<p class="mapa-popup-suave">📍 Ubicación aproximada (a nivel de calle)</p>` : "");
      return `
        <div class="mapa-popup">
          <h4>${esc(c.nombre)}</h4>
          ${lugar ? `<p>📍 ${esc(lugar)}</p>` : ""}
          ${c.especialidades.length ? `<p>🦷 ${esc(c.especialidades.join(", "))}</p>` : ""}
          ${ofertas}
          ${aproximada}
          <div class="mapa-popup-acciones">
            ${c.tiene_ofertas ? `<button type="button" class="btn-small btn-primary" onclick='app.mapa.verOfertas(${id}, ${JSON.stringify(c.nombre).replace(/'/g, "&#39;")})'>Ver ofertas</button>` : ""}
            <button type="button" class="btn-small ${c.tiene_ofertas ? "btn-secondary" : "btn-primary"}" onclick="app.perfiles.verDetalle(${id})">Ver clínica</button>
            <a class="btn-small btn-outline" href="${urlComoLlegar(c.lat, c.lon)}" target="_blank" rel="noopener noreferrer">Cómo llegar</a>
          </div>
        </div>`;
    },

    // "Ver ofertas": lista las ofertas activas de la clínica (las mismas que cuenta el
    // mapa: una suplencia caducada no entra) y deja abrir cada una. Reutiliza la ventana
    // de listas de las notificaciones.
    async verOfertas(clinicaId, nombre) {
      const etiquetas = { oferta: "💼 Oferta de empleo", suplencia: "🚨 Suplencia", colaboracion: "🤝 Colaboración" };
      try {
        const hoy = new Date().toISOString().slice(0, 10);
        const todas = await utils.request(`/publicaciones?usuario_id=${encodeURIComponent(clinicaId)}&limit=100`);
        const ofertas = (todas || []).filter(p => etiquetas[p.tipo] && (p.tipo !== "suplencia" || !p.fecha_hasta || p.fecha_hasta >= hoy));
        if (!ofertas.length) {
          utils.mostrarAlerta("Esta clínica ya no tiene ofertas activas", "info");
          return;
        }
        this._mapa?.closePopup();
        document.getElementById("interesadosBody").innerHTML = `<div class="lista-simple">` + ofertas.map(p => `
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-bottom:.75rem;">
            <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;">
              <div style="min-width:0;">
                <strong style="color:#0f4c75;">${etiquetas[p.tipo]}</strong>
                <p style="margin:.3rem 0 0;color:#4b5563;font-size:.9rem;">📍 ${esc(p.ciudad || "")}</p>
                ${p.descripcion ? `<p style="margin:.3rem 0 0;color:#4b5563;font-size:.9rem;">${esc(p.descripcion.slice(0, 110))}</p>` : ""}
              </div>
              <button type="button" class="btn-primary btn-small" onclick="app.rutas.abrirPublicacion(${Number(p.id)})">Ver</button>
            </div>
          </div>`).join("") + `</div>`;
        const modal = document.getElementById("modalInteresados");
        modal.querySelector(".modal-header h2").textContent = `Ofertas de ${nombre} (${ofertas.length})`;
        modal.classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // ---------- Dentistas (los ve la clínica) ----------

    _pintarDentistas(data) {
      this._capa.clearLayers();
      const zonas = data.zonas || [];
      const puntos = [];
      for (const z of zonas) {
        const icono = L.divIcon({
          className: "mapa-pin-wrap",
          html: `<div class="mapa-zona"><span>🦷 ${z.total}</span></div>`,
          iconSize: [64, 30],
          iconAnchor: [32, 15],
          popupAnchor: [0, -14]
        });
        L.marker([z.lat, z.lon], { icon: icono, title: z.ciudad })
          .bindPopup(this._popupZona(z), { minWidth: 280, maxWidth: 340 })
          .addTo(this._capa);
        puntos.push([z.lat, z.lon]);
      }
      const total = zonas.reduce((s, z) => s + z.total, 0);
      el("mapaResumen").textContent = !zonas.length
        ? "No hay dentistas con estos filtros."
        : `${plural(total, "dentista", "dentistas")} en ${plural(zonas.length, "localidad", "localidades")}`;
      this._encuadrar(puntos, data.centro, this._radioActivo());
    },

    // Disponibilidad de un dentista en chips: inmediata o desde cuándo, jornada, días de
    // suplencia y semana de colaboración. Es la misma información que su ficha.
    _chipsDisponibilidad(d) {
      const disp = d.disponibilidad;
      const chips = [];
      if (disp.inmediata) chips.push("🟢 Disponible ya");
      else if (disp.desde) chips.push(`📅 Desde el ${utils.formatearFecha(disp.desde)}`);
      if (disp.jornada) chips.push(`⏱️ ${JORNADAS[disp.jornada] || ""}`);
      if (disp.suplencias) chips.push(`🚨 Suplencias: ${plural(disp.suplencias.dias, "día", "días")} (desde el ${utils.formatearDia(disp.suplencias.proxima)})`);
      if (disp.semanal.length) chips.push(`🤝 Semana: ${utils.formatearDiasSemanaCompacto(disp.semanal)}`);
      if (!chips.length) return `<span class="mapa-popup-suave">Sin disponibilidad indicada</span>`;
      return chips.map(c => `<span class="mapa-chip-tipo">${esc(c)}</span>`).join("");
    },

    _filaDentista(d) {
      const id = Number(d.id);
      const pubs = d.publicaciones.map(p => `<button type="button" class="btn-small btn-outline" onclick="app.rutas.abrirPublicacion(${Number(p.id)})">${p.tipo === "solicitud" ? "📝 Solicitud de empleo" : "🤝 Colaboración"}</button>`).join("");
      return `
        <div class="mapa-dentista">
          <div><strong>${esc(d.nombre)}</strong>${d.anyos_experiencia != null ? ` <span class="mapa-popup-suave">· ${plural(d.anyos_experiencia, "año", "años")}</span>` : ""}</div>
          ${d.especialidades.length ? `<div class="mapa-dentista-esp">🦷 ${esc(d.especialidades.join(", "))}</div>` : ""}
          <div class="mapa-chips">${this._chipsDisponibilidad(d)}</div>
          <div class="mapa-popup-acciones">
            <button type="button" class="btn-small btn-primary" onclick="app.perfiles.verDetalle(${id})">Ver perfil</button>
            ${pubs}
          </div>
        </div>`;
    },

    _popupZona(z) {
      return `
        <div class="mapa-popup">
          <h4>Dentistas en ${esc(z.ciudad)} (${z.total})</h4>
          <div class="mapa-popup-dentistas">${z.dentistas.map(d => this._filaDentista(d)).join("")}</div>
          <p class="mapa-popup-suave">📍 Situados en la ciudad, no en su domicilio.</p>
        </div>`;
    }
  };
})();
