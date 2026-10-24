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

  // Filtros comunes (dónde y qué especialidad) y un selector de tipo de trabajo. Cada
  // tipo trae sus propios filtros, justo al lado, con la unidad que le es propia, para
  // que se vea qué casa con qué:
  //   - Empleo: jornada (y, al buscar dentistas, cuándo pueden empezar).
  //   - Suplencia: días del calendario (uno o varios; casa con que coincida alguno).
  //   - Colaboración: un día de la semana y el turno.
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
      <div class="filter-group">
        <label for="mapaTipo" id="mapaTipoLabel">Tipo</label>
        <select id="mapaTipo"></select>
      </div>
      <div id="mapaSubfiltros" class="mapa-subfiltros"></div>
    </div>`;

  // Opciones del selector de tipo. La clínica busca dentistas que buscan ese trabajo; el
  // dentista, clínicas que lo ofrecen. "Todas"/"Todos" es como el listado de la app.
  const TIPOS_DENTISTAS = [["", "Todos los dentistas"], ["oferta", "💼 Empleo"], ["suplencia", "🚨 Suplencias"], ["colaboracion", "🤝 Colaboraciones"]];
  const TIPOS_CLINICAS = [["", "Todas las clínicas"], ["cualquiera", "Con alguna oferta"], ["oferta", "💼 Empleo"], ["suplencia", "🚨 Suplencias"], ["colaboracion", "🤝 Colaboraciones"]];

  const OPC_JORNADA = [["", "Cualquiera"], ["completa", "Completa"], ["parcial", "Parcial"]];
  const OPC_DIA_SEMANA = [["", "Cualquiera"], ["1", "Lunes"], ["2", "Martes"], ["3", "Miércoles"], ["4", "Jueves"], ["5", "Viernes"], ["6", "Sábado"]];
  const NOMBRE_DIA = { 1: "los lunes", 2: "los martes", 3: "los miércoles", 4: "los jueves", 5: "los viernes", 6: "los sábados" };

  // Filtros propios de cada tipo. `param`: nombre en la API. El turno habla de los que
  // salen en el mapa: en Clínicas, el que NECESITA la colaboración (tal cual lo pide); en
  // Dentistas, el que PUEDE hacer el dentista (uno de "mañana y tarde" cubre cualquiera).
  const SUBFILTROS = {
    dentistas: {
      oferta: [
        { id: "mapaIncorporacion", tipo: "select", label: "Incorporación", opciones: [["", "Cualquiera"], ["inmediata", "Inmediata"], ["fecha", "En una fecha"]] },
        { id: "mapaFecha", tipo: "fecha", label: "Pueden empezar el", title: "Pueden empezar ese día o antes", soloSi: () => el("mapaIncorporacion").value === "fecha" },
        { id: "mapaJornada", param: "jornada", tipo: "select", label: "Jornada", opciones: OPC_JORNADA }
      ],
      suplencia: [
        { id: "mapaDias", param: "fechas", tipo: "dias", label: "Días de la suplencia", title: "Dentistas que han marcado alguno de estos días para suplencias" }
      ],
      colaboracion: [
        { id: "mapaDiaSemana", param: "diaSemana", tipo: "select", label: "Día de la semana", opciones: OPC_DIA_SEMANA },
        { id: "mapaTurno", param: "turno", tipo: "select", label: "Turno que puedes hacer", opciones: [["", "Cualquiera"], ["manana", "Mañana"], ["tarde", "Tarde"], ["ambos", "Mañana y tarde"]] }
      ]
    },
    clinicas: {
      oferta: [
        { id: "mapaJornada", param: "jornada", tipo: "select", label: "Jornada", opciones: OPC_JORNADA }
      ],
      suplencia: [
        { id: "mapaDias", param: "fechas", tipo: "dias", label: "Días de la suplencia", title: "Suplencias que incluyen alguno de estos días" },
        { id: "mapaMiDisp", param: "miDisponibilidad", tipo: "check", label: "Solo en mis días disponibles", soloDentista: true,
          title: "Suplencias con algún día que tienes marcado en Mi perfil → Disponibilidad" }
      ],
      colaboracion: [
        { id: "mapaDiaSemana", param: "diaSemana", tipo: "select", label: "Día de la semana", opciones: OPC_DIA_SEMANA },
        { id: "mapaTurno", param: "turno", tipo: "select", label: "Turno que necesitas", opciones: [["", "Cualquiera"], ["manana", "Mañana"], ["tarde", "Tarde"], ["ambos", "Mañana y tarde"]] },
        { id: "mapaMiDisp", param: "miDisponibilidad", tipo: "check", label: "Solo en mi semana disponible", soloDentista: true,
          title: "Colaboraciones que caen en tu disponibilidad semanal (Mi perfil → Disponibilidad)" }
      ]
    }
  };

  // "el 24 oct", "el 24 oct o el 25 oct", "alguno de 5 días (del 24 oct al 2 nov)"
  function textoDias(dias) {
    const f = (d) => `el ${utils.formatearDia(d)}`;
    if (dias.length <= 3) return dias.length === 1 ? f(dias[0]) : `${dias.slice(0, -1).map(f).join(", ")} o ${f(dias[dias.length - 1])}`;
    return `alguno de ${dias.length} días (del ${utils.formatearDia(dias[0])} al ${utils.formatearDia(dias[dias.length - 1])})`;
  }

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
        ["mapaRadio", "mapaEspecialidad"].forEach(id => el(id).addEventListener("change", recargar));
        el("mapaTipo").addEventListener("change", () => { this._pintarSubfiltros(); recargar(); });
        // Los filtros del tipo se crean y destruyen al cambiar de tipo: se escuchan aquí
        el("mapaSubfiltros").addEventListener("change", () => { this._mostrarSubfiltros(); recargar(); });
        // El desplegable de días se cierra al pinchar fuera. Se mira la ruta del evento y
        // no el destino: el calendario se repinta al marcar un día y el destino queda suelto.
        document.addEventListener("click", (e) => {
          const panel = el("mapaDiasPanel");
          if (panel && !panel.hidden && !e.composedPath().includes(el("mapaDiasGrupo"))) panel.hidden = true;
        });
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
      el("mapaTipoLabel").textContent = clinicas ? "Ofrecen" : "Buscan";
      const tipoAntes = el("mapaTipo").value;
      const tipos = clinicas ? TIPOS_CLINICAS : TIPOS_DENTISTAS;
      el("mapaTipo").innerHTML = tipos.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
      if (tipos.some(([v]) => v === tipoAntes)) el("mapaTipo").value = tipoAntes;
      el("mapaLeyenda").innerHTML = clinicas
        ? `<span><i class="mapa-chip mapa-chip-registrada"></i> Clínica sin ofertas</span>
           <span><i class="mapa-chip mapa-chip-oferta"></i> Clínica con ofertas (el número son las que encajan con los filtros)</span>`
        : `<span><i class="mapa-chip mapa-chip-zona"></i> Dentistas en la localidad (el número es el total)</span>
           <span>Se sitúan en su ciudad: nunca se muestra su dirección.</span>`;
      this._pintarSubfiltros();
    },

    // Filtros del tipo elegido, al lado del selector. Se crean de nuevo (vacíos) al
    // cambiar de tipo o de modo: los de otro tipo no tienen sentido y no deben filtrar.
    _subfiltros() {
      const lista = (SUBFILTROS[this.modo] || {})[el("mapaTipo").value] || [];
      // "Mi disponibilidad" es la del dentista que mira: una clínica no tiene
      return lista.filter(f => !f.soloDentista || (!this._esClinica() && estadoApp.usuario));
    },

    _pintarSubfiltros() {
      const hoy = new Date().toISOString().slice(0, 10);
      el("mapaSubfiltros").innerHTML = this._subfiltros().map(f => {
        const title = f.title ? ` title="${esc(f.title)}"` : "";
        if (f.tipo === "dias") {
          return `<div class="filter-group mapa-dias" id="${f.id}Grupo">
            <label for="mapaDiasBtn">${esc(f.label)}</label>
            <button type="button" id="mapaDiasBtn" class="mapa-dias-btn"${title} onclick="app.mapa.abrirDias()">Cualquier día</button>
            <div id="mapaDiasPanel" class="mapa-dias-panel" hidden>
              <p class="mapa-dias-ayuda">Marca uno o varios días. Salen ${this.modo === "clinicas" ? "las suplencias que incluyen" : "los dentistas libres"} alguno de ellos.</p>
              <div id="mapaDiasCal"></div>
              <div class="mapa-dias-acciones">
                <button type="button" class="btn-small btn-outline" onclick="app.mapa.borrarDias()">Borrar</button>
                <button type="button" class="btn-small btn-primary" onclick="app.mapa.cerrarDias()">Listo</button>
              </div>
            </div>
          </div>`;
        }
        if (f.tipo === "check") {
          return `<div class="filter-group mapa-check" id="${f.id}Grupo">
            <label${title}><input id="${f.id}" type="checkbox"> <span>${esc(f.label)}</span></label></div>`;
        }
        const control = f.tipo === "fecha"
          ? `<input id="${f.id}" type="date" min="${hoy}"${title}>` // un día pasado no sirve para buscar
          : `<select id="${f.id}"${title}>${f.opciones.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select>`;
        return `<div class="filter-group" id="${f.id}Grupo"><label for="${f.id}">${esc(f.label)}</label>${control}</div>`;
      }).join("");
      if (el("mapaDiasCal")) {
        app.calendario.crear("mapaDiasCal", { seleccion: [], onChange: () => { this._pintarBotonDias(); this.cargar(); } });
      }
      this._mostrarSubfiltros();
    },

    // ---- Días de la suplencia (calendario de selección múltiple en un desplegable) ----
    _diasElegidos() {
      return el("mapaDiasCal") ? app.calendario.obtener("mapaDiasCal") : [];
    },

    _pintarBotonDias() {
      const dias = this._diasElegidos();
      el("mapaDiasBtn").textContent = !dias.length ? "Cualquier día"
        : dias.length <= 3 ? dias.map(d => utils.formatearDia(d)).join(", ")
        : `${dias.length} días (${utils.formatearDia(dias[0])} – ${utils.formatearDia(dias[dias.length - 1])})`;
    },

    abrirDias() {
      const panel = el("mapaDiasPanel");
      panel.hidden = !panel.hidden;
      if (panel.hidden) return;
      // Que quepa en pantalla: si se sale por la derecha (filtro en la última columna),
      // se desplaza a la izquierda, sin salirse tampoco por ese lado
      panel.style.left = "0px";
      const margen = 16;
      const r = panel.getBoundingClientRect();
      const grupo = el("mapaDiasGrupo").getBoundingClientRect();
      const desplazamiento = Math.max(Math.min(0, window.innerWidth - margen - r.right), margen - grupo.left);
      panel.style.left = `${desplazamiento}px`;
    },

    cerrarDias() {
      el("mapaDiasPanel").hidden = true;
    },

    borrarDias() {
      app.calendario.fijar("mapaDiasCal", []);
      this._pintarBotonDias();
      this.cargar();
    },

    // Los que dependen de otro (la fecha de incorporación, de "En una fecha")
    _mostrarSubfiltros() {
      for (const f of this._subfiltros()) {
        if (!f.soloSi) continue;
        const ver = f.soloSi();
        el(`${f.id}Grupo`).style.display = ver ? "" : "none";
        if (!ver) el(f.id).value = "";
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
      if (el("mapaTipo").value) p.set("tipo", el("mapaTipo").value);
      for (const f of this._subfiltros()) {
        const control = el(f.id);
        if (f.tipo === "dias") { if (this._diasElegidos().length) p.set(f.param, this._diasElegidos().join(",")); }
        else if (f.tipo === "check") { if (control.checked) p.set(f.param, "1"); }
        else if (f.param && control.value) p.set(f.param, control.value);
      }
      // Incorporación inmediata = pueden empezar hoy
      if (el("mapaIncorporacion")?.value === "inmediata") p.set("fecha", new Date().toISOString().slice(0, 10));
      if (el("mapaIncorporacion")?.value === "fecha" && el("mapaFecha").value) p.set("fecha", el("mapaFecha").value);
      return p.toString();
    },

    // Lo que se está buscando, dicho en una frase: "con suplencias el 26 oct",
    // "que buscan colaboraciones los lunes de tarde"
    _contextoFiltros(n) {
      const tipo = el("mapaTipo").value;
      const v = (id) => el(id)?.value || "";
      const varios = n !== 1;
      const partes = [];
      if (v("mapaJornada")) partes.push(`de jornada ${v("mapaJornada")}`);
      const dias = this._diasElegidos();
      if (dias.length) partes.push(`que ${varios ? "incluyen" : "incluye"} ${textoDias(dias)}`);
      if (v("mapaDiaSemana")) partes.push(NOMBRE_DIA[v("mapaDiaSemana")]);
      if (v("mapaTurno")) partes.push(`de ${utils.NOMBRES_TURNO[v("mapaTurno")]}`);
      if (el("mapaMiDisp")?.checked) partes.push(varios ? "que encajan con tu disponibilidad" : "que encaja con tu disponibilidad");
      const detalle = partes.length ? ` ${partes.join(" ")}` : "";

      if (this.modo === "clinicas") {
        const que = { cualquiera: "con ofertas", oferta: "con ofertas de empleo", suplencia: "con suplencias", colaboracion: "con colaboraciones" }[tipo];
        return que ? ` ${que}${detalle}` : " en el mapa";
      }
      const busca = varios ? "buscan" : "busca";
      if (tipo === "oferta") {
        const cuando = v("mapaIncorporacion") === "inmediata" ? " con incorporación inmediata"
          : (v("mapaFecha") ? `, ${varios ? "pueden" : "puede"} empezar el ${utils.formatearDia(v("mapaFecha"))}` : "");
        return ` que ${busca} empleo${detalle}${cuando}`;
      }
      if (tipo === "suplencia") {
        return dias.length
          ? ` ${varios ? "libres" : "libre"} para suplencias ${textoDias(dias)}`
          : ` que ${busca} suplencias`;
      }
      if (tipo === "colaboracion") return ` que ${busca} colaboraciones${detalle}`;
      return "";
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
          .on("click", () => this._abrirClinica(c))
          .addTo(this._capa);
        puntos.push([c.lat, c.lon]);
      }
      el("mapaResumen").textContent = clinicas.length
        ? `${plural(clinicas.length, "clínica", "clínicas")}${this._contextoFiltros(clinicas.length)}`
        : (el("mapaMiDisp")?.checked
          ? "Ninguna clínica encaja con tu disponibilidad. ¿La tienes marcada en Mi perfil → Disponibilidad?"
          : "No hay clínicas con estos filtros.");
      this._encuadrar(puntos, data.centro, this._radioActivo());
    },

    // La clínica de un punto, con la misma tarjeta que el listado "Clínicas"
    // (app.perfiles.tarjetaHtml), más la sede, si la ubicación es aproximada y "Cómo
    // llegar". Sus apartados cuentan lo de este punto que casa con los filtros. En una
    // ventana, igual que los dentistas: en un popup la tarjeta entera no cabe.
    _abrirClinica(c) {
      const ciudad = c.ciudad && c.provincia ? `${c.ciudad} (${c.provincia})` : c.ciudad;
      const lugar = [c.sede_nombre && c.sede_nombre !== c.nombre ? c.sede_nombre : null, ciudad].filter(Boolean).join(" · ");
      const aproximada = c.precision === "ciudad"
        ? `<p class="mapa-popup-suave" style="margin:0 0 1rem;">📍 Ubicación aproximada (centro de la localidad)</p>`
        : (c.precision === "calle" ? `<p class="mapa-popup-suave" style="margin:0 0 1rem;">📍 Ubicación aproximada (a nivel de calle)</p>` : "");
      this._ventana(c.nombre, `<div class="publicaciones publicaciones-en-modal">${app.perfiles.tarjetaHtml(c, {
        lugar,
        extraHtml: aproximada,
        accionesExtra: `<a class="btn-outline mapa-boton-enlace" href="${urlComoLlegar(c.lat, c.lon)}" target="_blank" rel="noopener noreferrer">📍 Cómo llegar</a>`
      })}</div>`);
    },

    _ventana(titulo, html) {
      document.getElementById("interesadosBody").innerHTML = html;
      const modal = document.getElementById("modalInteresados");
      modal.querySelector(".modal-header h2").textContent = titulo;
      modal.classList.add("active");
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
          .on("click", () => this._abrirZona(z))
          .addTo(this._capa);
        puntos.push([z.lat, z.lon]);
      }
      const total = zonas.reduce((s, z) => s + z.total, 0);
      el("mapaResumen").textContent = !zonas.length
        ? "No hay dentistas con estos filtros."
        : `${plural(total, "dentista", "dentistas")}${this._contextoFiltros(total)} en ${plural(zonas.length, "localidad", "localidades")}`;
      this._encuadrar(puntos, data.centro, this._radioActivo());
    },

    // Los dentistas de una localidad, con la misma tarjeta que el listado "Dentistas"
    // (app.perfiles.tarjetaHtml), en una ventana como las clínicas. Primero los que tienen libres más días de
    // los elegidos.
    _abrirZona(z) {
      const dias = this._diasElegidos();
      const dentistas = [...z.dentistas]
        .sort((a, b) => (b.disponibilidad?.suplencias?.coinciden?.length || 0) - (a.disponibilidad?.suplencias?.coinciden?.length || 0));
      this._ventana(`Dentistas en ${z.ciudad} (${z.total})`, `
        <p class="mapa-popup-suave" style="margin:0 0 1rem;">📍 Situados en la ciudad, no en su domicilio.</p>
        <div class="publicaciones publicaciones-en-modal">${dentistas.map(d => app.perfiles.tarjetaHtml(d, { diasElegidos: dias })).join("")}</div>`);
    }
  };
})();
