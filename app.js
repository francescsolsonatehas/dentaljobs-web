// URL del backend: definida en config.js (vacía = mismo origen)
const API = window.API_URL || "";

let estadoApp = {
  token: localStorage.getItem("token"),
  usuario: localStorage.getItem("usuario") ? JSON.parse(localStorage.getItem("usuario")) : null,
  tipoUsuario: localStorage.getItem("tipoUsuario"), // 'clinica' o 'dentista'
  publicaciones: [],
  paginaActual: 1,
  hayMasPublicaciones: false,
  especialidades: [],
  archivosUsuario: [],
  filtros: {
    tipo: "",
    ciudad: "",
    especialidad: "",
    contrato: "",
    jornada: "",
    soloMias: false,
    contactadas: false
  },
  publicacionActual: null,
  vistaActual: "publicaciones", // vista visible del listado (determina qué exporta el CSV)
  perfilContactoActual: null // perfil al que se está enviando una solicitud de contacto
};

// ============================================
// Módulo: Utilidades
// ============================================

const utils = {
  // El token caduca a los 7 días (ver backend/middleware/auth.js). Cuando eso pasa,
  // el backend responde 401 a todo lo autenticado. Sin este manejo el usuario se
  // queda "conectado" en apariencia mientras cada petición falla en silencio: las
  // pantallas se quedan vacías sin explicar por qué.
  //
  // Solo aplica si TENÍAMOS sesión: un 401 sin token es otra cosa (acceso anónimo a
  // algo protegido) y no debe echar a nadie. El flag evita que varias peticiones en
  // paralelo disparen varios avisos y varios logout a la vez.
  sesionCaducada() {
    if (!estadoApp.token || utils._cerrandoSesionCaducada) return;
    utils._cerrandoSesionCaducada = true;
    app.auth.logout("Tu sesión ha caducado. Vuelve a iniciar sesión.");
    setTimeout(() => { utils._cerrandoSesionCaducada = false; }, 1000);
  },

  // Variante tolerante a fallos para datos de adorno (contadores del panel): si la
  // petición falla devuelve null en vez de propagar. Las tarjetas se pintan igual y
  // la que no tiene dato muestra "—". Antes se pedían con `await` encadenados y sin
  // red: una sola que fallara abortaba el render y el panel entero quedaba en blanco.
  async requestOpcional(endpoint) {
    try {
      return await utils.request(endpoint);
    } catch {
      return null;
    }
  },

  // Cifra de una tarjeta de estadística. Si el dato no llegó, "—" (no 0: sería
  // mentir diciendo que hay cero cuando lo que hay es un fallo).
  cifra(respuesta, campo = "total") {
    const valor = respuesta?.[campo];
    return typeof valor === "number" ? valor : "—";
  },

  async request(endpoint, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...options.headers
    };

    if (estadoApp.token) {
      headers.Authorization = `Bearer ${estadoApp.token}`;
    }

    // Si la respuesta tarda (arranque en frío del servidor gratuito), avisar
    const avisoLento = setTimeout(() => {
      if (!utils._avisoDespertarMostrado) {
        utils._avisoDespertarMostrado = true;
        utils.mostrarAlerta("⏳ Despertando el servidor… puede tardar unos segundos", "info");
        setTimeout(() => { utils._avisoDespertarMostrado = false; }, 60000);
      }
    }, 3000);

    try {
      const response = await fetch(API + endpoint, {
        ...options,
        headers
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) utils.sesionCaducada();
        throw new Error(data.error || "Error en la solicitud");
      }

      return data;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      clearTimeout(avisoLento);
    }
  },

  async requestForm(endpoint, formData) {
    const headers = {};
    if (estadoApp.token) {
      headers.Authorization = `Bearer ${estadoApp.token}`;
    }

    try {
      const response = await fetch(API + endpoint, {
        method: "POST",
        headers,
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) utils.sesionCaducada();
        throw new Error(data.error || "Error en la solicitud");
      }

      return data;
    } catch (error) {
      console.error(error);
      throw error;
    }
  },

  mostrarAlerta(mensaje, tipo = "info") {
    const alertaDiv = document.createElement("div");
    alertaDiv.className = `alert alert-${tipo}`;
    alertaDiv.textContent = mensaje;
    document.body.insertBefore(alertaDiv, document.body.firstChild);

    setTimeout(() => alertaDiv.remove(), 4000);
  },

  formatearFecha(fecha) {
    const date = new Date(fecha);
    return date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
  },

  // Formatea un día 'YYYY-MM-DD' como "14 ago" (sin desfases de zona horaria)
  formatearDia(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso || "");
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  },

  // Expande un rango 'YYYY-MM-DD' a la lista de días (ambos incluidos). Espejo
  // cliente de backend/fechas.js expandirRango, con tope de seguridad.
  expandirRango(desde, hasta) {
    if (!desde) return [];
    const fin = hasta || desde;
    if (fin < desde) return [desde];
    const dias = [];
    let d = new Date(desde + "T00:00:00");
    const limite = new Date(fin + "T00:00:00");
    let guard = 0;
    while (d <= limite && guard < 366) {
      dias.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
      d.setDate(d.getDate() + 1);
      guard++;
    }
    return dias;
  },

  formatearTamanyo(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  },

  ordenarPorCiudadYEspecialidad(items) {
    return items.sort((a, b) => {
      const ciudadA = (a.ciudad || '').toLowerCase();
      const ciudadB = (b.ciudad || '').toLowerCase();
      if (ciudadA !== ciudadB) {
        return ciudadA.localeCompare(ciudadB);
      }
      const espA = (a.especialidades || '').toLowerCase();
      const espB = (b.especialidades || '').toLowerCase();
      return espA.localeCompare(espB);
    });
  },

  ordenarPorCiudadFechaEspecialidadSalario(items) {
    return items.sort((a, b) => {
      const ciudadA = (a.ciudad || '').toLowerCase();
      const ciudadB = (b.ciudad || '').toLowerCase();
      if (ciudadA !== ciudadB) {
        return ciudadA.localeCompare(ciudadB);
      }
      const fechaA = new Date(a.creado_en || 0);
      const fechaB = new Date(b.creado_en || 0);
      if (fechaA.getTime() !== fechaB.getTime()) {
        return fechaB - fechaA;
      }
      const espA = (a.especialidad_id || 0);
      const espB = (b.especialidad_id || 0);
      if (espA !== espB) {
        return espA - espB;
      }
      const salarioA = parseFloat(a.salario) || 0;
      const salarioB = parseFloat(b.salario) || 0;
      return salarioB - salarioA;
    });
  },

  escapeJsonForHtml(obj) {
    return JSON.stringify(obj).replace(/"/g, '&quot;');
  },

  // Color y etiqueta de cada estado de candidatura
  colorEstado(estado) {
    return {
      pendiente: '#f59e0b',
      vista: '#6366f1',
      en_proceso: '#0ea5e9',
      entrevista: '#8b5cf6',
      aceptada: '#10b981',
      rechazada: '#ef4444',
      retirada: '#9ca3af'
    }[estado] || '#9ca3af';
  },

  textoEstado(estado) {
    return {
      pendiente: 'Pendiente',
      vista: 'CV visto',
      en_proceso: 'En proceso',
      entrevista: 'Entrevista',
      aceptada: 'Aceptada',
      rechazada: 'Rechazada',
      retirada: 'Retirada'
    }[estado] || estado;
  },

  // Selector de estado que usan las clínicas en las listas de candidatos
  selectorEstado(candidaturaId, estadoActual, onchangeJs) {
    const opciones = ['pendiente', 'vista', 'en_proceso', 'entrevista', 'aceptada', 'rechazada'];
    return `
      <select onchange="${onchangeJs}" style="padding: 0.4rem 0.6rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem; cursor: pointer;">
        ${opciones.map(e => `<option value="${e}" ${e === estadoActual ? 'selected' : ''}>${utils.textoEstado(e)}</option>`).join('')}
      </select>
    `;
  },

  // Línea de tiempo del progreso de una candidatura, pensada para el candidato.
  // Muestra las etapas Enviada → CV visto → En proceso → Entrevista → Aceptada,
  // resaltando hasta dónde ha llegado. Si fue rechazada o retirada, cierra en rojo/gris.
  lineaTiempoCandidatura(estado, actualizadoEn) {
    const etapas = [
      { clave: 'pendiente', etiqueta: 'Enviada', icono: '📨' },
      { clave: 'vista', etiqueta: 'CV visto', icono: '👁️' },
      { clave: 'en_proceso', etiqueta: 'En proceso', icono: '⚙️' },
      { clave: 'entrevista', etiqueta: 'Entrevista', icono: '🤝' },
      { clave: 'aceptada', etiqueta: 'Aceptada', icono: '🎉' }
    ];
    const orden = { pendiente: 0, vista: 1, en_proceso: 2, entrevista: 3, aceptada: 4 };
    const terminal = estado === 'rechazada' || estado === 'retirada';

    // En estados terminales, el índice alcanzado es hasta donde tenga sentido
    // (rechazada/retirada no avanzan por las etapas, así que solo marcamos "Enviada").
    const indiceActual = terminal ? 0 : (orden[estado] ?? 0);
    const verde = '#10b981';
    const gris = '#d1d5db';
    const grisTexto = '#9ca3af';

    let pasos = etapas.map((etapa, i) => {
      const alcanzada = i <= indiceActual;
      const esActual = i === indiceActual && !terminal;
      const color = alcanzada ? verde : gris;
      const conector = i < etapas.length - 1
        ? `<div style="flex: 1; height: 3px; background: ${i < indiceActual ? verde : gris}; min-width: 12px;"></div>`
        : '';
      return `
        <div style="display: flex; align-items: center; flex: ${i < etapas.length - 1 ? '1' : '0 0 auto'};">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 0.3rem; flex: 0 0 auto;">
            <div style="width: 34px; height: 34px; border-radius: 50%; background: ${alcanzada ? color : 'white'}; border: 2px solid ${color}; display: flex; align-items: center; justify-content: center; font-size: 1rem; ${esActual ? 'box-shadow: 0 0 0 4px rgba(16,185,129,0.2);' : ''}">${alcanzada ? etapa.icono : ''}</div>
            <span style="font-size: 0.7rem; font-weight: ${esActual ? '700' : '500'}; color: ${alcanzada ? '#065f46' : grisTexto}; text-align: center; white-space: nowrap;">${etapa.etiqueta}</span>
          </div>
          ${conector}
        </div>`;
    }).join('');

    let cierreTerminal = '';
    if (terminal) {
      const color = estado === 'rechazada' ? '#ef4444' : '#9ca3af';
      const icono = estado === 'rechazada' ? '✕' : '↩';
      const etiqueta = estado === 'rechazada' ? 'No seleccionada' : 'Retirada';
      cierreTerminal = `
        <div style="display: flex; align-items: center; flex: 0 0 auto;">
          <div style="flex: 1; height: 3px; background: ${color}; min-width: 12px;"></div>
          <div style="display: flex; flex-direction: column; align-items: center; gap: 0.3rem;">
            <div style="width: 34px; height: 34px; border-radius: 50%; background: ${color}; border: 2px solid ${color}; display: flex; align-items: center; justify-content: center; font-size: 1rem; color: white; box-shadow: 0 0 0 4px ${estado === 'rechazada' ? 'rgba(239,68,68,0.2)' : 'rgba(156,163,175,0.2)'};">${icono}</div>
            <span style="font-size: 0.7rem; font-weight: 700; color: ${color}; white-space: nowrap;">${etiqueta}</span>
          </div>
        </div>`;
    }

    const fecha = actualizadoEn ? utils.formatearFecha(actualizadoEn) : '';
    return `
      <div style="margin: 0.5rem 0;">
        <div style="display: flex; align-items: flex-start; overflow-x: auto; padding: 0.5rem 0.25rem;">
          ${pasos}${cierreTerminal}
        </div>
        ${fecha ? `<p style="margin: 0.25rem 0 0 0; font-size: 0.72rem; color: #9ca3af;">Última actualización: ${fecha}</p>` : ''}
      </div>`;
  },

  escapeHtml(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // Bloque con las respuestas de criba de una candidatura (JSON [{pregunta,respuesta}]).
  respuestasCribaHtml(raw) {
    let arr = [];
    try { arr = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : []; } catch (e) { return ''; }
    if (!Array.isArray(arr) || arr.length === 0) return '';
    return `<div style="margin: 0.5rem 0 0 0; padding: 0.75rem; background: #ecfdf5; border-radius: 6px; border-left: 3px solid #10b981;">
      <p style="margin: 0 0 0.5rem 0; font-size: 0.8rem; font-weight: 600; color: #065f46;">📋 Respuestas de criba</p>
      ${arr.map(r => `<div style="margin-bottom: 0.5rem;">
        <p style="margin: 0; font-size: 0.82rem; color: #047857; font-weight: 600;">${utils.escapeHtml(r.pregunta)}</p>
        <p style="margin: 0; font-size: 0.88rem; color: #374151; white-space: pre-wrap;">${utils.escapeHtml(r.respuesta)}</p>
      </div>`).join('')}
    </div>`;
  },

  ocultarElementos(...ids) {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }
};

// ============================================
// Módulo: Landing
// ============================================

const app = {
  landing: {
    seleccionarTipo(tipo) {
      if (tipo === 'empresa') {
        app.modal.abrirAuthEmpresa();
      } else {
        app.modal.abrirAuthCandidato();
      }
    }
  },

  // ============================================
  // Módulo: Calendario de días (widget reutilizable)
  // Rejilla mensual donde el usuario marca/desmarca días. Lo usan el alta de
  // suplencia (días que cubre) y la disponibilidad del dentista. Cada instancia
  // se identifica por el id del contenedor donde se pinta.
  // ============================================

  calendario: {
    _inst: {},
    NOMBRES_MES: ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"],
    DIAS_SEMANA: ["L","M","X","J","V","S","D"],

    hoyISO() {
      const h = new Date();
      return `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,"0")}-${String(h.getDate()).padStart(2,"0")}`;
    },

    // Crea (o reinicia) una instancia en `containerId`. `seleccion` es un array de
    // días 'YYYY-MM-DD'; `onChange(dias)` se llama en cada cambio.
    crear(containerId, { seleccion = [], onChange } = {}) {
      const base = seleccion.length ? new Date(seleccion.slice().sort()[0] + "T00:00:00") : new Date();
      this._inst[containerId] = {
        seleccion: new Set(seleccion),
        anyo: base.getFullYear(),
        mes: base.getMonth(),
        onChange: onChange || (() => {})
      };
      this.render(containerId);
    },

    obtener(containerId) {
      return [...(this._inst[containerId]?.seleccion || [])].sort();
    },

    fijar(containerId, dias) {
      const inst = this._inst[containerId];
      if (!inst) return;
      inst.seleccion = new Set(dias);
      this.render(containerId);
    },

    cambiarMes(containerId, delta) {
      const inst = this._inst[containerId];
      if (!inst) return;
      let m = inst.mes + delta;
      inst.anyo += Math.floor(m / 12);
      inst.mes = ((m % 12) + 12) % 12;
      this.render(containerId);
    },

    toggle(containerId, fecha) {
      const inst = this._inst[containerId];
      if (!inst) return;
      if (inst.seleccion.has(fecha)) inst.seleccion.delete(fecha);
      else inst.seleccion.add(fecha);
      inst.onChange([...inst.seleccion].sort());
      this.render(containerId);
    },

    render(containerId) {
      const inst = this._inst[containerId];
      const cont = document.getElementById(containerId);
      if (!inst || !cont) return;

      const { anyo, mes, seleccion } = inst;
      const hoy = this.hoyISO();
      const primero = new Date(anyo, mes, 1);
      // getDay(): 0=domingo..6=sábado → convertir a semana que empieza en lunes
      const offset = (primero.getDay() + 6) % 7;
      const diasEnMes = new Date(anyo, mes + 1, 0).getDate();

      let celdas = "";
      for (let i = 0; i < offset; i++) celdas += `<div class="cal-celda cal-vacia"></div>`;
      for (let d = 1; d <= diasEnMes; d++) {
        const fecha = `${anyo}-${String(mes+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        const pasado = fecha < hoy;
        const sel = seleccion.has(fecha);
        const clases = ["cal-celda", "cal-dia"];
        if (sel) clases.push("cal-sel");
        if (pasado) clases.push("cal-pasado");
        const onclick = pasado ? "" : ` onclick="app.calendario.toggle('${containerId}','${fecha}')"`;
        celdas += `<div class="${clases.join(" ")}"${onclick}>${d}</div>`;
      }

      const total = seleccion.size;
      cont.innerHTML = `
        <div class="cal-widget">
          <div class="cal-cabecera">
            <button type="button" class="cal-nav" onclick="app.calendario.cambiarMes('${containerId}',-1)">‹</button>
            <strong>${this.NOMBRES_MES[mes]} ${anyo}</strong>
            <button type="button" class="cal-nav" onclick="app.calendario.cambiarMes('${containerId}',1)">›</button>
          </div>
          <div class="cal-rejilla cal-semana">${this.DIAS_SEMANA.map(x => `<div class="cal-celda cal-nombre-dia">${x}</div>`).join("")}</div>
          <div class="cal-rejilla">${celdas}</div>
          <p class="cal-resumen">${total === 0 ? "Ningún día seleccionado" : `${total} día${total===1?"":"s"} seleccionado${total===1?"":"s"}`}</p>
        </div>`;
    }
  },

  // ============================================
  // Módulo: Disponibilidad del dentista para suplencias
  // ============================================

  disponibilidad: {
    async cargar() {
      try {
        const data = await utils.request("/disponibilidad");
        app.calendario.crear("disponibilidadCalendario", { seleccion: data.dias || [] });
        const sel = document.getElementById("radioDesplazamiento");
        // radio_km null = por defecto: se muestra el valor sugerido por el backend
        if (sel) sel.value = String(data.radio_km != null ? data.radio_km : (data.radio_km_defecto ?? 25));
      } catch (error) {
        app.calendario.crear("disponibilidadCalendario", { seleccion: [] });
      }
    },

    async guardar() {
      const dias = app.calendario.obtener("disponibilidadCalendario");
      const sel = document.getElementById("radioDesplazamiento");
      const radio_km = sel ? parseInt(sel.value) : NaN;
      try {
        await utils.request("/disponibilidad", {
          method: "PUT",
          body: JSON.stringify({ dias, ...(Number.isNaN(radio_km) ? {} : { radio_km }) })
        });
        utils.mostrarAlerta(dias.length ? `Disponibilidad guardada (${dias.length} día${dias.length === 1 ? "" : "s"})` : "Disponibilidad vaciada", "success");
        app.modal.cerrarPerfil();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Vista de calendario mensual de suplencias
  // ============================================

  suplenciasCalendario: {
    anyo: null,
    mes: null, // 1-12

    verCalendario() {
      if (this.anyo == null) {
        const hoy = new Date();
        this.anyo = hoy.getFullYear();
        this.mes = hoy.getMonth() + 1;
      }
      document.getElementById("publicacionesContainer").style.display = "none";
      document.getElementById("suplenciasCalendarioContainer").style.display = "block";
      document.getElementById("btnVistaCalendario").classList.add("active");
      document.getElementById("btnVistaLista").classList.remove("active");
      this.render();
    },

    verLista() {
      document.getElementById("suplenciasCalendarioContainer").style.display = "none";
      document.getElementById("publicacionesContainer").style.display = "";
      document.getElementById("btnVistaLista").classList.add("active");
      document.getElementById("btnVistaCalendario").classList.remove("active");
      app.publicaciones.cargar();
    },

    cambiarMes(delta) {
      let m = (this.mes - 1) + delta;
      this.anyo += Math.floor(m / 12);
      this.mes = ((m % 12) + 12) % 12 + 1;
      this.render();
    },

    // Clic en un día con suplencias: pasa a la lista filtrada por esa fecha
    irADia(fecha) {
      document.getElementById("filterFechaDesde").value = fecha;
      document.getElementById("filterFechaHasta").value = fecha;
      this.verLista();
    },

    async render() {
      const cont = document.getElementById("suplenciasCalendarioContainer");
      if (!cont) return;
      cont.innerHTML = `<p style="color:#6b7280;padding:1rem;">Cargando calendario…</p>`;

      let dias = {};
      try {
        const data = await utils.request(`/suplencias/calendario?anyo=${this.anyo}&mes=${this.mes}`);
        dias = data.dias || {};
      } catch (e) {
        cont.innerHTML = `<p style="color:#ef4444;padding:1rem;">No se pudo cargar el calendario.</p>`;
        return;
      }

      const hoy = app.calendario.hoyISO();
      const primero = new Date(this.anyo, this.mes - 1, 1);
      const offset = (primero.getDay() + 6) % 7; // semana que empieza en lunes
      const diasEnMes = new Date(this.anyo, this.mes, 0).getDate();

      let celdas = "";
      for (let i = 0; i < offset; i++) celdas += `<div class="cal-celda cal-vacia"></div>`;
      for (let d = 1; d <= diasEnMes; d++) {
        const fecha = `${this.anyo}-${String(this.mes).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        const items = dias[fecha] || [];
        const pasado = fecha < hoy;
        if (items.length > 0 && !pasado) {
          const hayUrgente = items.some(x => x.urgente);
          const ciudades = [...new Set(items.map(x => x.ciudad).filter(Boolean))].join(", ");
          celdas += `<div class="supcal-dia${hayUrgente ? " supcal-urgente" : ""}" title="${utils.escapeHtml(ciudades)}" onclick="app.suplenciasCalendario.irADia('${fecha}')">
            <span class="supcal-num">${d}</span>
            <span class="supcal-badge">${items.length}</span>
          </div>`;
        } else {
          celdas += `<div class="cal-celda supcal-vacio${pasado ? " cal-pasado" : ""}">${d}</div>`;
        }
      }

      cont.innerHTML = `
        <div class="supcal-widget">
          <div class="cal-cabecera">
            <button type="button" class="cal-nav" onclick="app.suplenciasCalendario.cambiarMes(-1)">‹</button>
            <strong>${app.calendario.NOMBRES_MES[this.mes - 1]} ${this.anyo}</strong>
            <button type="button" class="cal-nav" onclick="app.suplenciasCalendario.cambiarMes(1)">›</button>
          </div>
          <div class="cal-rejilla cal-semana">${app.calendario.DIAS_SEMANA.map(x => `<div class="cal-celda cal-nombre-dia">${x}</div>`).join("")}</div>
          <div class="cal-rejilla">${celdas}</div>
          <p class="cal-resumen">Haz clic en un día para ver sus suplencias. En rojo, los días con alguna urgente.</p>
        </div>`;
    }
  },

  // ============================================
  // Módulo: Suplencias (matching de dentistas disponibles)
  // ============================================

  suplencias: {
    // Muestra los dentistas cuya disponibilidad, ciudad y especialidad casan con
    // esta suplencia (solo lo ve la clínica dueña).
    async verDisponibles(pubId, titulo) {
      const body = document.getElementById("disponiblesBody");
      document.getElementById("disponiblesTitle").textContent = `Disponibles · ${titulo}`;
      body.innerHTML = `<p style="color:#6b7280;">Buscando dentistas disponibles…</p>`;
      document.getElementById("modalDisponibles").classList.add("active");

      let dentistas = [];
      try {
        const data = await utils.request(`/suplencias/${pubId}/dentistas-disponibles`);
        dentistas = data.dentistas || [];
      } catch (error) {
        body.innerHTML = `<p style="color:#ef4444;">${utils.escapeHtml(error.message)}</p>`;
        return;
      }

      if (dentistas.length === 0) {
        body.innerHTML = `<div style="text-align:center;color:#6b7280;padding:1.5rem;">
          <p style="font-size:1.05rem;">Aún no hay dentistas disponibles para estos días.</p>
          <p style="font-size:0.9rem;">Aparecerán aquí cuando un dentista de la zona marque su disponibilidad en alguno de los días de la suplencia.</p>
        </div>`;
        return;
      }

      body.innerHTML = `<p style="color:#6b7280;margin:0 0 1rem;">${dentistas.length} dentista${dentistas.length===1?"":"s"} con disponibilidad en tus días:</p>` +
        dentistas.map(d => {
          const ciudad = d.ciudad ? (d.provincia ? `${d.ciudad} (${d.provincia})` : d.ciudad) : "Ubicación no indicada";
          const dist = (d.km != null && d.km > 0) ? ` · 📏 a ~${d.km} km` : "";
          const exp = (d.anyos_experiencia !== null && d.anyos_experiencia !== undefined) ? ` · 🎓 ${d.anyos_experiencia} años` : "";
          const chips = (d.dias_coincidentes || []).map(f => `<span class="badge">${utils.escapeHtml(utils.formatearDia(f))}</span>`).join("");
          return `<div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">
            <div style="flex:1;">
              <strong style="color:#0f4c75;display:block;">${utils.escapeHtml(d.nombre)}</strong>
              <p style="margin:0.2rem 0;color:#6b7280;font-size:0.9rem;">📍 ${utils.escapeHtml(ciudad)}${dist}${exp}</p>
              <div style="margin-top:0.4rem;"><span style="font-size:0.82rem;color:#059669;font-weight:600;">Coincide:</span> <span class="badges" style="gap:0.3rem;">${chips}</span></div>
            </div>
            <button class="btn-secondary" onclick="document.getElementById('modalDisponibles').classList.remove('active'); app.perfiles.verDetalle(${d.id})" style="white-space:nowrap;">Ver perfil</button>
          </div>`;
        }).join("");
    }
  },

  // ============================================
  // Módulo: Notificaciones in-app (campana)
  // ============================================

  notificaciones: {
    _maxIdVisto: null, // para mostrar un toast solo de las que llegan nuevas
    _lista: [],
    _resaltadas: null, // ids que estaban sin leer al abrir el panel (ver togglePanel)

    // Consulta el estado (lo llama el latido de polling). Actualiza el badge y,
    // si han llegado notificaciones nuevas desde la última vez, muestra un toast.
    async actualizar() {
      if (!estadoApp.usuario) return;
      let data;
      try {
        data = await utils.request("/notificaciones");
      } catch (e) { return; }

      this._lista = data.notificaciones || [];
      const badge = document.getElementById("notifBadge");
      if (badge) {
        if (data.noLeidas > 0) {
          badge.textContent = data.noLeidas > 99 ? "99+" : data.noLeidas;
          badge.style.display = "inline-block";
        } else {
          badge.style.display = "none";
        }
      }

      // Toast de las nuevas (salvo en la primera carga de la sesión)
      const maxId = this._lista.length ? Math.max(...this._lista.map(n => n.id)) : 0;
      if (this._maxIdVisto !== null && maxId > this._maxIdVisto) {
        const nuevas = this._lista.filter(n => n.id > this._maxIdVisto && !n.leido);
        if (nuevas.length === 1) {
          utils.mostrarAlerta(`🔔 ${nuevas[0].titulo}`, "info");
        } else if (nuevas.length > 1) {
          utils.mostrarAlerta(`🔔 Tienes ${nuevas.length} notificaciones nuevas`, "info");
        }
      }
      this._maxIdVisto = maxId;

      // Si el panel está abierto, refrescar la lista
      if (document.getElementById("notifPanel")?.style.display === "block") {
        this.render();
      }
    },

    togglePanel() {
      const panel = document.getElementById("notifPanel");
      if (!panel) return;
      const abierto = panel.style.display === "block";
      if (abierto) {
        panel.style.display = "none";
        this._resaltadas = null; // al volver a abrir ya no serán "nuevas"
      } else {
        // Cuáles estaban sin leer AL ABRIR. Se guardan aparte porque justo después se
        // marcan todas como leídas para quitar el contador, y el refresco automático
        // relee del servidor: sin esto se repintarían como leídas al instante y no
        // daría tiempo a ver cuáles eran las nuevas, que es justo para lo que se abre.
        this._resaltadas = new Set(this._lista.filter(n => !n.leido).map(n => n.id));
        this.render();
        panel.style.display = "block";
        if (this._lista.some(n => !n.leido)) this.marcarTodasLeidas();
      }
    },

    render() {
      const cont = document.getElementById("notifLista");
      if (!cont) return;
      if (!this._lista.length) {
        cont.innerHTML = `<p style="padding: 1.5rem; text-align: center; color: #9ca3af;">No tienes notificaciones.</p>`;
        return;
      }
      cont.innerHTML = this._lista.map(n => {
        const enlaceAttr = n.enlace
          ? ` onclick="app.notificaciones.abrir(${n.id}, '${utils.escapeHtml(String(n.enlace)).replace(/'/g, "\\'")}')"`
          : "";
        // Se resalta lo que no está leído y también lo que llegó sin leer a esta
        // apertura del panel, aunque ya se haya marcado en el servidor
        const sinLeer = !n.leido || this._resaltadas?.has(n.id);
        const clases = `notif-item${sinLeer ? " notif-no-leida" : ""}`;
        return `<div class="${clases}"${enlaceAttr}>
          <div style="display:flex; gap:0.5rem; align-items:baseline;">
            ${sinLeer ? `<span class="notif-punto">●</span>` : ""}
            <strong class="notif-titulo">${utils.escapeHtml(n.titulo)}</strong>
          </div>
          ${n.cuerpo ? `<p class="notif-cuerpo">${utils.escapeHtml(n.cuerpo)}</p>` : ""}
          <p class="notif-fecha">${utils.formatearFecha(n.creado_en)}</p>
        </div>`;
      }).join("");
    },

    abrir(id, enlace) {
      // Marca esa notificación como leída y lleva a donde se resuelve lo que anuncia
      utils.request("/notificaciones/leer", { method: "PUT", body: JSON.stringify({ id }) }).catch(() => {});
      document.getElementById("notifPanel").style.display = "none";
      // La fecha viaja con el enlace: los avisos antiguos no guardaron a qué elemento
      // se referían, y con ella se puede reconstruir (ver app.rutas.abrirChat).
      const notif = (this._lista || []).find(n => n.id === id);
      app.rutas.ir(enlace, { fecha: notif?.creado_en });
    },

    async marcarTodasLeidas() {
      try {
        await utils.request("/notificaciones/leer", { method: "PUT", body: JSON.stringify({}) });
      } catch (e) { /* ignorar */ }
      this._lista = this._lista.map(n => ({ ...n, leido: 1 }));
      const badge = document.getElementById("notifBadge");
      if (badge) badge.style.display = "none";
      this.render();
    }
  },

  // ============================================
  // Módulo: Rutas (enlaces internos de las notificaciones)
  // ============================================
  //
  // Una notificación sirve de poco si no lleva a donde se resuelve lo que anuncia.
  // El backend guarda en cada una un `enlace` con uno de los destinos de abajo y
  // este módulo lo traduce a la pantalla correspondiente.
  //
  // Son destinos internos, no URLs: la app es de una sola página y el estado vive
  // en memoria, así que "navegar" es abrir el modal o la lista que toca.

  rutas: {
    // `contexto` trae datos de la propia notificación (por ahora su fecha) que sirven
    // para reconstruir a qué se refería cuando el enlace no lo dice.
    async ir(enlace, contexto = {}) {
      if (!enlace || typeof enlace !== "string") return;
      const destino = enlace.replace(/^#/, "");
      const [nombre, argumento] = destino.split("=");
      const esClinica = estadoApp.tipoUsuario === "clinica";

      try {
        switch (nombre) {
          case "publicacion":
            return await this.abrirPublicacion(argumento);
          case "chat":
          // Notificaciones anteriores al hilo único: "#chat=<publicacion>-<persona>"
          // y "#chat-perfil=<contacto>-<persona>". En ambas el interlocutor es el
          // último segmento, que es lo único que hace falta ahora.
          case "chat-perfil":
            return await this.abrirChat(argumento, contexto);
          // Estas dos listas existen para los dos roles, pero con nombre y función
          // distintos: quien mira decide cuál toca. Una misma notificación ("tienes
          // una nueva postulación") le llega tanto a la clínica en su oferta como al
          // dentista en su solicitud, así que el enlace no puede fijar la función.
          case "candidatura":
            return await this.abrirCandidatura(argumento, esClinica);
          case "contacto":
            return await this.abrirContacto(argumento);
          case "postulaciones-recibidas":
            return esClinica
              ? await app.stats.mostrarCandidatosInteresados()
              : await app.stats.mostrarPostulacionesRecibidas();
          case "mis-postulaciones":
            return esClinica
              ? await app.stats.mostrarMisPostulacionesDentistas()
              : await app.stats.mostrarMisPostulaciones();
          case "dentistas-potenciales":
            return await app.stats.mostrarPosiblesCandidatos();
          case "clinicas-potenciales":
            return await app.stats.mostrarClinicasPotenciales();
          case "suplencias":
            return await this.abrirSuplencias(argumento);
          case "alerta":
            return await this.abrirAlerta(argumento);
          case "alertas":
            // Sin alerta concreta: se abre la lista (lo usan las notificaciones
            // anteriores a que se guardara el enlace, que no saben de cuál eran)
            return await app.alertas.abrir();
          default:
            // Enlace desconocido (p. ej. de una versión anterior): no romper nada
            console.warn("Enlace de notificación no reconocido:", enlace);
        }
      } catch (e) {
        console.error("No se pudo abrir el enlace de la notificación:", e);
        // Lo más habitual es que aquello de lo que avisaba ya no exista (se retiró la
        // publicación, se borró la cuenta). Merece un mensaje que lo diga, no un
        // error genérico que deje al usuario sin saber si el fallo es suyo.
        utils.mostrarAlerta(
          this.NO_EXISTE[nombre] || "Eso de lo que te avisábamos ya no está disponible",
          "info"
        );
      }
    },

    // Qué decir cuando el destino de una notificación ya no existe
    NO_EXISTE: {
      publicacion: "Esa publicación ya no está disponible: puede que la hayan retirado",
      candidatura: "Esa postulación ya no está disponible",
      contacto: "Esa solicitud de contacto ya no está disponible",
      chat: "Esa conversación ya no está disponible",
      "chat-perfil": "Esa conversación ya no está disponible",
      alerta: "Esa alerta de búsqueda ya no existe",
      suplencias: "Esas suplencias ya no están disponibles"
    },

    // Las suplencias de las que hablaba la notificación, en un modal.
    //
    // Antes esto cambiaba el listado de la página principal, y ese listado queda muy
    // por debajo del pliegue: el usuario pulsaba y se quedaba mirando la portada sin
    // ver que algo había cambiado más abajo. Un modal se ve siempre, y además deja
    // esta notificación igual que las demás (todas abren algo encima).
    async abrirSuplencias(ids) {
      const url = ids ? `/publicaciones?ids=${encodeURIComponent(ids)}` : "/publicaciones?tipo=suplencia";
      const suplencias = await utils.request(url);

      if (!suplencias || suplencias.length === 0) {
        utils.mostrarAlerta("Esas suplencias ya no están disponibles", "info");
        return;
      }
      if (suplencias.length === 1) {
        return app.modal.abrirDetalleConManejo(suplencias[0]);
      }

      const html = `<div class="lista-simple">` + suplencias.map(s => {
        const fechas = s.fecha_desde
          ? `${utils.formatearFecha(s.fecha_desde)}${s.fecha_hasta && s.fecha_hasta !== s.fecha_desde ? ` – ${utils.formatearFecha(s.fecha_hasta)}` : ""}`
          : "";
        return `
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-bottom:.75rem;">
            <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;">
              <div style="min-width:0;">
                <strong style="color:#0f4c75;">📍 ${utils.escapeHtml(s.ciudad || "")}</strong>
                ${s.urgente ? '<span style="background:#ef4444;color:white;padding:.1rem .5rem;border-radius:20px;font-size:.7rem;font-weight:700;margin-left:.4rem;">URGENTE</span>' : ""}
                ${fechas ? `<p style="margin:.3rem 0 0;color:#6b7280;font-size:.85rem;">🗓️ ${fechas}</p>` : ""}
                <p style="margin:.3rem 0 0;color:#4b5563;font-size:.9rem;">${utils.escapeHtml((s.descripcion || "").slice(0, 90))}</p>
              </div>
              <button class="btn-primary btn-small" onclick="app.rutas.abrirPublicacion(${s.id})">Ver</button>
            </div>
          </div>`;
      }).join("") + `</div>`;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent =
        `Suplencias que encajan contigo (${suplencias.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    // Una postulación concreta. Se reutilizan las listas que ya existen (traen todos
    // los campos que pide el detalle) y encima se abre la ficha del elemento: así la
    // notificación lleva a la candidatura de la que hablaba, no a un listado donde
    // haya que buscarla. Si ya no está (publicación cerrada, candidatura retirada),
    // se deja al menos la lista abierta en vez de no hacer nada.
    async abrirCandidatura(id, esClinica) {
      const candidaturaId = String(id);
      const uid = estadoApp.usuario.id;

      // Una candidatura puede ser de dos naturalezas para la misma persona: recibida
      // (alguien se postuló a MI publicación) o enviada (yo me postulé a la de otro).
      // Y los dos roles pueden estar en ambas situaciones: una clínica se postula a
      // la solicitud de un dentista, y un dentista recibe postulaciones en la suya.
      // Por eso se busca en las dos listas en vez de decidirlo por el rol, que era el
      // error: al dentista solo se le miraban las enviadas, así que un aviso de
      // postulación recibida no encontraba nada y acababa mostrando un listado.
      const urlRecibidas = esClinica
        ? `/stats/candidatos-interesados-lista/${uid}`
        : `/stats/postulaciones-recibidas-dentista-lista/${uid}`;

      const [recibidas, enviadas] = await Promise.all([
        utils.requestOpcional(urlRecibidas),
        utils.requestOpcional(`/stats/mis-postulaciones-lista/${uid}`)
      ]);

      // Ojo: las funciones de lista son async y pintan al terminar, así que no se
      // puede abrir el detalle "encima" de una lista lanzada sin await: el pintado de
      // la lista llegaría después y lo borraría. O detalle, o lista.
      const recibida = (recibidas || []).find(x => String(x.id) === candidaturaId);
      if (recibida) {
        return app.stats.mostrarDetallePostulacion(
          recibida.id, recibida.nombre, recibida.email, recibida.ciudad || "",
          recibida.direccion || "", recibida.codigo_postal || "", recibida.estado,
          recibida.mensaje || ""
        );
      }

      const enviada = (enviadas || []).find(x => String(x.id) === candidaturaId);
      if (enviada) return app.stats.mostrarDetalleMiPostulacion(enviada);

      // No aparece en ninguna de las dos: la publicación se retiró o la candidatura
      // se deshizo. Se dice claramente y se deja el listado por si quiere mirar.
      utils.mostrarAlerta(this.NO_EXISTE.candidatura, "info");
      if (esClinica) return await app.stats.mostrarListaCandidatos(recibidas || [], "Postulaciones Recibidas");
      return await app.stats.mostrarListaPostulaciones(enviadas || [], "Postulaciones a Clínicas");
    },

    // Una solicitud de contacto concreta: se abre la bandeja y se resalta la tarjeta
    // de esa solicitud, que es donde se acepta o se rechaza.
    async abrirContacto(id) {
      await app.chat.abrir();
      await new Promise(r => setTimeout(r, 300));
      const tarjeta = document.getElementById(`contacto-${id}`);
      // Si no está, es que ya se aceptó o se rechazó: la bandeja queda abierta, pero
      // conviene decir por qué no se resalta nada.
      if (!tarjeta) {
        utils.mostrarAlerta("Esa solicitud de contacto ya está respondida", "info");
        return;
      }
      tarjeta.scrollIntoView({ block: "center" });
      tarjeta.classList.add("resaltado");
      setTimeout(() => tarjeta.classList.remove("resaltado"), 2500);
    },

    // La publicación puede haberse borrado desde que se envió la notificación
    async abrirPublicacion(id) {
      const publicacion = await utils.request(`/publicaciones/${encodeURIComponent(id)}`);
      // Si se viene de la lista de suplencias, hay que cerrarla: el detalle se abriría
      // por debajo y parecería que el botón no hace nada.
      document.getElementById("modalInteresados")?.classList.remove("active");
      app.modal.abrirDetalleConManejo(publicacion);
    },

    // `argumento` es "publicacionId-otroId". El nombre del interlocutor no viaja en
    // el enlace: se busca en la lista de conversaciones, que ya lo trae. Si no está
    // (conversación aún sin mensajes), se abre la bandeja y que elija.
    // El interlocutor es el último segmento del argumento, así funcionan tanto los
    // enlaces nuevos ("#chat=48") como los antiguos ("#chat=53-48"). Sin argumento
    // se abre la bandeja, que es lo que quieren las notificaciones de contacto.
    async abrirChat(argumento, contexto = {}) {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }

      const partes = String(argumento || "").split("-").filter(Boolean);
      let otroId = partes[partes.length - 1];

      // Los avisos anteriores a que se guardara el destinatario solo dicen "#chat".
      // Con la fecha de la notificación se reconstruye: el aviso se crea justo
      // después del hecho, así que es la conversación cuyo último mensaje cae junto a
      // esa fecha. Sin esto acabas en la bandeja teniendo que buscar tú.
      if (!otroId && contexto.fecha) {
        otroId = await this.conversacionPorFecha(contexto.fecha);

        // Puede que no fuera un mensaje sino una solicitud de contacto: ahí todavía
        // no hay conversación, así que se abre la bandeja pero señalando cuál es.
        // Le pasa sobre todo a los dentistas, que son quienes las reciben.
        if (!otroId) {
          const contactoId = await this.contactoPorFecha(contexto.fecha);
          if (contactoId) return await this.abrirContacto(contactoId);
        }
      }

      // Sin manera de saber a qué se refería, la bandeja es lo correcto.
      if (!otroId) return await app.chat.abrir();

      app.modal.cerrarTodosModales();
      document.getElementById("modalChat").classList.add("active");
      await app.chat.abrirConversacion(parseInt(otroId, 10));
      app.chat.iniciarPolling();
    },

    // Conversación cuyo último mensaje es el más cercano a `fecha` sin pasarse. Se
    // exige que caiga dentro de una hora: si no hay nada cerca es que esa
    // conversación ya no existe, y vale más la bandeja que abrir una cualquiera.
    async conversacionPorFecha(fecha) {
      const objetivo = new Date(String(fecha).replace(" ", "T") + "Z").getTime();
      if (!Number.isFinite(objetivo)) return null;

      const data = await utils.requestOpcional("/chat/conversaciones");
      let mejor = null;
      let mejorDistancia = Infinity;

      (data?.conversaciones || []).forEach(c => {
        if (!c.ultima_fecha) return;
        const t = new Date(String(c.ultima_fecha).replace(" ", "T") + "Z").getTime();
        if (!Number.isFinite(t)) return;
        const distancia = Math.abs(objetivo - t);
        if (distancia < mejorDistancia) {
          mejorDistancia = distancia;
          mejor = c.otro_id;
        }
      });

      return mejorDistancia <= 3600000 ? mejor : null;
    },

    // Lo mismo para las solicitudes de contacto recibidas: la que se creó junto a la
    // fecha del aviso. Misma tolerancia de una hora y mismo criterio: si no hay nada
    // cerca, no se señala ninguna.
    async contactoPorFecha(fecha) {
      const objetivo = new Date(String(fecha).replace(" ", "T") + "Z").getTime();
      if (!Number.isFinite(objetivo)) return null;

      const data = await utils.requestOpcional("/contactos-perfil");
      let mejor = null;
      let mejorDistancia = Infinity;

      (data?.recibidos || []).forEach(c => {
        const t = new Date(String(c.creado_en).replace(" ", "T") + "Z").getTime();
        if (!Number.isFinite(t)) return;
        const distancia = Math.abs(objetivo - t);
        if (distancia < mejorDistancia) {
          mejorDistancia = distancia;
          mejor = c.id;
        }
      });

      return mejorDistancia <= 3600000 ? mejor : null;
    },

    async abrirAlerta(id) {
      await app.alertas.abrir();
      const alertaId = parseInt(id, 10);
      // `aplicar` no hace nada si la alerta ya no está: se avisa aquí, con la lista
      // de alertas abierta, para que se vea que esa en concreto ha desaparecido.
      if (!(app.alertas._cache || []).some(a => a.id === alertaId)) {
        utils.mostrarAlerta(this.NO_EXISTE.alerta, "info");
        return;
      }
      app.alertas.aplicar(alertaId);
    }
  },

  // ============================================
  // Módulo: Onboarding (primeros pasos para activarse)
  // ============================================

  onboarding: {
    _dismissKey() { return `onboarding_oculto_${estadoApp.usuario ? estadoApp.usuario.id : "x"}`; },

    async refrescar() {
      const card = document.getElementById("onboardingCard");
      if (!card || !estadoApp.usuario) return;
      if (localStorage.getItem(this._dismissKey()) === "1") { card.style.display = "none"; return; }

      let data;
      try { data = await utils.request("/onboarding"); } catch (e) { return; }
      if (!data || data.completado) { card.style.display = "none"; return; }

      this.render(data.pasos || []);
      card.style.display = "block";
    },

    render(pasos) {
      const card = document.getElementById("onboardingCard");
      const total = pasos.length;
      const hechos = pasos.filter(p => p.hecho).length;
      const pct = total ? Math.round((hechos / total) * 100) : 0;

      const filas = pasos.map(p => `
        <div style="display:flex; align-items:flex-start; gap:0.6rem; padding:0.6rem 0; border-top:1px solid #e0f2fe;">
          <span style="font-size:1.1rem; line-height:1.4;">${p.hecho ? "✅" : "⭕"}</span>
          <div style="flex:1;">
            <strong style="font-size:0.92rem; ${p.hecho ? "text-decoration:line-through; color:#9ca3af;" : "color:#0f4c75;"}">${utils.escapeHtml(p.titulo)}${p.opcional ? ` <span style="font-weight:normal; color:#9ca3af; font-size:0.78rem;">(opcional)</span>` : ""}</strong>
            <p style="margin:0.15rem 0 0; color:#6b7280; font-size:0.82rem; line-height:1.4;">${utils.escapeHtml(p.descripcion)}</p>
          </div>
          ${p.hecho ? "" : `<button class="btn-primary btn-small" onclick="app.onboarding.ejecutar('${p.accion}')" style="white-space:nowrap;">Hacer</button>`}
        </div>`).join("");

      card.innerHTML = `
        <div style="background:linear-gradient(135deg,#eff6ff,#f0f9ff); border:1px solid #bae6fd; border-radius:12px; padding:1.1rem 1.3rem; margin-bottom:1.5rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem;">
            <strong style="color:#0f4c75; font-size:1.05rem;">🚀 Primeros pasos</strong>
            <div style="display:flex; align-items:center; gap:0.8rem;">
              <span style="color:#0f4c75; font-size:0.85rem; font-weight:600;">${hechos}/${total}</span>
              <button onclick="app.onboarding.ocultar()" style="background:none; border:none; color:#6b7280; cursor:pointer; font-size:0.82rem;">Ocultar</button>
            </div>
          </div>
          <div style="height:8px; background:#dbeafe; border-radius:999px; overflow:hidden; margin:0.6rem 0 0.2rem;">
            <div style="height:100%; width:${pct}%; background:#0f4c75; transition:width 0.3s;"></div>
          </div>
          ${filas}
        </div>`;
    },

    ocultar() {
      localStorage.setItem(this._dismissKey(), "1");
      const card = document.getElementById("onboardingCard");
      if (card) card.style.display = "none";
    },

    // Abre la acción asociada al paso
    ejecutar(accion) {
      const abrirPerfilEn = (tabBtnId) => {
        app.modal.abrirPerfil();
        setTimeout(() => document.getElementById(tabBtnId)?.click(), 200);
      };
      switch (accion) {
        case "perfil": app.modal.abrirPerfil(); break;
        case "disponibilidad": abrirPerfilEn("tabDisponibilidad"); break;
        case "compatibilidad": abrirPerfilEn("tabCompatibilidad"); break;
        case "cv": abrirPerfilEn("tabCv"); break;
        // Las sedes ya no tienen pestaña propia: están dentro de "Mis datos"
        case "sedes": abrirPerfilEn("tabDatos"); break;
        case "publicar": app.modal.abrirPublicar(); break;
        case "explorar": document.getElementById("filtros")?.scrollIntoView({ behavior: "smooth", block: "start" }); break;
      }
    }
  },

  // ============================================
  // Módulo: Auth
  // ============================================

  auth: {
    async loginEmpresa() {
      const email = document.getElementById("loginEmailEmp").value;
      const password = document.getElementById("loginPasswordEmp").value;

      if (!email) {
        utils.mostrarAlerta("Por favor ingresa tu email", "error");
        return;
      }

      try {
        const response = await utils.request("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });

        if (response.usuario.tipo !== 'clinica') {
          utils.mostrarAlerta("Este usuario no es una clínica", "error");
          return;
        }

        estadoApp.token = response.token;
        estadoApp.usuario = response.usuario;
        estadoApp.tipoUsuario = 'clinica';

        localStorage.setItem("token", response.token);
        localStorage.setItem("usuario", JSON.stringify(response.usuario));
        localStorage.setItem("tipoUsuario", 'clinica');

        utils.mostrarAlerta("¡Sesión iniciada!", "success");
        app.modal.cerrarAuthEmpresa();
        app.ui.mostrarPlataforma();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async registroEmpresa() {
      const nombre = document.getElementById("regNombreEmp").value;
      const email = document.getElementById("regEmailEmp").value;
      const password = document.getElementById("regPasswordEmp").value;
      const direccion = document.getElementById("regDireccionEmp").value;
      const codigo_postal = document.getElementById("regCodigoPostalEmp").value;
      const pais = document.getElementById("regPaisEmp").value;
      const telefono = document.getElementById("regMovilEmp").value;

      if (!nombre || !email || !direccion || !codigo_postal || !telefono) {
        utils.mostrarAlerta("Por favor completa todos los campos obligatorios", "error");
        return;
      }

      if (!password || password.length < 8) {
        utils.mostrarAlerta("La contraseña debe tener al menos 8 caracteres", "error");
        return;
      }

      if (!document.getElementById("regTerminosEmp").checked) {
        utils.mostrarAlerta("Debes aceptar la política de privacidad y los términos de uso", "error");
        return;
      }

      try {
        const response = await utils.request("/auth/registro", {
          method: "POST",
          body: JSON.stringify({ nombre, email, password, tipo: 'clinica', telefono, direccion, codigo_postal, pais, aceptaTerminos: true })
        });

        estadoApp.token = response.token;
        estadoApp.usuario = response.usuario;
        estadoApp.tipoUsuario = 'clinica';

        localStorage.setItem("token", response.token);
        localStorage.setItem("usuario", JSON.stringify(response.usuario));
        localStorage.setItem("tipoUsuario", 'clinica');

        utils.mostrarAlerta("¡Registro exitoso!", "success");
        app.modal.cerrarAuthEmpresa();
        app.ui.mostrarPlataforma();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async loginCandidato() {
      const email = document.getElementById("loginEmailCand").value;
      const password = document.getElementById("loginPasswordCand").value;

      if (!email) {
        utils.mostrarAlerta("Por favor ingresa tu email", "error");
        return;
      }

      try {
        const response = await utils.request("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });

        if (response.usuario.tipo !== 'dentista') {
          utils.mostrarAlerta("Este usuario no es un dentista", "error");
          return;
        }

        estadoApp.token = response.token;
        estadoApp.usuario = response.usuario;
        estadoApp.tipoUsuario = 'dentista';

        localStorage.setItem("token", response.token);
        localStorage.setItem("usuario", JSON.stringify(response.usuario));
        localStorage.setItem("tipoUsuario", 'dentista');

        utils.mostrarAlerta("¡Sesión iniciada!", "success");
        app.modal.cerrarAuthCandidato();
        app.ui.mostrarPlataforma();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async registroCandidato() {
      const nombre = document.getElementById("regNombreCand").value;
      const email = document.getElementById("regEmailCand").value;
      const password = document.getElementById("regPasswordCand").value;
      const telefono = document.getElementById("regMovilCand").value || null;

      if (!nombre || !email) {
        utils.mostrarAlerta("Por favor completa todos los campos obligatorios", "error");
        return;
      }

      if (!password || password.length < 8) {
        utils.mostrarAlerta("La contraseña debe tener al menos 8 caracteres", "error");
        return;
      }

      if (!document.getElementById("regTerminosCand").checked) {
        utils.mostrarAlerta("Debes aceptar la política de privacidad y los términos de uso", "error");
        return;
      }

      try {
        const response = await utils.request("/auth/registro", {
          method: "POST",
          body: JSON.stringify({ nombre, email, password, tipo: 'dentista', telefono, aceptaTerminos: true })
        });

        estadoApp.token = response.token;
        estadoApp.usuario = response.usuario;
        estadoApp.tipoUsuario = 'dentista';

        localStorage.setItem("token", response.token);
        localStorage.setItem("usuario", JSON.stringify(response.usuario));
        localStorage.setItem("tipoUsuario", 'dentista');

        utils.mostrarAlerta("¡Registro exitoso!", "success");
        app.modal.cerrarAuthCandidato();
        app.ui.mostrarPlataforma();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Recuperación de contraseña: pide el email y envía las instrucciones
    async olvidePassword(inputEmailId) {
      const prefill = inputEmailId ? document.getElementById(inputEmailId)?.value : "";
      const email = prompt("Escribe el email de tu cuenta:", prefill || "");
      if (!email) return;

      try {
        const res = await utils.request("/auth/olvide-password", {
          method: "POST",
          body: JSON.stringify({ email: email.trim() })
        });
        utils.mostrarAlerta(res.mensaje || "Revisa tu correo", "success");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    tokenRestablecer: null,

    async restablecerPassword() {
      const password = document.getElementById("restablecerPassword").value;
      const confirma = document.getElementById("restablecerPasswordConfirma").value;

      if (password !== confirma) {
        utils.mostrarAlerta("Las contraseñas no coinciden", "error");
        return;
      }

      try {
        const res = await utils.request("/auth/restablecer-password", {
          method: "POST",
          body: JSON.stringify({ token: this.tokenRestablecer, passwordNueva: password })
        });
        document.getElementById("modalRestablecer").classList.remove("active");
        this.tokenRestablecer = null;
        utils.mostrarAlerta("✅ " + (res.mensaje || "Contraseña actualizada"), "success");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async reenviarVerificacion() {
      try {
        const res = await utils.request("/auth/reenviar-verificacion", { method: "POST" });
        utils.mostrarAlerta(res.mensaje || "Correo reenviado", "success");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Procesa los enlaces que llegan por correo (#verificar= / #restablecer= / #confirmar-email=)
    async procesarEnlacesDeCorreo() {
      const hash = window.location.hash || "";

      const limpiarHash = () => history.replaceState(null, "", window.location.pathname + window.location.search);

      if (hash.startsWith("#verificar=")) {
        const token = hash.slice("#verificar=".length);
        limpiarHash();
        try {
          const res = await utils.request(`/auth/verificar-email/${encodeURIComponent(token)}`);
          utils.mostrarAlerta("✅ " + (res.mensaje || "Email verificado"), "success");
        } catch (error) {
          utils.mostrarAlerta(error.message, "error");
        }
      } else if (hash.startsWith("#restablecer=")) {
        this.tokenRestablecer = hash.slice("#restablecer=".length);
        limpiarHash();
        document.getElementById("restablecerPassword").value = "";
        document.getElementById("restablecerPasswordConfirma").value = "";
        document.getElementById("modalRestablecer").classList.add("active");
      } else if (hash.startsWith("#confirmar-email=")) {
        const token = hash.slice("#confirmar-email=".length);
        limpiarHash();
        try {
          const res = await utils.request(`/auth/confirmar-cambio-email/${encodeURIComponent(token)}`);
          utils.mostrarAlerta("✅ " + (res.message || "Email actualizado. Vuelve a iniciar sesión."), "success");
          // El JWT lleva el email antiguo: cerrar sesión para regenerarlo
          if (estadoApp.token) app.auth.logout();
        } catch (error) {
          utils.mostrarAlerta(error.message, "error");
        }
      }
    },

    // `motivo` permite explicar por qué se cierra la sesión cuando no la ha cerrado
    // el usuario (p. ej. token caducado). Sin él, el mensaje es el de siempre.
    logout(motivo) {
      app.ui.detenerActualizacionAutomatica();

      localStorage.removeItem("token");
      localStorage.removeItem("usuario");
      localStorage.removeItem("tipoUsuario");
      estadoApp.token = null;
      estadoApp.usuario = null;
      estadoApp.tipoUsuario = null;

      // Limpiar formularios
      document.querySelectorAll("form").forEach(form => form.reset());

      // Cerrar y resetear el panel de notificaciones
      const notifPanel = document.getElementById("notifPanel");
      if (notifPanel) notifPanel.style.display = "none";
      app.notificaciones._maxIdVisto = null;
      app.notificaciones._lista = [];
      app.notificaciones._resaltadas = null;

      utils.mostrarAlerta(motivo || "Sesión cerrada", motivo ? "error" : "info");
      app.ui.mostrarLanding();
    },

    switchAuthTab(tab) {
      const prefix = tab.includes('Empresa') ? 'Empresa' :
                     tab.includes('Candidato') ? 'Candidato' : '';

      const modalId = prefix === 'Empresa' ? 'modalAuthEmpresa' : 'modalAuthCandidato';

      document.querySelectorAll(`#${modalId} .tab-content`).forEach(el => el.classList.remove("active"));
      document.querySelectorAll(`#${modalId} .tab-btn`).forEach(el => el.classList.remove("active"));

      document.getElementById(`tab-${tab}`).classList.add("active");
      event.target.classList.add("active");
    }
  },

  // ============================================
  // Módulo: Publicaciones
  // ============================================

  publicaciones: {
    async cargar(pagina = 1) {
      // Cerrar todos los modales antes de cargar
      app.modal.cerrarTodosModales();

      // Determinar tipo según modo
      let tipo;
      if (estadoApp.filtros.verSuplencias) {
        // Suplencias y turnos sueltos (solo dentistas navegando)
        tipo = 'suplencia';
      } else if (estadoApp.filtros.soloMias) {
        // Mis publicaciones: empresas ven sus OFERTAS y SUPLENCIAS (sin filtro de tipo), candidatos ven sus SOLICITUDES
        tipo = estadoApp.tipoUsuario === 'clinica' ? null : 'solicitud';
      } else {
        // Ver todas: empresas ven SOLICITUDES, candidatos ven OFERTAS
        tipo = estadoApp.tipoUsuario === 'clinica' ? 'solicitud' : 'oferta';
      }

      // Los filtros propios de la vista de suplencias se muestran u ocultan según el
      // modo. Se hace en un helper porque hay que repetirlo al cambiar a vistas que no
      // pasan por aquí (Favoritos, Mis Postulaciones…), donde antes se quedaba el menú
      // de suplencias colgado.
      app.filtros.sincronizarUISuplencias();

      // Orden por compatibilidad: solo para dentistas (usa su perfil). Si una clínica
      // lo tuviera seleccionado por lo que sea, se vuelve al orden por defecto.
      const optCompat = document.getElementById("ordenCompatibilidad");
      if (optCompat) {
        const mostrarCompat = estadoApp.tipoUsuario === 'dentista';
        optCompat.hidden = !mostrarCompat;
        optCompat.style.display = mostrarCompat ? "" : "none";
        const sel = document.getElementById("filterOrden");
        if (!mostrarCompat && sel.value === 'compatibilidad') sel.value = 'recientes';
      }

      const q = document.getElementById("filterQ").value;
      const ciudad = app.filtros.ciudadSeleccionada();
      const radioKm = document.getElementById("filterRadio")?.value || "";
      const especialidad = document.getElementById("filterEspecialidad").value;
      const contrato = document.getElementById("filterContrato").value;
      const jornada = document.getElementById("filterJornada").value;
      const equipamiento = document.getElementById("filterEquipamiento").value;
      const certificacion = document.getElementById("filterCertificacion").value;
      const retribucion = document.getElementById("filterRetribucion").value;
      const salarioMin = document.getElementById("filterSalarioMin").value;
      const experienciaMin = document.getElementById("filterExperienciaMin").value;
      const fechaDesde = document.getElementById("filterFechaDesde")?.value || "";
      const fechaHasta = document.getElementById("filterFechaHasta")?.value || "";
      const orden = document.getElementById("filterOrden").value;

      estadoApp.filtros = { tipo, q, ciudad, radioKm, especialidad, contrato, jornada, equipamiento, certificacion, retribucion, salarioMin, experienciaMin, orden, soloMias: estadoApp.filtros.soloMias, verSuplencias: estadoApp.filtros.verSuplencias };

      let url = "/publicaciones?";
      if (tipo) url += `tipo=${tipo}&`;
      if (estadoApp.filtros.soloMias && estadoApp.usuario) {
        url += `usuario_id=${estadoApp.usuario.id}&`;
        // "Mis Publicaciones": primero las ofertas de empleo y luego las suplencias.
        // Aquí no hay filtros que aplicar: son las propias y salen todas.
        url += `sort=tipo&`;
      } else {
        if (q) url += `q=${encodeURIComponent(q)}&`;
        if (ciudad) url += `ciudad=${encodeURIComponent(ciudad)}&`;
        if (ciudad && radioKm) url += `radioKm=${encodeURIComponent(radioKm)}&`;
        if (especialidad) url += `especialidad=${especialidad}&`;
        if (contrato) url += `contrato=${encodeURIComponent(contrato)}&`;
        if (jornada) url += `jornada=${encodeURIComponent(jornada)}&`;
        if (equipamiento) url += `equipamiento=${encodeURIComponent(equipamiento)}&`;
        if (certificacion) url += `certificacion=${encodeURIComponent(certificacion)}&`;
        if (retribucion) url += `retribucion=${retribucion}&`;
        if (salarioMin) url += `salarioMin=${salarioMin}&`;
        if (experienciaMin) url += `experienciaMin=${experienciaMin}&`;
        // Filtro por fecha: solo tiene sentido en suplencias (usa suplencia_dias)
        if (estadoApp.filtros.verSuplencias && fechaDesde) url += `fechaDesde=${fechaDesde}&`;
        if (estadoApp.filtros.verSuplencias && fechaHasta) url += `fechaHasta=${fechaHasta}&`;
        // "Encajan con mi disponibilidad": cruza suplencia_dias con mi disponibilidad
        if (estadoApp.filtros.verSuplencias && estadoApp.tipoUsuario === 'dentista' &&
            document.getElementById("filterMiDisponibilidad")?.checked && estadoApp.usuario) {
          url += `disponibleUsuarioId=${estadoApp.usuario.id}&`;
        }
        if (orden && orden !== 'recientes') {
          url += `sort=${orden}&`;
          if (orden === 'relevancia' && estadoApp.usuario) url += `paraUsuarioId=${estadoApp.usuario.id}&`;
        } else if (estadoApp.filtros.verSuplencias) {
          // Suplencias: urgentes primero y luego por fecha de inicio más próxima
          url += `sort=fecha&`;
        } else if (
          (estadoApp.tipoUsuario === 'clinica' && tipo === 'solicitud') ||
          (estadoApp.tipoUsuario === 'dentista' && tipo === 'oferta')
        ) {
          // Clínicas viendo dentistas, o dentistas viendo clínicas: por defecto, ordenar por ciudad
          url += `sort=ciudad&`;
        }
      }

      const limit = 20;
      url += `page=${pagina}&limit=${limit}`;

      try {
        let publicaciones = await utils.request(url);
        estadoApp.publicaciones = pagina === 1 ? publicaciones : estadoApp.publicaciones.concat(publicaciones);
        estadoApp.paginaActual = pagina;
        estadoApp.hayMasPublicaciones = publicaciones.length === limit;
        app.ui.renderizarPublicaciones();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async cargarContactadas() {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }

      try {
        const publicaciones = await utils.request(`/publicaciones/contactadas/${estadoApp.usuario.id}`);
        estadoApp.publicaciones = publicaciones;
        app.ui.renderizarPublicaciones();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async cargarFavoritos() {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }

      try {
        const publicaciones = await utils.request("/favoritos");
        let perfilesFav = [];
        try {
          const f = await utils.request("/favoritos-perfil");
          perfilesFav = f.perfiles || [];
        } catch (e) { /* sin perfiles guardados */ }

        const container = document.getElementById("publicacionesContainer");
        estadoApp.publicaciones = publicaciones;

        if (publicaciones.length) {
          await app.ui.renderizarPublicaciones();
        } else {
          container.innerHTML = "";
        }

        if (perfilesFav.length) {
          const favSet = new Set(perfilesFav.map(p => p.id));
          const encabezado = publicaciones.length ? `<h3 style="margin:1.5rem 0 1rem;color:#0f4c75;">Perfiles guardados</h3>` : "";
          container.insertAdjacentHTML('beforeend', encabezado + app.perfiles.tarjetasHtml(perfilesFav, favSet));
        }

        if (!publicaciones.length && !perfilesFav.length) {
          container.innerHTML = `<div class="empty-state"><h3>No tienes favoritos</h3><p>Guarda publicaciones o perfiles con la estrella ☆.</p></div>`;
        }
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async crear(tipo) {
      if (!estadoApp.token) {
        utils.mostrarAlerta("Debes iniciar sesión para publicar", "error");
        return;
      }

      let formData;
      if (tipo === "oferta") {
        // Obtener especialidades seleccionadas
        const especialidadesCheckboxes = document.querySelectorAll('#ofertaEspecialidadesContainer input[type="checkbox"]:checked');
        const especialidades = Array.from(especialidadesCheckboxes).map(cb => parseInt(cb.value));
        const ciudad = document.getElementById("ofertaCiudad").value;
        const especialidadNombre = especialidades.length > 0 ? estadoApp.especialidades.find(e => e.id === especialidades[0])?.nombre : "Dentista";

        formData = {
          tipo: "oferta",
          descripcion: document.getElementById("ofertaDescripcion").value,
          ciudad: ciudad,
          especialidades: especialidades,
          contrato: document.getElementById("ofertaContrato").value || null,
          jornada: document.getElementById("ofertaJornada").value || null,
          salario: (() => {
            const desde = document.getElementById("ofertaSalarioDesde").value;
            const hasta = document.getElementById("ofertaSalarioHasta").value;
            if (!desde && !hasta) return null;
            return hasta ? `${desde || '?'}-${hasta} €/mes` : `Desde ${desde} €/mes`;
          })(),
          salarioDesde: document.getElementById("ofertaSalarioDesde").value || null,
          salarioHasta: document.getElementById("ofertaSalarioHasta").value || null,
          experiencia: document.getElementById("ofertaExperiencia").value || null,
          nombre_contacto: document.getElementById("ofertaNombreContacto").value,
          email_contacto: document.getElementById("ofertaEmailContacto").value,
          telefono_contacto: document.getElementById("ofertaTelefonoContacto").value || null,
          // "principal" (ciudad del perfil) no lleva sede; un centro sí
          sede_id: (() => { const v = document.getElementById("ofertaSede")?.value; return v && v !== "principal" ? v : null; })(),
          retribucionTipo: document.querySelector('input[name="ofertaRetribucionTipo"]:checked')?.value || 'fijo',
          retribucionPorcentaje: document.getElementById("ofertaRetribucionPorcentaje").value || null,
          equipamiento: Array.from(document.querySelectorAll('#ofertaEquipamientoContainer input[type="checkbox"]:checked')).map(cb => cb.value),
          preguntas: Array.from(document.querySelectorAll('.ofertaPregunta')).map(i => i.value.trim()).filter(v => v)
        };
      } else if (tipo === "suplencia") {
        const especialidadesCheckboxes = document.querySelectorAll('#suplenciaEspecialidadesContainer input[type="checkbox"]:checked');
        const especialidades = Array.from(especialidadesCheckboxes).map(cb => parseInt(cb.value));

        formData = {
          tipo: "suplencia",
          descripcion: document.getElementById("suplenciaDescripcion").value,
          ciudad: document.getElementById("suplenciaCiudad").value,
          especialidades: especialidades,
          salario: document.getElementById("suplenciaSalario").value || null,
          dias: app.calendario.obtener("suplenciaCalendario"),
          urgente: document.getElementById("suplenciaUrgente").checked,
          nombre_contacto: document.getElementById("suplenciaNombreContacto").value,
          email_contacto: document.getElementById("suplenciaEmailContacto").value,
          telefono_contacto: document.getElementById("suplenciaTelefonoContacto").value || null,
          // "principal" (ciudad del perfil) no lleva sede; un centro sí
          sede_id: (() => { const v = document.getElementById("suplenciaSede")?.value; return v && v !== "principal" ? v : null; })(),
          retribucionTipo: document.querySelector('input[name="suplenciaRetribucionTipo"]:checked')?.value || 'fijo',
          retribucionPorcentaje: document.getElementById("suplenciaRetribucionPorcentaje").value || null,
          equipamiento: Array.from(document.querySelectorAll('#suplenciaEquipamientoContainer input[type="checkbox"]:checked')).map(cb => cb.value),
          preguntas: Array.from(document.querySelectorAll('.suplenciaPregunta')).map(i => i.value.trim()).filter(v => v)
        };
      } else {
        // Obtener especialidades seleccionadas
        const especialidadesCheckboxes = document.querySelectorAll('#solicitudEspecialidadesContainer input[type="checkbox"]:checked');
        const especialidades = Array.from(especialidadesCheckboxes).map(cb => parseInt(cb.value));
        const ciudad = document.getElementById("solicitudCiudad").value;
        const especialidadNombre = especialidades.length > 0 ? estadoApp.especialidades.find(e => e.id === especialidades[0])?.nombre : "Dentista";

        formData = {
          tipo: "solicitud",
          descripcion: document.getElementById("solicitudDescripcion").value,
          ciudad: ciudad,
          especialidades: especialidades,
          contrato: document.getElementById("solicitudContrato").value || null,
          jornada: document.getElementById("solicitudJornada").value || null,
          experiencia: document.getElementById("solicitudExperiencia").value || null,
          nombre_contacto: document.getElementById("solicitudNombreContacto").value,
          email_contacto: document.getElementById("solicitudEmailContacto").value,
          telefono_contacto: document.getElementById("solicitudTelefonoContacto").value || null
        };
      }

      const esClinicaPub = (tipo === 'oferta' || tipo === 'suplencia');
      if (esClinicaPub && !document.getElementById(`${tipo}Sede`)?.value) {
        utils.mostrarAlerta("Elige una ubicación para publicar", "error");
        return;
      }

      // Para ofertas/suplencias, ciudad, empresa y contacto se derivan de la sede/perfil en el backend
      if (!formData.descripcion || (tipo === 'solicitud' && (!formData.nombre_contacto || !formData.email_contacto))) {
        utils.mostrarAlerta("Por favor completa todos los campos obligatorios", "error");
        return;
      }

      if (tipo === "suplencia" && (!formData.dias || formData.dias.length === 0)) {
        utils.mostrarAlerta("Marca en el calendario al menos un día para la suplencia", "error");
        return;
      }

      // Validar el email que introduce el dentista en una solicitud (en ofertas sale del perfil)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (tipo === 'solicitud' && !emailRegex.test(formData.email_contacto)) {
        utils.mostrarAlerta("Por favor ingresa un email válido", "error");
        return;
      }

      // Validar descripción no vacía
      if (formData.descripcion.trim().length < 10) {
        utils.mostrarAlerta("La descripción debe tener al menos 10 caracteres", "error");
        return;
      }

      try {
        const respuesta = await utils.request("/publicaciones", {
          method: "POST",
          body: JSON.stringify(formData)
        });

        utils.mostrarAlerta("¡Publicación creada exitosamente!", "success");
        app.modal.cerrarPublicar();
        app.publicaciones.cargar();
        app.ui.actualizarStats();
        app.onboarding.refrescar();

        document.getElementById(`tab-${tipo}`).querySelector("form").reset();
        if (tipo === "oferta" || tipo === "suplencia") app.publicaciones.toggleRetribucion(tipo);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Rellena (solo lectura) la ciudad y provincia de la solicitud a partir del perfil del dentista
    async rellenarCiudadSolicitudDesdePerfil() {
      const inputCiudad = document.getElementById("solicitudCiudad");
      const inputProvincia = document.getElementById("solicitudProvincia");
      const hint = document.getElementById("solicitudCiudadHint");
      if (!inputCiudad) return;
      try {
        const u = await utils.request("/auth/mi-perfil");
        const ciudad = u.ciudad || "";
        const provincia = u.provincia || "";
        inputCiudad.value = provincia ? `${ciudad} (${provincia})` : ciudad;
        if (inputProvincia) inputProvincia.value = provincia;
        if (hint) {
          hint.textContent = ciudad
            ? 'Se toma de tu perfil. Para cambiarla ve a "Mi perfil" → Mis datos.'
            : '⚠️ No tienes ciudad en tu perfil. Defínela en "Mi perfil" → Mis datos antes de publicar.';
          hint.style.color = ciudad ? "" : "#b45309";
        }
      } catch (error) {
        console.error("Error al cargar la ciudad del perfil:", error);
      }
    },

    // Muestra el campo de importe fijo o el de porcentaje según la opción elegida
    toggleRetribucion(prefijo) {
      const tipo = document.querySelector(`input[name="${prefijo}RetribucionTipo"]:checked`)?.value || 'fijo';
      const grupoFijo = document.getElementById(`${prefijo}SalarioFijoGroup`);
      const grupoPorcentaje = document.getElementById(`${prefijo}RetribucionPorcentajeGroup`);
      grupoFijo.style.display = tipo === 'fijo' ? (prefijo === 'oferta' ? 'flex' : 'block') : 'none';
      grupoPorcentaje.style.display = tipo === 'porcentaje' ? 'block' : 'none';
    },

    async eliminar(id) {
      if (!confirm("¿Estás seguro de que deseas eliminar esta publicación?")) return;

      try {
        await utils.request(`/publicaciones/${id}`, { method: "DELETE" });
        utils.mostrarAlerta("Publicación eliminada", "success");
        app.publicaciones.cargar();
        app.ui.actualizarStats();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async cargarEspecialidadesPublicar(tipo) {
      try {
        if (!estadoApp.especialidades || estadoApp.especialidades.length === 0) {
          await app.especialidades.cargar();
        }

        const containerId = `${tipo}EspecialidadesContainer`;
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = estadoApp.especialidades.map(esp => `
          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
            <input type="checkbox" value="${esp.id}" style="cursor: pointer;">
            ${esp.nombre}
          </label>
        `).join('');
      } catch (error) {
        console.error("Error al cargar especialidades:", error);
      }
    },

    marcarTodasEspecialidades(tipo) {
      const containerId = `${tipo}EspecialidadesContainer`;
      const checkboxes = document.querySelectorAll(`#${containerId} input[type="checkbox"]`);
      const marcarTodas = document.getElementById(`${tipo}MarcarTodas`);

      checkboxes.forEach(cb => {
        cb.checked = marcarTodas.checked;
      });
    },

    // Añade todos los días de un rango al calendario indicado, para no tener que
    // marcarlos uno a uno cuando son seguidos. La usan el alta y la edición de suplencia.
    anadirRangoCalendario(calId, desdeId, hastaId) {
      const desde = document.getElementById(desdeId).value;
      const hasta = document.getElementById(hastaId).value;
      if (!desde) {
        utils.mostrarAlerta("Elige al menos la fecha 'desde' del rango", "error");
        return;
      }
      const actuales = new Set(app.calendario.obtener(calId));
      utils.expandirRango(desde, hasta || desde).forEach(d => actuales.add(d));
      app.calendario.fijar(calId, [...actuales]);
      document.getElementById(desdeId).value = "";
      document.getElementById(hastaId).value = "";
    },

    // Copia al portapapeles la URL pública (indexable) de una oferta
    async copiarEnlacePublico(publicacionId) {
      const base = API || window.location.origin;
      const url = `${base}/oferta/${publicacionId}`;
      try {
        await navigator.clipboard.writeText(url);
        utils.mostrarAlerta("🔗 Enlace copiado: compártelo donde quieras", "success");
      } catch (e) {
        prompt("Copia el enlace público de la oferta:", url);
      }
    },

    async retirarPublicacion(publicacionId) {
      if (!confirm("¿Estás seguro de que deseas retirar esta publicación?")) {
        return;
      }

      try {
        await utils.request(`/publicaciones/${publicacionId}`, { method: 'DELETE' });
        utils.mostrarAlerta("Publicación retirada correctamente", "success");
        await app.publicaciones.cargar();
        await app.ui.actualizarStats();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Filtros
  // ============================================

  filtros: {
    // Recarga la lista según la vista activa: en "Dentistas" (perfiles) recarga los
    // perfiles; en el resto, las publicaciones. Los filtros de Ciudad, Radio y
    // Especialidad, comunes a ambas, cuelgan de aquí.
    buscar() {
      if (estadoApp.vistaActual === "perfiles") return app.perfiles.cargar();
      return app.publicaciones.cargar();
    },

    // Las dos búsquedas de la clínica sobre dentistas —sus perfiles ("Dentistas") y sus
    // publicaciones ("Publicaciones de dentistas")— comparten la misma búsqueda
    // reducida: Ciudad (de una lista), Radio y Especialidad.
    vistaReducida() {
      return estadoApp.tipoUsuario === "clinica" &&
        (estadoApp.vistaActual === "perfiles" || estadoApp.vistaActual === "publicaciones");
    },

    // La ciudad sale del desplegable en las búsquedas reducidas y del campo de texto
    // en el resto. Lo usan el listado y la exportación, para que miren lo mismo.
    ciudadSeleccionada() {
      const id = this.vistaReducida() ? "filterCiudadLista" : "filterCiudad";
      return document.getElementById(id)?.value || "";
    },

    // En las búsquedas reducidas se dejan solo Ciudad, Radio y Especialidad; el resto de
    // filtros se ocultan y se vacían (si no, seguirían filtrando sin verse). En las demás
    // vistas se muestran todos (Equipamiento/Certificación dependen del rol).
    configurarFiltrosVista() {
      const reducida = this.vistaReducida();
      const grupoDe = (id) => { const el = document.getElementById(id); return el && el.closest(".filter-group"); };
      const set = (id, visible) => { const g = grupoDe(id); if (g) g.style.display = visible ? "" : "none"; };

      // En "Mis Publicaciones" no se busca nada: son las propias, y salen todas. Se
      // esconde la fila de filtros entera (los botones de vista siguen arriba).
      const filaFiltros = document.getElementById("filterRow");
      if (filaFiltros) {
        filaFiltros.style.display = estadoApp.vistaActual === "mis-publicaciones" ? "none" : "";
      }

      const ocultos = ["filterQ", "filterContrato", "filterJornada", "filterRetribucion",
                       "filterSalarioMin", "filterExperienciaMin", "filterOrden"];
      ocultos.forEach(id => set(id, !reducida));

      set("filterEquipamiento", !reducida && estadoApp.tipoUsuario === "dentista");
      set("filterCertificacion", !reducida && estadoApp.tipoUsuario === "clinica");

      // La ciudad se elige de una lista en las reducidas; en el resto se escribe a mano
      const grupoTexto = document.getElementById("filterCiudadGroup");
      const grupoLista = document.getElementById("filterCiudadListaGroup");
      if (grupoTexto) grupoTexto.style.display = reducida ? "none" : "";
      if (grupoLista) grupoLista.style.display = reducida ? "" : "none";

      if (reducida) {
        // Un filtro oculto con valor filtraría a escondidas. El orden vuelve al de por
        // defecto, que en estas vistas es por ciudad.
        ocultos.filter(id => id !== "filterOrden").forEach(id => {
          const el = document.getElementById(id);
          if (el && el.value) el.value = "";
        });
        const orden = document.getElementById("filterOrden");
        if (orden && orden.value !== "recientes") orden.value = "recientes";
      }
    },

    // Rellena el desplegable de ciudad con las que hay en la vista actual: las de los
    // dentistas, o las de sus publicaciones. Cada una con su número, y el total en
    // "Todas las ciudades". Conserva la elección si sigue existiendo.
    async cargarCiudadesLista() {
      const sel = document.getElementById("filterCiudadLista");
      if (!sel || !this.vistaReducida()) return;
      const url = estadoApp.vistaActual === "perfiles"
        ? "/perfiles/ciudades?rol=dentista"
        : "/publicaciones/ciudades?tipo=solicitud";
      try {
        const data = await utils.request(url);
        const conDatos = data.ciudades || [];
        const yaListadas = new Set(conDatos.map(c => c.ciudad));

        const catalogo = window.MUNICIPIOS_ES || [];
        const provinciaDe = new Map();
        catalogo.forEach(m => { if (!provinciaDe.has(m.m)) provinciaDe.set(m.m, m.p); });
        const etiqueta = (nombre, provincia) => (provincia ? `${nombre} (${provincia})` : nombre);

        const otras = catalogo
          .filter(m => !yaListadas.has(m.m))
          .sort((a, b) => a.m.localeCompare(b.m, "es"));

        const opcion = (valor, texto) =>
          `<option value="${utils.escapeHtml(valor)}">${utils.escapeHtml(texto)}</option>`;
        const rotuloGrupo = estadoApp.vistaActual === "perfiles" ? "Con dentistas" : "Con publicaciones";

        const elegida = sel.value;
        sel.innerHTML =
          `<option value="">${utils.escapeHtml(
            data.total != null ? `Todas las ciudades · ${data.total}` : "Todas las ciudades"
          )}</option>` +
          (conDatos.length
            ? `<optgroup label="${rotuloGrupo}">` +
              conDatos.map(c => opcion(c.ciudad, `${etiqueta(c.ciudad, provinciaDe.get(c.ciudad))} · ${c.total}`)).join("") +
              `</optgroup>`
            : "") +
          (otras.length
            ? `<optgroup label="Resto de ciudades">` +
              otras.map(m => opcion(m.m, etiqueta(m.m, m.p))).join("") +
              `</optgroup>`
            : "");
        sel.value = elegida;
      } catch (error) {
        console.error("Error al cargar las ciudades:", error);
      }
    },

    // Muestra u oculta los filtros propios de la vista de suplencias (fechas, "encaja
    // con mi disponibilidad" y el conmutador Lista/Calendario) según
    // estadoApp.filtros.verSuplencias. Al salir de suplencias, además, limpia esos
    // filtros y vuelve a la lista. Se llama tanto desde publicaciones.cargar() como al
    // cambiar a otras vistas (Favoritos, Mis Postulaciones…) que no pasan por ella.
    sincronizarUISuplencias() {
      const grupoFechaDesde = document.getElementById("filterFechaDesdeGroup");
      const grupoFechaHasta = document.getElementById("filterFechaHastaGroup");
      if (grupoFechaDesde && grupoFechaHasta) {
        const mostrarFecha = estadoApp.filtros.verSuplencias ? "block" : "none";
        grupoFechaDesde.style.display = mostrarFecha;
        grupoFechaHasta.style.display = mostrarFecha;
        if (!estadoApp.filtros.verSuplencias) {
          document.getElementById("filterFechaDesde").value = "";
          document.getElementById("filterFechaHasta").value = "";
        }
      }
      // "Encajan con mi disponibilidad": solo para el dentista en la vista de suplencias
      const grupoDisp = document.getElementById("filterMiDisponibilidadGroup");
      if (grupoDisp) {
        const mostrar = estadoApp.filtros.verSuplencias && estadoApp.tipoUsuario === 'dentista';
        grupoDisp.style.display = mostrar ? "block" : "none";
        if (!mostrar) document.getElementById("filterMiDisponibilidad").checked = false;
      }
      const toggleVista = document.getElementById("suplenciasVistaToggle");
      if (toggleVista) {
        toggleVista.style.display = estadoApp.filtros.verSuplencias ? "flex" : "none";
        // Al salir de suplencias, garantizar que se ve la lista y no el calendario
        if (!estadoApp.filtros.verSuplencias) {
          document.getElementById("suplenciasCalendarioContainer").style.display = "none";
          document.getElementById("publicacionesContainer").style.display = "";
          document.getElementById("btnVistaLista")?.classList.add("active");
          document.getElementById("btnVistaCalendario")?.classList.remove("active");
        }
      }

      // Ajustar también qué filtros se muestran según la vista (la barra es compartida)
      this.configurarFiltrosVista();
    },

    mostrarTodas(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.verSuplencias = false;
      estadoApp.vistaActual = "publicaciones";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      // Actualizar título de filtros
      const filtersTitle = document.getElementById("filtrosTitle");
      if (estadoApp.tipoUsuario === 'clinica') {
        filtersTitle.textContent = "Dentistas";
      } else {
        filtersTitle.textContent = "";
      }

      // La clínica busca aquí publicaciones de dentistas: la ciudad se elige de la lista
      if (estadoApp.tipoUsuario === 'clinica') this.cargarCiudadesLista();

      app.publicaciones.cargar();
    },

    mostrarPerfiles(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = false;
      estadoApp.vistaActual = "perfiles";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = estadoApp.tipoUsuario === 'clinica' ? "Dentistas" : "Perfiles de clínicas";
      filtersTitle.style.display = "block";

      // La clínica elige la ciudad de una lista; el dentista, que busca clínicas, sigue
      // con el campo de texto y su autocompletado del catálogo.
      if (estadoApp.tipoUsuario === 'clinica') {
        this.cargarCiudadesLista();
      } else {
        app.ciudades.montar(document.getElementById("filterCiudad"), null, null, () => app.filtros.buscar());
      }

      this.sincronizarUISuplencias();
      app.perfiles.cargar();
    },

    mostrarMias(btn) {
      estadoApp.filtros.soloMias = true;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = false;
      estadoApp.vistaActual = "mis-publicaciones";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      // Actualizar título de filtros
      const filtersTitle = document.getElementById("filtrosTitle");
      if (estadoApp.tipoUsuario === 'clinica') {
        filtersTitle.textContent = "";
      } else {
        filtersTitle.textContent = "";
      }

      app.publicaciones.cargar();
    },

    mostrarMisPublicaciones(btn) {
      estadoApp.filtros.soloMias = true;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = false;
      estadoApp.vistaActual = "mis-publicaciones";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      if (estadoApp.tipoUsuario === 'clinica') {
        filtersTitle.textContent = "";
      } else {
        filtersTitle.textContent = "";
      }

      app.publicaciones.cargar();
    },

    mostrarContactadas(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = true;
      estadoApp.filtros.verSuplencias = false;
      estadoApp.vistaActual = null;
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Solicitudes contactadas";

      this.sincronizarUISuplencias();
      app.publicaciones.cargarContactadas();
    },

    mostrarFavoritos(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = false;
      estadoApp.vistaActual = "favoritos";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Favoritos";

      this.sincronizarUISuplencias();
      app.publicaciones.cargarFavoritos();
    },

    mostrarKanban(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = false;
      estadoApp.vistaActual = "mis-postulaciones";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Mis Postulaciones";
      filtersTitle.style.display = "block";

      this.sincronizarUISuplencias();
      app.kanban.render();
    },

    mostrarSuplencias(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = true;
      estadoApp.vistaActual = "suplencias";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "🚨 Suplencias y turnos sueltos";
      filtersTitle.style.display = "block";

      // Entrar siempre en modo lista (por si se quedó abierto el calendario)
      document.getElementById("suplenciasCalendarioContainer").style.display = "none";
      document.getElementById("publicacionesContainer").style.display = "";
      document.getElementById("btnVistaLista")?.classList.add("active");
      document.getElementById("btnVistaCalendario")?.classList.remove("active");

      // Se devuelve la promesa para poder esperar a que el listado esté pintado
      // (quien llega desde una notificación necesita saber cuándo puede llevar la
      // vista hasta él; antes de cargar no hay altura a la que desplazarse).
      return app.publicaciones.cargar();
    },

    mostrarMisPostulaciones(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      estadoApp.vistaActual = "mis-postulaciones";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Postulaciones a Clínicas";

      app.stats.mostrarMisPostulaciones();
    },

    mostrarMisAceptadas(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      estadoApp.vistaActual = null;
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Postulaciones a Clínicas Aceptadas";

      app.stats.mostrarMisPostulacionesAceptadas();
    },

    mostrarMisPostulacionesDentistas(btn) {
      estadoApp.vistaActual = "mis-postulaciones";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Mis Postulaciones a Dentistas";

      app.stats.mostrarMisPostulacionesDentistas();
    },

    mostrarMisPostulacionesDentistasAceptadas(btn) {
      estadoApp.vistaActual = null;
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Mis Postulaciones a Dentistas Aceptadas";

      app.stats.mostrarMisPostulacionesDentistasAceptadas();
    },

    setTipo(tipo, btn) {
      estadoApp.filtros.tipo = tipo;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      app.publicaciones.cargar();
    }
  },

  // ============================================
  // Módulo: Modal
  // ============================================

  modal: {
    cerrarTodosModales() {
      // Al cerrarlo todo, el detalle deja de estar apilado sobre nada
      document.getElementById("modalDetalle")?.classList.remove("modal-encima");

      // Cerrar todos los modales para evitar bloqueos
      const modales = [
        "modalAuth",
        "modalChat",
        "modalResenya",
        "modalPublicar",
        "modalDetalle",
        "modalPostulaciones",
        "modalContacto",
        "modalCandidatos",
        "modalInteresados",
        "modalOpcionesStats",
        "modalOpcionesClinicas",
        "modalOpcionesClinicasPotenciales",
        "modalContactarPerfil"
      ];
      modales.forEach(id => {
        const modal = document.getElementById(id);
        if (modal) {
          modal.classList.remove("active");
          modal.style.display = "none";
          modal.style.pointerEvents = "none";
          modal.style.opacity = "0";
          modal.style.visibility = "hidden";
          modal.style.zIndex = "-1";
        }
      });

      // Limpiar any stray overlays
      document.querySelectorAll(".modal").forEach(modal => {
        if (!modal.classList.contains("active")) {
          modal.style.display = "none";
          modal.style.pointerEvents = "none";
          modal.style.visibility = "hidden";
          modal.style.zIndex = "-1";
        }
      });

      // Asegurar que body no tenga estilos bloqueantes
      document.body.style.overflow = "";
      document.body.style.pointerEvents = "auto";
    },

    abrirPublicar() {
      if (!estadoApp.token) {
        utils.mostrarAlerta("Debes iniciar sesión para publicar", "error");
        return;
      }

      // Mostrar/ocultar tabs según tipo de usuario
      if (estadoApp.tipoUsuario === 'clinica') {
        // Empresa elige entre Oferta fija y Suplencia
        document.getElementById("tabsPublicar").style.display = "flex";
        document.getElementById("tabBtnOferta").style.display = "inline-block";
        document.getElementById("tabBtnSuplencia").style.display = "inline-block";
        document.getElementById("tabBtnSolicitud").style.display = "none";
        document.getElementById("tab-oferta").classList.add("active");
        document.getElementById("tab-suplencia").classList.remove("active");
        document.getElementById("tab-solicitud").classList.remove("active");
        document.getElementById("tabBtnOferta").classList.add("active");
        document.getElementById("tabBtnSuplencia").classList.remove("active");
        app.publicaciones.cargarEspecialidadesPublicar('oferta');
        app.publicaciones.cargarEspecialidadesPublicar('suplencia');
        app.plantillas.cargar('oferta');
        app.plantillas.cargar('suplencia');
        app.sedes.cargarEnSelector('oferta');
        app.sedes.cargarEnSelector('suplencia');
        app.catalogos.renderizarEquipamientoPublicar('oferta');
        app.catalogos.renderizarEquipamientoPublicar('suplencia');
        app.publicaciones.toggleRetribucion('oferta');
        app.publicaciones.toggleRetribucion('suplencia');
        app.calendario.crear("suplenciaCalendario", {});
        document.getElementById("suplenciaRangoDesde").value = "";
        document.getElementById("suplenciaRangoHasta").value = "";
        document.getElementById("modalPublicarTitle").textContent = "Publicar nueva oferta";
      } else {
        // Candidato solo ve tab de Solicitud
        document.getElementById("tabsPublicar").style.display = "none";
        document.getElementById("tabBtnOferta").style.display = "none";
        document.getElementById("tabBtnSuplencia").style.display = "none";
        document.getElementById("tabBtnSolicitud").style.display = "inline-block";
        document.getElementById("tab-solicitud").classList.add("active");
        document.getElementById("tab-oferta").classList.remove("active");
        document.getElementById("tab-suplencia").classList.remove("active");
        document.getElementById("tabBtnSolicitud").classList.add("active");
        app.publicaciones.cargarEspecialidadesPublicar('solicitud');
        app.plantillas.cargar('solicitud');
        document.getElementById("modalPublicarTitle").textContent = "Publicar nueva solicitud";
        // La ciudad de la solicitud se hereda del perfil (no editable)
        app.publicaciones.rellenarCiudadSolicitudDesdePerfil();
      }

      document.getElementById("modalPublicar").classList.add("active");
    },

    cerrarPublicar() {
      document.getElementById("modalPublicar").classList.remove("active");
    },

    abrirAuthEmpresa() {
      document.getElementById("modalAuthEmpresa").classList.add("active");
    },

    cerrarAuthEmpresa() {
      document.getElementById("modalAuthEmpresa").classList.remove("active");
    },

    abrirAuthCandidato() {
      document.getElementById("modalAuthCandidato").classList.add("active");
    },

    cerrarAuthCandidato() {
      document.getElementById("modalAuthCandidato").classList.remove("active");
    },

    abrirPerfil() {
      document.getElementById("modalPerfil").classList.add("active");
      app.perfil.cargar();
    },

    cerrarPerfil() {
      document.getElementById("modalPerfil").classList.remove("active");
      // Los pasos de perfil/disponibilidad/CV/sedes se editan aquí: refrescar el onboarding
      app.onboarding.refrescar();
    },

    switchTab(tab) {
      document.querySelectorAll("#modalPublicar .tab-content").forEach(el => el.classList.remove("active"));
      document.querySelectorAll("#modalPublicar .tab-btn").forEach(el => el.classList.remove("active"));

      document.getElementById(`tab-${tab}`).classList.add("active");
      event.target.classList.add("active");

      const titulos = { oferta: "Publicar nueva oferta", suplencia: "🚨 Publicar suplencia / turno suelto", solicitud: "Publicar nueva solicitud" };
      document.getElementById("modalPublicarTitle").textContent = titulos[tab] || "Publicar";
    },

    abrirDetalleConManejo(publicacion) {
      this.abrirDetalle(publicacion).catch(error => {
        console.error("Error al cargar detalles:", error);
        utils.mostrarAlerta("Error al cargar detalles de la publicación", "error");
      });
    },

    // Tarjeta de compatibilidad. El porcentaje NUNCA va solo: se enseña siempre con
    // el desglose por dimensión, que es lo que lo hace accionable (y lo que evita
    // que parezca un modelo entrenado que no es). Si el backend dice que no hay
    // cobertura suficiente (porcentaje null), no se muestra número: se pide el dato.
    // `opts.contraparte`: con quién se compara ("esta clínica" para un dentista,
    // "este dentista" para una clínica). `opts.ladoViewer`: qué valor de `falta`
    // corresponde a quien mira ('dentista' | 'clinica'), para redactar bien el aviso
    // de datos que faltan.
    renderCompatibilidad(compat, opts = {}) {
      if (!compat || !Array.isArray(compat.dimensiones)) return "";

      const contraparte = opts.contraparte || "esta clínica";
      const ladoViewer = opts.ladoViewer || "dentista";

      const ICONOS = { coincide: "✅", parcial: "🟡", discrepa: "❌", sin_datos: "➖" };
      const COLORES = { coincide: "#16a34a", parcial: "#f59e0b", discrepa: "#dc2626", sin_datos: "#9ca3af" };

      // Marca las dimensiones que el dentista ha priorizado, para que el desglose
      // explique por qué el % se inclina hacia unas cosas más que otras.
      const MARCA_PRIORIDAD = {
        alta: `<span title="Le das mucha importancia" style="color:#0F4C75; font-size:.75rem;">⬆ priorizas</span>`,
        baja: `<span title="Le das poca importancia" style="color:#9ca3af; font-size:.75rem;">⬇ menos</span>`
      };

      const filas = compat.dimensiones.map(d => `
        <div style="display: flex; align-items: baseline; gap: .5rem; padding: .45rem 0; border-top: 1px solid #eef2f7;">
          <span>${ICONOS[d.estado] || "➖"}</span>
          <span style="font-weight: 600; color: #0F4C75; min-width: 8.5rem;">${utils.escapeHtml(d.etiqueta)} ${MARCA_PRIORIDAD[d.prioridad] || ""}</span>
          <span style="color: ${COLORES[d.estado] || "#6b7280"}; font-size: .9rem;">${utils.escapeHtml(d.detalle || "")}</span>
        </div>
      `).join("");

      // Sin cobertura suficiente: en vez de un número inventado, se dice qué falta
      // y de quién es el dato (el motor lo devuelve en `falta`).
      if (compat.porcentaje === null) {
        const faltaTuyo = compat.dimensiones.some(d => d.estado === 'sin_datos' && d.falta === ladoViewer);
        const msgTuyo = ladoViewer === 'clinica'
          ? `Responde el test de compatibilidad de tu perfil y te diremos cuánto encajáis con ${contraparte}.`
          : "Completa tu solicitud (salario y jornada que buscas), tu calendario, tus certificaciones y el test de compatibilidad de tu perfil, y te diremos cuánto encajas con esta clínica.";
        const msgOtro = ladoViewer === 'clinica'
          ? "Este dentista aún no ha respondido el test de compatibilidad de su perfil."
          : "Esta clínica aún no ha detallado lo suficiente su oferta para calcular tu compatibilidad.";
        return `
          <div style="background: #F8FAFF; border: 1px solid #dbe4f0; border-left: 4px solid #9ca3af; border-radius: 10px; padding: 1rem; margin-bottom: 1.25rem;">
            <div style="font-weight: 700; color: #0F4C75; margin-bottom: .25rem;">🧩 Compatibilidad: faltan datos</div>
            <p style="color: #6b7280; font-size: .9rem; margin: 0 0 .5rem;">
              ${faltaTuyo ? msgTuyo : msgOtro}
            </p>
            ${filas}
          </div>`;
      }

      const pct = compat.porcentaje;
      const color = pct >= 80 ? "#16a34a" : pct >= 55 ? "#f59e0b" : "#dc2626";

      // El subtítulo nombra SIEMPRE las dimensiones que de verdad han entrado en el
      // cálculo (las que no tienen dato quedan fuera): así el % nunca aparenta
      // apoyarse en más información de la que tiene.
      const evaluadas = compat.dimensiones
        .filter(d => d.estado !== 'sin_datos')
        .map(d => d.etiqueta.toLowerCase());
      const base = evaluadas.length > 1
        ? `${evaluadas.slice(0, -1).join(", ")} y ${evaluadas[evaluadas.length - 1]}`
        : evaluadas[0] || "";
      const faltan = compat.dimensiones.filter(d => d.estado === 'sin_datos').length;

      return `
        <div style="background: #F8FAFF; border: 1px solid #dbe4f0; border-left: 4px solid ${color}; border-radius: 10px; padding: 1rem; margin-bottom: 1.25rem;">
          <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: .6rem;">
            <div style="font-size: 2.1rem; font-weight: 800; color: ${color}; line-height: 1;">${pct}%</div>
            <div>
              <div style="font-weight: 700; color: #0F4C75;">de compatibilidad con ${contraparte}</div>
              <div style="color: #6b7280; font-size: .85rem;">
                Según ${utils.escapeHtml(base)}${faltan ? ` · faltan ${faltan} de ${compat.dimensiones.length} por responder` : ""}
              </div>
            </div>
          </div>
          <div style="background: #e5e7eb; border-radius: 99px; height: 7px; overflow: hidden; margin-bottom: .5rem;">
            <div style="width: ${pct}%; height: 100%; background: ${color};"></div>
          </div>
          ${filas}
        </div>`;
    },

    async abrirDetalle(publicacion) {
      estadoApp.publicacionActual = publicacion;

      // Registrar vista si quien mira no es el dueño
      if (publicacion.usuario_id !== estadoApp.usuario?.id) {
        utils.request(`/publicaciones/${publicacion.id}/vista`, { method: 'POST' })
          .catch(err => console.error("Error al registrar vista:", err));
      }

      // Cargar especialidades de la publicación
      let especialidadesText = "";
      try {
        const data = await utils.request(`/publicaciones/${publicacion.id}/especialidades`, { method: 'GET' });
        if (data && data.especialidades && data.especialidades.length > 0) {
          especialidadesText = data.especialidades.map(e => e.nombre).join(", ");
        }
      } catch (error) {
        console.error("Error al cargar especialidades:", error);
      }

      // Equipamiento (solo relevante en ofertas y suplencias)
      let equipamientoText = "";
      if (publicacion.tipo === 'oferta' || publicacion.tipo === 'suplencia') {
        try {
          const data = await utils.request(`/publicaciones/${publicacion.id}/equipamiento`, { method: 'GET' });
          if (data && data.equipamiento && data.equipamiento.length > 0) {
            equipamientoText = data.equipamiento.join(", ");
          }
        } catch (error) {
          console.error("Error al cargar equipamiento:", error);
        }
      }

      // Días concretos de la suplencia (los trae el detalle /publicaciones/:id)
      let diasSuplencia = [];
      if (publicacion.tipo === 'suplencia') {
        try {
          const det = await utils.request(`/publicaciones/${publicacion.id}`);
          diasSuplencia = det.dias || [];
        } catch (error) { /* sin días */ }
      }

      // Compatibilidad, en los dos sentidos: un dentista mirando una oferta/suplencia
      // ajena («…con esta clínica»), o una clínica mirando la solicitud de un dentista
      // («…con este dentista»). Si el backend no puede dar un porcentaje honesto, la
      // tarjeta lo dice y pide el dato que falta en vez de inventarse un número.
      let compatibilidadHtml = "";
      const tipoViewer = estadoApp.usuario?.tipo;
      const esAjena = publicacion.usuario_id !== estadoApp.usuario?.id;
      const dentistaVeOferta = tipoViewer === 'dentista' && (publicacion.tipo === 'oferta' || publicacion.tipo === 'suplencia');
      const clinicaVeSolicitud = tipoViewer === 'clinica' && publicacion.tipo === 'solicitud';
      if (esAjena && (dentistaVeOferta || clinicaVeSolicitud)) {
        try {
          const compat = await utils.request(`/publicaciones/${publicacion.id}/compatibilidad`);
          const opts = clinicaVeSolicitud
            ? { contraparte: "este dentista", ladoViewer: "clinica" }
            : { contraparte: "esta clínica", ladoViewer: "dentista" };
          compatibilidadHtml = app.modal.renderCompatibilidad(compat, opts);
        } catch (error) {
          console.error("Error al calcular la compatibilidad:", error);
        }
      }

      let html = compatibilidadHtml + `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
          <tbody>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; width: 30%; color: #0F4C75;">ID:</td>
              <td style="padding: 0.8rem;">${publicacion.id}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">Tipo:</td>
              <td style="padding: 0.8rem;">${publicacion.tipo === 'oferta' ? '📋 Oferta' : publicacion.tipo === 'suplencia' ? `🚨 Suplencia${publicacion.urgente ? ' (urgente)' : ''}` : '🔍 Solicitud'}</td>
            </tr>
            ${publicacion.tipo === 'suplencia' && (diasSuplencia.length || publicacion.fecha_desde) ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🗓️ Días:</td>
              <td style="padding: 0.8rem;">${diasSuplencia.length
                ? `<div class="badges" style="gap:.3rem;">${diasSuplencia.map(d => `<span class="badge">${utils.escapeHtml(utils.formatearDia(d))}</span>`).join("")}</div>`
                : utils.escapeHtml([publicacion.fecha_desde, publicacion.fecha_hasta].filter(Boolean).join(' → '))}</td>
            </tr>
            ` : ''}
            ${publicacion.usuario_nombre ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">Publicado por:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.usuario_nombre)} (${publicacion.usuario_tipo === 'clinica' ? '🏥 Clínica' : '👨‍⚕️ Dentista'})</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📍 Ciudad:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.ciudad)}</td>
            </tr>
            ${especialidadesText ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🦷 Especialidades:</td>
              <td style="padding: 0.8rem;">${especialidadesText}</td>
            </tr>
            ` : ''}
            ${publicacion.contrato ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📋 Contrato:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.contrato)}</td>
            </tr>
            ` : ''}
            ${publicacion.jornada ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">⏰ Jornada:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.jornada)}</td>
            </tr>
            ` : ''}
            ${publicacion.retribucion_tipo === 'porcentaje' && publicacion.retribucion_porcentaje ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">💰 Retribución:</td>
              <td style="padding: 0.8rem;">${publicacion.retribucion_porcentaje}% de facturación</td>
            </tr>
            ` : publicacion.salario ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">💰 Salario:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.salario)}</td>
            </tr>
            ` : ''}
            ${equipamientoText ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🔬 Equipamiento:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(equipamientoText)}</td>
            </tr>
            ` : ''}
            ${publicacion.experiencia_minima !== null && publicacion.experiencia_minima !== undefined ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🎓 Experiencia:</td>
              <td style="padding: 0.8rem;">${publicacion.experiencia_minima} años</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📅 Publicado:</td>
              <td style="padding: 0.8rem;">${utils.formatearFecha(publicacion.creado_en)}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">👤 Contacto - Nombre:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.nombre_contacto)}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📧 Contacto - Email:</td>
              <td style="padding: 0.8rem;"><a href="mailto:${utils.escapeHtml(publicacion.email_contacto)}" style="color: #0F4C75; text-decoration: none;">${utils.escapeHtml(publicacion.email_contacto)}</a></td>
            </tr>
            ${publicacion.telefono_contacto ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📞 Contacto - Teléfono:</td>
              <td style="padding: 0.8rem;"><a href="tel:${utils.escapeHtml(publicacion.telefono_contacto)}" style="color: #0F4C75; text-decoration: none;">${utils.escapeHtml(publicacion.telefono_contacto)}</a></td>
            </tr>
            ` : ''}
          </tbody>
        </table>

        <h4 style="margin: 1rem 0 0.5rem; color: #0F4C75; font-weight: 700;">Descripción</h4>
        <p style="white-space: pre-wrap; line-height: 1.6; background: #fff; padding: 1rem; border-radius: 8px; border: 1px solid #e5e7eb;">${utils.escapeHtml(publicacion.descripcion)}</p>

        <div id="detalleContacto" style="display: none;"></div>
      `;

      // Agregar botón de editar si es propietario
      const esPropio = publicacion.usuario_id === estadoApp.usuario?.id;
      if (esPropio) {
        html = `<div id="detalleVistaPrevia">${html}</div>
                <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
                  <button class="btn-primary" onclick="app.modal.activarEdicionConManejo()">Editar</button>
                  <button class="btn-text" onclick="app.modal.cerrarDetalle()">Cerrar</button>
                </div>`;
      } else if (estadoApp.usuario && publicacion.usuario_id) {
        const nombreOtro = (publicacion.usuario_nombre || publicacion.nombre_contacto || 'Usuario').replace(/'/g, "\\'");
        let candidaturaAceptada = false;
        try {
          const misPostulaciones = await utils.request('/candidaturas/mis-postulaciones');
          candidaturaAceptada = (misPostulaciones.candidaturas || []).some(
            c => c.publicacion_id === publicacion.id && c.estado === 'aceptada'
          );
        } catch (error) {
          console.error("Error al comprobar postulación:", error);
        }

        if (candidaturaAceptada) {
          html += `<div style="margin-top: 1.5rem;">
                    <button class="btn-primary" onclick="app.chat.abrirConDestinatario(${publicacion.id}, ${publicacion.usuario_id}, '${nombreOtro}')">💬 Enviar mensaje</button>
                  </div>`;
        }
      }

      document.getElementById("detalleBody").innerHTML = html;
      document.getElementById("detalleTitle").textContent = publicacion.tipo === "oferta" ? "Oferta de trabajo" : publicacion.tipo === "suplencia" ? "Suplencia / turno suelto" : "Solicitud de empleo";

      // Ocultar sección de contacto si es propia publicación
      const detalleContacto = document.getElementById("detalleContacto");
      if (esPropio) {
        detalleContacto.style.display = "none";
      } else {
        detalleContacto.style.display = "block";
      }

      document.getElementById("modalDetalle").classList.add("active");
    },

    activarEdicionConManejo() {
      this.activarEdicion().catch(error => {
        console.error("Error al activar edición:", error);
        utils.mostrarAlerta("Error al cargar formulario de edición", "error");
      });
    },

    async activarEdicion() {
      const pub = estadoApp.publicacionActual;

      // Obtener especialidades actuales
      let especialidadesActuales = [];
      try {
        const data = await utils.request(`/publicaciones/${pub.id}/especialidades`, { method: 'GET' });
        if (data && data.especialidades) {
          especialidadesActuales = data.especialidades.map(e => e.id);
        }
      } catch (error) {
        console.error("Error al cargar especialidades:", error);
      }

      // Preguntas de criba actuales (JSON) para prerrellenar el formulario
      let preguntasActuales = [];
      try {
        preguntasActuales = pub.preguntas ? (typeof pub.preguntas === 'string' ? JSON.parse(pub.preguntas) : pub.preguntas) : [];
      } catch (e) { preguntasActuales = []; }

      // Días actuales de la suplencia, para prerrellenar el calendario de edición
      let diasActuales = [];
      if (pub.tipo === 'suplencia') {
        try {
          const det = await utils.request(`/publicaciones/${pub.id}`);
          diasActuales = det.dias || [];
        } catch (e) { diasActuales = []; }
      }

      let html = `
        <form id="formEdicion" onsubmit="event.preventDefault(); app.modal.guardarEdicion();">
          <div class="form-group">
            <label for="editDescripcion">Descripción *</label>
            <textarea id="editDescripcion" required>${utils.escapeHtml(pub.descripcion)}</textarea>
          </div>
          ${pub.tipo !== 'solicitud' ? `
          <div class="form-group">
            <label>Preguntas de criba <span style="color:#6b7280;font-weight:normal;">(opcional, máx. 3)</span></label>
            <small style="color:#6b7280;display:block;margin-bottom:0.5rem;">El candidato deberá responderlas al postularse.</small>
            ${[0, 1, 2].map(i => `<input class="editPregunta" type="text" maxlength="200" value="${utils.escapeHtml(preguntasActuales[i] || '')}" placeholder="Pregunta ${i + 1}" style="margin-bottom:0.4rem;">`).join('')}
          </div>` : ''}
          <div class="form-group">
            <label for="editCiudad">Ciudad *</label>
            <input id="editCiudad" type="text" value="${utils.escapeHtml(pub.ciudad)}" required>
          </div>
          <div class="form-group">
            <label>Especialidades</label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; margin-bottom: 0.5rem;">
              <input type="checkbox" id="editMarcarTodas" onchange="app.modal.marcarTodasEspecialidadesEdicion()">
              <strong>Marcar todas</strong>
            </label>
            <div id="editEspecialidadesContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              ${estadoApp.especialidades.map(e => `
                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                  <input type="checkbox" class="editEspecialidadCheck" value="${e.id}" ${especialidadesActuales.includes(e.id) ? 'checked' : ''}>
                  <span>${e.nombre}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="form-group">
            <label for="editContrato">Contrato</label>
            <select id="editContrato">
              <option value="">Seleccionar...</option>
              <option value="Indefinido" ${pub.contrato === 'Indefinido' ? 'selected' : ''}>Indefinido</option>
              <option value="Temporal" ${pub.contrato === 'Temporal' ? 'selected' : ''}>Temporal</option>
              <option value="Autónomo" ${pub.contrato === 'Autónomo' ? 'selected' : ''}>Autónomo</option>
              <option value="Prácticas" ${pub.contrato === 'Prácticas' ? 'selected' : ''}>Prácticas</option>
            </select>
          </div>
          <div class="form-group">
            <label for="editJornada">Jornada</label>
            <select id="editJornada">
              <option value="">Seleccionar...</option>
              <option value="Completa" ${pub.jornada === 'Completa' ? 'selected' : ''}>Completa</option>
              <option value="Parcial" ${pub.jornada === 'Parcial' ? 'selected' : ''}>Parcial</option>
              <option value="Flexible" ${pub.jornada === 'Flexible' ? 'selected' : ''}>Flexible</option>
            </select>
          </div>
          ${pub.tipo === 'suplencia' ? `
          <div class="form-group">
            <label>Días de la suplencia *</label>
            <div style="display: flex; gap: 0.5rem; align-items: flex-end; flex-wrap: wrap; margin-bottom: 0.7rem;">
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.8rem;">Añadir rango: desde</label>
                <input id="editRangoDesde" type="date">
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.8rem;">hasta</label>
                <input id="editRangoHasta" type="date">
              </div>
              <button type="button" class="btn-outline btn-small" onclick="app.publicaciones.anadirRangoCalendario('editSuplenciaCalendario','editRangoDesde','editRangoHasta')" style="margin-bottom: 0.15rem;">+ Añadir</button>
            </div>
            <div id="editSuplenciaCalendario"></div>
          </div>` : ''}
          <div class="form-group">
            <label for="editSalario">Salario</label>
            <input id="editSalario" type="text" value="${utils.escapeHtml(pub.salario || '')}">
          </div>
          <div class="form-group">
            <label for="editExperiencia">Años de experiencia</label>
            <input id="editExperiencia" type="number" min="0" value="${pub.experiencia_minima ?? ''}">
          </div>
          <div class="form-group">
            <label for="editNombreContacto">Nombre de contacto *</label>
            <input id="editNombreContacto" type="text" value="${utils.escapeHtml(pub.nombre_contacto)}" required>
          </div>
          <div class="form-group">
            <label for="editEmailContacto">Email de contacto *</label>
            <input id="editEmailContacto" type="email" value="${utils.escapeHtml(pub.email_contacto)}" required>
          </div>
          <div class="form-group">
            <label for="editTelefonoContacto">Teléfono de contacto</label>
            <input id="editTelefonoContacto" type="text" value="${utils.escapeHtml(pub.telefono_contacto || '')}">
          </div>
          <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
            <button type="submit" class="btn-primary">Guardar</button>
            <button type="button" class="btn-text" onclick="app.modal.cerrarTodosModales()">Cancelar</button>
          </div>
        </form>
      `;

      document.getElementById("detalleBody").innerHTML = html;
      document.getElementById("detalleTitle").textContent = "Editar publicación";

      if (pub.tipo === 'suplencia') {
        app.calendario.crear("editSuplenciaCalendario", { seleccion: diasActuales });
      }
    },

    marcarTodasEspecialidadesEdicion() {
      const checkAll = document.getElementById("editMarcarTodas").checked;
      document.querySelectorAll(".editEspecialidadCheck").forEach(cb => cb.checked = checkAll);
    },

    // Genérica para cualquier contenedor de checkboxes
    marcarTodasEnContenedor(containerId) {
      const checkbox = document.querySelector(`#${containerId}MarcarTodas`);
      if (!checkbox) return;
      const checkboxes = document.querySelectorAll(`#${containerId} input[type="checkbox"]:not(#${containerId}MarcarTodas)`);
      checkboxes.forEach(cb => cb.checked = checkbox.checked);
    },

    async guardarEdicion() {
      try {
        const pub = estadoApp.publicacionActual;
        const especialidades = Array.from(document.querySelectorAll(".editEspecialidadCheck:checked")).map(cb => parseInt(cb.value));

        const data = {
          descripcion: document.getElementById("editDescripcion").value,
          ciudad: document.getElementById("editCiudad").value,
          especialidades: especialidades,
          contrato: document.getElementById("editContrato").value || null,
          jornada: document.getElementById("editJornada").value || null,
          salario: document.getElementById("editSalario").value || null,
          experiencia: document.getElementById("editExperiencia").value || null,
          nombre_contacto: document.getElementById("editNombreContacto").value,
          email_contacto: document.getElementById("editEmailContacto").value,
          telefono_contacto: document.getElementById("editTelefonoContacto").value || null
        };

        // Preguntas de criba (solo se envían si el formulario las incluye, es decir, no en solicitudes)
        const camposPregunta = document.querySelectorAll(".editPregunta");
        if (camposPregunta.length > 0) {
          data.preguntas = Array.from(camposPregunta).map(i => i.value.trim()).filter(v => v);
        }

        // Días de la suplencia (solo si es una suplencia y el calendario existe)
        if (pub.tipo === 'suplencia') {
          const dias = app.calendario.obtener("editSuplenciaCalendario");
          if (dias.length === 0) {
            utils.mostrarAlerta("Marca en el calendario al menos un día para la suplencia", "error");
            return;
          }
          data.dias = dias;
        }

        await utils.request(`/publicaciones/${pub.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
          headers: { 'Content-Type': 'application/json' }
        });

        utils.mostrarAlerta("Publicación actualizada", "success");
        app.modal.cerrarDetalle();
        app.publicaciones.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    cerrarDetalle() {
      // Si el detalle se abrió por encima de otro modal (p. ej. el perfil o el Book de
      // un candidato sobre la lista de candidatos), se cierra solo él y se vuelve a lo
      // que había debajo, en vez de cerrarlo todo.
      const detalle = document.getElementById("modalDetalle");
      if (detalle && detalle.classList.contains("modal-encima")) {
        detalle.classList.remove("modal-encima", "active");
        return;
      }
      this.cerrarTodosModales();
    },

    abrirContacto() {
      document.getElementById("modalDetalle").classList.remove("active");
      document.getElementById("modalContacto").classList.add("active");
    },

    cerrarContacto() {
      document.getElementById("modalContacto").classList.remove("active");
    },

    abrirPostulaciones() {
      document.getElementById("modalPostulaciones").classList.add("active");
      app.candidaturas.cargarMisPostulaciones();
    },

    cerrarPostulaciones() {
      document.getElementById("modalPostulaciones").classList.remove("active");
    },

    // `centro` es la sede a la que va destinada la publicación: es lo que identifica de
    // un vistazo a qué se han postulado estos dentistas.
    abrirCandidatos(publicacionId, centro) {
      document.getElementById("modalCandidatos").classList.add("active");
      const titulo = document.querySelector("#modalCandidatos .modal-header h2");
      if (titulo) {
        titulo.textContent = centro || "Dentistas";
      }
      app.candidaturas.cargarCandidatos(publicacionId);
    },

    cerrarCandidatos() {
      document.getElementById("modalCandidatos").classList.remove("active");
    },

    // Preguntas de criba (killer questions) de la oferta a la que se postula el
    // candidato. Se leen de estadoApp.publicacionActual.preguntas (JSON) y se
    // pintan como campos obligatorios encima del mensaje.
    renderPreguntasCriba() {
      const cont = document.getElementById("postulacionPreguntas");
      if (!cont) return;
      let preguntas = [];
      try {
        const raw = estadoApp.publicacionActual && estadoApp.publicacionActual.preguntas;
        preguntas = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
      } catch (e) { preguntas = []; }

      if (!Array.isArray(preguntas) || preguntas.length === 0) {
        cont.innerHTML = "";
        return;
      }
      cont.innerHTML = `
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:1rem;margin-bottom:1rem;">
          <p style="margin:0 0 0.75rem 0;font-weight:600;color:#0c4a6e;font-size:0.9rem;">📋 La clínica quiere que respondas${preguntas.length === 1 ? " a esta pregunta" : " a estas preguntas"}:</p>
          ${preguntas.map((p, i) => `
            <div class="form-group" style="margin-bottom:0.75rem;">
              <label for="preguntaCriba${i}" style="font-size:0.88rem;">${utils.escapeHtml(p)} <span style="color:#dc2626;">*</span></label>
              <textarea id="preguntaCriba${i}" data-pregunta-criba="${i}" required style="min-height:60px;" placeholder="Tu respuesta…"></textarea>
            </div>`).join("")}
        </div>`;
    },

    abrirPostularseModal() {
      document.getElementById("modalPostularseForm").classList.add("active");
      document.getElementById("postulacionMensaje").value = "";
      document.getElementById("postulacionError").style.display = "none";
      this.renderPreguntasCriba();
    },

    abrirPostularseDesdeOferta(oferta) {
      if (typeof oferta === 'string') {
        oferta = JSON.parse(oferta);
      }
      estadoApp.publicacionActual = oferta;
      document.getElementById("modalPostularseForm").classList.add("active");
      document.getElementById("postulacionMensaje").value = "";
      document.getElementById("postulacionError").style.display = "none";
      this.renderPreguntasCriba();
    },

    cerrarPostularseModal() {
      document.getElementById("modalPostularseForm").classList.remove("active");
    },

    async abrirInteresados(publicacionId, tipo) {
      try {
        if (tipo === 'solicitud') {
          // Para dentistas: mismo flujo que clínicas
          app.stats.mostrarPostulacionesRecibidas();
        } else {
          // Para clínicas: mostrar mensajes
          const mensajes = await utils.request(`/mensajes/${publicacionId}`);
          const interesados = [];
          const visitados = new Set();

          mensajes.forEach(m => {
            if (!visitados.has(m.remitente_email)) {
              visitados.add(m.remitente_email);
              interesados.push(m);
            }
          });

          const label = tipo === "oferta" ? "Candidatos" : "Empresas";
          let html = `<h3>${interesados.length} ${label} interesado${interesados.length !== 1 ? 's' : ''}</h3>`;

          if (interesados.length === 0) {
            html += `<p>Aún no hay ${label.toLowerCase()} interesados.</p>`;
          } else {
            html += `<div class="interesados-list">`;
            interesados.forEach(m => {
              html += `
                <div class="interesado-item">
                  <div class="interesado-header">
                    <strong>${utils.escapeHtml(m.remitente_nombre)}</strong>
                    <span class="interesado-email">${utils.escapeHtml(m.remitente_email)}</span>
                  </div>
                  <p class="interesado-mensaje">${utils.escapeHtml(m.cuerpo)}</p>
                  <span class="interesado-fecha">${utils.formatearFecha(m.creado_en)}</span>
                </div>
              `;
            });
            html += `</div>`;
          }

          document.getElementById("modalInteresados").querySelector(".modal-content").innerHTML = `
            <div class="modal-header">
              <h2>${label} Interesados</h2>
              <button class="close-btn" onclick="app.modal.cerrarInteresados()">✕</button>
            </div>
            ${html}
          `;
          document.getElementById("modalInteresados").classList.add("active");
        }
      } catch (error) {
        console.error("ERROR en abrirInteresados:", error);
        utils.mostrarAlerta(error.message, "error");
      }
    },

    cerrarInteresados() {
      this.cerrarTodosModales();
    }
  },

  // ============================================
  // Módulo: Contacto
  // ============================================

  contacto: {
    async enviar() {
      if (!estadoApp.publicacionActual) return;

      const nombre = document.getElementById("contactoNombre").value;
      const email = document.getElementById("contactoEmail").value;
      const cuerpo = document.getElementById("contactoMensaje").value;

      if (!nombre || !email || !cuerpo) {
        utils.mostrarAlerta("Por favor completa todos los campos", "error");
        return;
      }

      try {
        await utils.request("/mensajes", {
          method: "POST",
          body: JSON.stringify({
            publicacion_id: estadoApp.publicacionActual.id,
            remitente_nombre: nombre,
            remitente_email: email,
            cuerpo: cuerpo
          })
        });

        utils.mostrarAlerta("¡Mensaje enviado exitosamente!", "success");
        app.modal.cerrarContacto();
        document.getElementById("contactoNombre").value = "";
        document.getElementById("contactoEmail").value = "";
        document.getElementById("contactoMensaje").value = "";
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Stats
  // ============================================

  stats: {
    async mostrarTotalDentistas() {
      document.getElementById("modalOpcionesStats").classList.add("active");
    },

    async mostrarTotalClinicas() {
      document.getElementById("modalOpcionesClinicas").classList.add("active");
    },

    async mostrarClinicasPorEspecialidad() {
      try {
        const datos = await utils.request("/stats/clinicas-por-especialidad");
        let html = `<p style="margin: 0 0 1rem 0; padding: 0.75rem 1rem; background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px; font-size: 0.85rem; color: #0c4a6e;">ℹ️ Una clínica puede cubrir varias especialidades a la vez, así que puede aparecer en más de una — la suma de los números no tiene por qué coincidir con el total de clínicas.</p>`;
        html += "<div class='desglose-list'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          datos.forEach(d => {
            html += `
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarClinicasEspecialidad('${utils.escapeHtml((d.especialidad || "Sin especialidad").replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.especialidad || "Sin especialidad")}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesClinicas").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Clínicas por Especialidad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasPorCiudad() {
      try {
        const datos = await utils.request("/stats/clinicas-por-ciudad");
        let html = "<div class='desglose-list'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          datos.forEach(d => {
            html += `
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarClinicasCiudad('${utils.escapeHtml(d.ciudad.replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.ciudad)}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesClinicas").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Clínicas por Ciudad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasPorCiudadEspecialidad() {
      try {
        const datos = await utils.request("/stats/clinicas-por-ciudad-especialidad");
        let html = `<p style="margin: 0 0 1rem 0; padding: 0.75rem 1rem; background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px; font-size: 0.85rem; color: #0c4a6e;">ℹ️ Una clínica puede cubrir varias especialidades a la vez, así que puede aparecer en más de una — la suma de los números no tiene por qué coincidir con el total de clínicas.</p>`;
        html += "<div class='desglose-grupos'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          let ciudadActual = null;
          datos.forEach(d => {
            if (d.ciudad !== ciudadActual) {
              if (ciudadActual !== null) {
                html += "</div>";
              }
              ciudadActual = d.ciudad;
              html += `<div class='desglose-grupo'><h4>${utils.escapeHtml(ciudadActual)}</h4>`;
            }
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarClinicasCiudadEspecialidad('${utils.escapeHtml(d.ciudad.replace(/'/g, "\\'"))}', '${utils.escapeHtml((d.especialidad || "Sin especialidad").replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.especialidad || "Sin especialidad")}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
          html += "</div>";
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesClinicas").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Clínicas por Ciudad y Especialidad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDesglosePorEspecialidad() {
      try {
        const datos = await utils.request("/stats/dentistas-por-especialidad");
        let html = `<p style="margin: 0 0 1rem 0; padding: 0.75rem 1rem; background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px; font-size: 0.85rem; color: #0c4a6e;">ℹ️ Un dentista puede cubrir varias especialidades a la vez, así que puede aparecer en más de una — la suma de los números no tiene por qué coincidir con el total de dentistas.</p>`;
        html += "<div class='desglose-list'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          datos.forEach(d => {
            html += `
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarDentistasEspecialidad('${utils.escapeHtml((d.especialidad || "Sin especialidad").replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.especialidad || "Sin especialidad")}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesStats").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Dentistas por Especialidad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDesglosePorCiudad() {
      try {
        const datos = await utils.request("/stats/dentistas-por-ciudad");
        let html = "<div class='desglose-list'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          datos.forEach(d => {
            html += `
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarDentistasCiudad('${utils.escapeHtml(d.ciudad.replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.ciudad)}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesStats").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Dentistas por Ciudad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDesglosePorCiudadEspecialidad() {
      try {
        const datos = await utils.request("/stats/dentistas-por-ciudad-especialidad");
        let html = `<p style="margin: 0 0 1rem 0; padding: 0.75rem 1rem; background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px; font-size: 0.85rem; color: #0c4a6e;">ℹ️ Un dentista puede cubrir varias especialidades a la vez, así que puede aparecer en más de una — la suma de los números no tiene por qué coincidir con el total de dentistas.</p>`;
        html += "<div class='desglose-grupos'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          let ciudadActual = null;
          datos.forEach(d => {
            if (d.ciudad !== ciudadActual) {
              if (ciudadActual !== null) {
                html += "</div>";
              }
              ciudadActual = d.ciudad;
              html += `<div class='desglose-grupo'><h4>${utils.escapeHtml(ciudadActual)}</h4>`;
            }
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarDentistasCiudadEspecialidad('${utils.escapeHtml(d.ciudad.replace(/'/g, "\\'"))}', '${utils.escapeHtml((d.especialidad || "Sin especialidad").replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.especialidad || "Sin especialidad")}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
          html += "</div>";
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesStats").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Dentistas por Ciudad y Especialidad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDentistasEspecialidad(especialidad) {
      try {
        const dentistas = await utils.request(`/stats/dentistas-por-especialidad-lista/${encodeURIComponent(especialidad)}`);
        app.stats.mostrarListaDentistas(dentistas, `Dentistas - ${especialidad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDentistasCiudad(ciudad) {
      try {
        const dentistas = await utils.request(`/stats/dentistas-por-ciudad-lista/${encodeURIComponent(ciudad)}`);
        app.stats.mostrarListaDentistas(dentistas, `Dentistas - ${utils.escapeHtml(ciudad)}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDentistasCiudadEspecialidad(ciudad, especialidad) {
      try {
        const dentistas = await utils.request(`/stats/dentistas-por-ciudad-especialidad-lista/${encodeURIComponent(ciudad)}/${encodeURIComponent(especialidad)}`);
        app.stats.mostrarListaDentistas(dentistas, `Dentistas - ${utils.escapeHtml(ciudad)} - ${especialidad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasEspecialidad(especialidad) {
      try {
        const clinicas = await utils.request(`/stats/clinicas-por-especialidad-lista/${encodeURIComponent(especialidad)}`);
        app.stats.mostrarListaClinicas(clinicas, `Clínicas - ${especialidad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasCiudad(ciudad) {
      try {
        const clinicas = await utils.request(`/stats/clinicas-por-ciudad-lista/${encodeURIComponent(ciudad)}`);
        app.stats.mostrarListaClinicas(clinicas, `Clínicas - ${utils.escapeHtml(ciudad)}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasCiudadEspecialidad(ciudad, especialidad) {
      try {
        const clinicas = await utils.request(`/stats/clinicas-por-ciudad-especialidad-lista/${encodeURIComponent(ciudad)}/${encodeURIComponent(especialidad)}`);
        app.stats.mostrarListaClinicas(clinicas, `Clínicas - ${utils.escapeHtml(ciudad)} - ${especialidad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarListaClinicasSimple(clinicas, titulo) {
      if (clinicas.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      // Agrupar por publicación y obtener especialidades
      const porPublicacion = {};

      // Primero, agrupar por publicación_id para obtener especialidades
      const porPublicacionId = {};
      clinicas.forEach(c => {
        if (!porPublicacionId[c.publicacion_id]) {
          porPublicacionId[c.publicacion_id] = {
            ciudad: c.ciudad,
            clinicas: {}
          };
        }
        if (!porPublicacionId[c.publicacion_id].clinicas[c.usuario_id]) {
          porPublicacionId[c.publicacion_id].clinicas[c.usuario_id] = c;
        }
      });

      // Obtener especialidades para cada publicación
      for (const pubId of Object.keys(porPublicacionId)) {
        try {
          const data = await utils.request(`/publicaciones/${pubId}/especialidades`, { method: 'GET' });
          const especialidades = data.especialidades ? data.especialidades.map(e => e.nombre).join(", ") : 'Sin especialidades';
          const ciudad = porPublicacionId[pubId].ciudad;
          const clave = `${especialidades}-${utils.escapeHtml(ciudad)}`;

          porPublicacion[clave] = {
            especialidades: especialidades,
            ciudad: ciudad,
            clinicas: porPublicacionId[pubId].clinicas
          };
        } catch (error) {
          console.error("Error al obtener especialidades:", error);
        }
      }

      let totalClinicas = 0;
      let html = `<div class="candidatos-list">`;

      // Ordenar grupos por: ciudad → especialidad
      const publicacionesOrdenadas = utils.ordenarPorCiudadYEspecialidad(Object.values(porPublicacion));

      publicacionesOrdenadas.forEach(pub => {
        // Ordenar clínicas dentro del grupo por: ciudad → fecha → especialidad → salario
        const clinicasList = utils.ordenarPorCiudadFechaEspecialidadSalario(Object.values(pub.clinicas));
        totalClinicas += clinicasList.length;

        html += `
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">
              🦷 ${utils.escapeHtml(pub.especialidades)} - 📍 ${utils.escapeHtml(pub.ciudad)}
            </h4>
            <p style="margin: 0 0 1rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Clínicas coincidentes: ${clinicasList.length}</strong></p>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem;">
        `;

        clinicasList.forEach(c => {
          const clinicaConEspecialidad = {...c, especialidades: pub.especialidades};
          html += `
            <div style="background: white; border-left: 3px solid #0F4C75; border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: #0f4c75; display: block; margin-bottom: 0.3rem;">${utils.escapeHtml(c.nombre)}</strong>
                <p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📧 ${utils.escapeHtml(c.email)}</p>
                ${c.ciudad ? `<p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📍 ${utils.escapeHtml(c.ciudad)}</p>` : ''}
              </div>
              <button class="btn-primary" onclick="app.stats.mostrarPerfilClinica(${JSON.stringify(clinicaConEspecialidad).replace(/"/g, '&quot;')})" style="white-space: nowrap; margin-left: 1rem;">Ver detalles</button>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${totalClinicas})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarListaDentistas(dentistas, titulo) {
      if (dentistas.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      // Al dentista que se ha postulado a alguna de nuestras publicaciones se le enseña
      // lo mismo que en "Postulaciones Recibidas" (estado, mensaje, acciones), en vez de
      // una ficha de contacto suelta: es el mismo dentista, no tiene sentido verlo de
      // dos formas distintas según por dónde se entre.
      const porUsuario = {};
      if (estadoApp.tipoUsuario === 'clinica' && estadoApp.usuario) {
        try {
          const postulados = await utils.request(`/stats/candidatos-interesados-lista/${estadoApp.usuario.id}`);
          (postulados || []).forEach(c => { (porUsuario[c.usuario_id] = porUsuario[c.usuario_id] || []).push(c); });
        } catch (error) {
          console.error("Error al cargar las postulaciones recibidas:", error);
        }
      }

      let html = `<div class="candidatos-list">`;

      dentistas.forEach(d => {
        const postulaciones = porUsuario[d.usuario_id] || [];
        if (postulaciones.length) {
          html += postulaciones.map(c => app.stats.tarjetaCandidatoHtml(c)).join("");
          return;
        }
        html += `
          <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 0.5rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">${utils.escapeHtml(d.nombre)}</h4>
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>🦷 Especialidades:</strong> ${utils.escapeHtml(d.especialidades || 'Sin especialidad')}</p>
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📧 Email:</strong> ${utils.escapeHtml(d.email)}</p>
            ${d.telefono ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📞 Teléfono:</strong> ${utils.escapeHtml(d.telefono)}</p>` : ''}
            ${d.movil ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📱 Móvil:</strong> ${utils.escapeHtml(d.movil)}</p>` : ''}
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📍 Ciudad:</strong> ${utils.escapeHtml(d.ciudad)}</p>
            ${d.direccion ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>🏠 Dirección:</strong> ${utils.escapeHtml(d.direccion)}</p>` : ''}
            <div style="margin-top: 0.75rem;">
              <button onclick="app.stats.abrirSolicitudDeDentista(${d.usuario_id})" style="background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">👁️ Ver Detalles</button>
            </div>
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${dentistas.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    mostrarListaClinicas(clinicas, titulo) {
      if (clinicas.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      let html = `<div class="candidatos-list">`;

      clinicas.forEach(c => {
        html += `
          <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 0.5rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">${utils.escapeHtml(c.nombre)}</h4>
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>🦷 Especialidades:</strong> ${utils.escapeHtml(c.especialidades || 'Sin especialidad')}</p>
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📧 Email:</strong> ${utils.escapeHtml(c.email)}</p>
            ${c.telefono ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📞 Teléfono:</strong> ${utils.escapeHtml(c.telefono)}</p>` : ''}
            ${c.movil ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📱 Móvil:</strong> ${utils.escapeHtml(c.movil)}</p>` : ''}
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📍 Ciudad:</strong> ${utils.escapeHtml(c.ciudad)}</p>
            ${c.direccion ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>🏠 Dirección:</strong> ${utils.escapeHtml(c.direccion)}</p>` : ''}
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${clinicas.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarPerfilClinica(clinica) {
      const resumenResenyas = clinica.usuario_id ? await app.resenyas.cargarResumen(clinica.usuario_id) : null;

      // Datos públicos (descripción) y fotos de la clínica
      let publico = null;
      let fotos = [];
      if (clinica.usuario_id) {
        try { publico = await utils.request(`/usuarios/${clinica.usuario_id}/publico`); } catch (e) { /* opcional */ }
        try {
          const archivos = await utils.request(`/archivos/usuario/${clinica.usuario_id}`);
          fotos = (archivos || []).filter(a => a.tipo === 'foto');
        } catch (e) { /* opcional */ }
      }
      const descripcion = (publico && publico.descripcion) || clinica.descripcion;

      let html = `
        <div style="padding: 2rem; background: #f9fafb; border-radius: 12px;">

          ${resumenResenyas ? `<div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 0.5rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">⭐ Valoraciones</h4>
            ${app.resenyas.resumenHtml(resumenResenyas, clinica.usuario_id, clinica.nombre)}
          </div>` : ''}

          ${clinica.especialidades ? `<div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">🦷 Especialidad</h4>
            <p style="margin: 0; font-size: 0.95rem;">${utils.escapeHtml(clinica.especialidades)}</p>
          </div>` : ''}

          <div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📞 Contacto</h4>
            <p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📧 Email:</strong> ${utils.escapeHtml(clinica.email)}</p>
            ${clinica.telefono ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📞 Teléfono:</strong> ${utils.escapeHtml(clinica.telefono)}</p>` : ''}
            ${clinica.movil ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📱 Móvil:</strong> ${utils.escapeHtml(clinica.movil)}</p>` : ''}
          </div>

          <div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📍 Ubicación</h4>
            <p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>🌆 Ciudad:</strong> ${utils.escapeHtml(clinica.ciudad)}</p>
            ${clinica.direccion ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>🏠 Dirección:</strong> ${utils.escapeHtml(clinica.direccion)}</p>` : ''}
            ${clinica.codigo_postal ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📮 Código Postal:</strong> ${utils.escapeHtml(clinica.codigo_postal)}</p>` : ''}
            ${clinica.pais ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>🌍 País:</strong> ${utils.escapeHtml(clinica.pais)}</p>` : ''}
          </div>

          ${descripcion ? `<div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📋 Descripción</h4>
            <p style="margin: 0; font-size: 0.95rem; line-height: 1.6; white-space: pre-wrap;">${utils.escapeHtml(descripcion)}</p>
          </div>` : ''}

          ${fotos.length > 0 ? `<div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📷 Fotos de la clínica</h4>
            <div class="fotos-gallery">
              ${fotos.map(f => `<div class="foto-item"><img src="${API}/archivos/${f.id}/download" alt="Foto de la clínica" loading="lazy"></div>`).join('')}
            </div>
          </div>` : ''}

          ${clinica.web ? `<div style="background: white; border-radius: 8px; padding: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">🌐 Web</h4>
            <p style="margin: 0; font-size: 0.95rem;"><a href="${utils.escapeHtml(clinica.web)}" target="_blank" style="color: #0ea5e9; text-decoration: none;">${utils.escapeHtml(clinica.web)}</a></p>
          </div>` : ''}
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = clinica.nombre;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarClinicasPotenciales() {
      try {
        const clinicas = await utils.request(`/stats/clinicas-potenciales-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaClinicasSimple(clinicas, "Clínicas Potenciales");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarOfertasActivas() {
      try {
        const ofertas = await utils.request("/publicaciones?tipo=oferta&limit=500");

        if (ofertas.length === 0) {
          utils.mostrarAlerta("No hay ofertas activas", "info");
          return;
        }

        // Agrupar por ciudad
        const agrupadoPorCiudad = {};
        ofertas.forEach(o => {
          if (!agrupadoPorCiudad[o.ciudad]) agrupadoPorCiudad[o.ciudad] = [];
          agrupadoPorCiudad[o.ciudad].push(o);
        });

        let html = `<h3>${ofertas.length} Ofertas Activas</h3><div class="desglose-grupos">`;

        Object.keys(agrupadoPorCiudad).sort().forEach(ciudad => {
          html += `<div class="desglose-grupo"><h4>${utils.escapeHtml(ciudad)}</h4>`;

          agrupadoPorCiudad[ciudad].forEach((o, idx) => {
            const esp = estadoApp.especialidades.find(e => e.id === o.especialidad_id);
            const titulo = esp ? esp.nombre : 'Oferta';
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarOfertaCompleta(${JSON.stringify(o).replace(/"/g, '&quot;')})">
                <strong>${titulo}</strong>
                <span class="desglose-numero">Oferta ${idx + 1}</span>
              </div>
            `;
          });

          html += "</div>";
        });

        html += "</div>";

        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    pollingInterval: null,

    async mostrarMisPostulaciones() {
      try {
        const postulaciones = await utils.request(`/stats/mis-postulaciones-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaPostulaciones(postulaciones, "Postulaciones a Clínicas");

        // Iniciar polling automático
        this.iniciarPolling('postulaciones');
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarMisPostulacionesAceptadas() {
      try {
        const postulaciones = await utils.request(`/stats/mis-postulaciones-aceptadas-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaPostulaciones(postulaciones, "Postulaciones a Clínicas Aceptadas");

        // Iniciar polling automático
        this.iniciarPolling('aceptadas');
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    iniciarPolling(tipo) {
      // Detener polling anterior si existe
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
      }

      // Función para hacer polling
      const hacerPolling = async () => {
        const modal = document.getElementById("modalInteresados");
        if (!modal || !modal.classList.contains("active")) {
          // Si el modal se cierra, detener polling
          if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
          }
          return;
        }

        try {
          let postulaciones = [];
          if (tipo === 'postulaciones') {
            postulaciones = await utils.request(`/stats/mis-postulaciones-lista/${estadoApp.usuario.id}`);
          } else if (tipo === 'aceptadas') {
            postulaciones = await utils.request(`/stats/mis-postulaciones-aceptadas-lista/${estadoApp.usuario.id}`);
          }

          const html = await app.stats.generarHtmlPostulaciones(postulaciones);
          document.getElementById("interesadosBody").innerHTML = html;

          // Actualizar título con nuevo count
          const modal = document.getElementById("modalInteresados");
          if (modal) {
            const titulo = tipo === 'postulaciones' ? 'Postulaciones a Clínicas' : 'Postulaciones a Clínicas Aceptadas';
            modal.querySelector(".modal-header h2").textContent = `${titulo} (${postulaciones.length})`;
          }
        } catch (error) {
          console.error("Error en polling:", error);
        }
      };

      // Ejecutar inmediatamente y luego cada 3 segundos
      hacerPolling();
      this.pollingInterval = setInterval(hacerPolling, 3000);
    },

    async generarHtmlPostulaciones(postulaciones) {
      if (postulaciones.length === 0) {
        return '<div style="padding: 2rem; text-align: center; color: #6b7280;"><p>No hay postulaciones</p></div>';
      }

      // Obtener especialidades reales de cada publicación (guardadas en tabla de unión)
      const especialidadesPorPublicacion = {};
      const publicacionIds = [...new Set(postulaciones.map(p => p.publicacion_id))];
      await Promise.all(publicacionIds.map(async (pubId) => {
        try {
          const data = await utils.request(`/publicaciones/${pubId}/especialidades`, { method: 'GET' });
          especialidadesPorPublicacion[pubId] = data.especialidades && data.especialidades.length > 0
            ? data.especialidades.map(e => e.nombre).join(", ")
            : 'Sin especialidad';
        } catch (error) {
          especialidadesPorPublicacion[pubId] = 'Sin especialidad';
        }
      }));

      // Ordenar por: ciudad → fecha → especialidad → salario
      const ordenadas = utils.ordenarPorCiudadFechaEspecialidadSalario(postulaciones);

      let html = `<div class="candidatos-list">`;
      ordenadas.forEach(post => {
        const estadoColor = utils.colorEstado(post.estado);
        const tituloPublicacion = post.ciudad || 'Publicación';
        const especialidad = especialidadesPorPublicacion[post.publicacion_id] || 'Sin especialidad';
        const fecha = utils.formatearFecha(post.creado_en);
        const postConEspecialidad = {...post, especialidad_nombre: especialidad};
        html += `
          <div style="background: white; border: 2px solid ${estadoColor}; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
              <div>
                <h4 style="margin: 0 0 0.3rem 0; color: #0f4c75; font-size: 1.2rem; font-weight: 700;">${utils.escapeHtml(tituloPublicacion)}</h4>
                ${post.empresa_nombre ? `<p style="margin: 0; color: #6b7280; font-size: 0.95rem;">🏢 ${utils.escapeHtml(post.empresa_nombre)}</p>` : ''}
              </div>
              <span style="background: ${estadoColor}; color: white; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; text-transform: capitalize; white-space: nowrap;">${utils.textoEstado(post.estado)}</span>
            </div>
            ${utils.lineaTiempoCandidatura(post.estado, post.actualizado_en)}
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; font-size: 0.9rem; color: #6b7280;">
              <p style="margin: 0;"><strong>📍 Ciudad:</strong> ${utils.escapeHtml(post.ciudad)}</p>
              <p style="margin: 0;"><strong>📅 Fecha:</strong> ${fecha}</p>
              <p style="margin: 0;"><strong>🦷 Especialidad:</strong> ${especialidad}</p>
              ${post.salario ? `<p style="margin: 0;"><strong>💰 Salario:</strong> ${utils.escapeHtml(post.salario)}</p>` : ''}
              ${post.contrato ? `<p style="margin: 0;"><strong>📋 Contrato:</strong> ${utils.escapeHtml(post.contrato)}</p>` : ''}
              ${post.jornada ? `<p style="margin: 0;"><strong>⏰ Jornada:</strong> ${utils.escapeHtml(post.jornada)}</p>` : ''}
            </div>
            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem; margin-top: 1rem;">
              <p style="margin: 0; color: #6b7280; white-space: pre-wrap; line-height: 1.6; font-size: 0.9rem;">${utils.escapeHtml(post.descripcion || 'Sin descripción')}</p>
            </div>
            ${post.mensaje ? `<div style="margin-top: 1rem; padding: 1rem; background: #f0f9ff; border-radius: 8px; border-left: 4px solid #0ea5e9;">
              <p style="margin: 0; font-size: 0.85rem; color: #0c4a6e; font-weight: 600;">💬 Tu mensaje:</p>
              <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem; color: #0c4a6e; white-space: pre-wrap;">${utils.escapeHtml(post.mensaje)}</p>
            </div>` : ''}
            <div style="display: flex; gap: 0.75rem; margin-top: 1.5rem;">
              <button class="btn-primary" onclick="app.stats.abrirPublicacionDePostulacion(${post.publicacion_id})" style="flex: 1; background: #3b82f6; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">Ver Publicación</button>
              ${post.estado === 'aceptada' ? `<button onclick="app.resenyas.abrirFormulario(${post.id}, '${utils.escapeHtml((post.empresa_nombre || 'la otra parte').replace(/'/g, "\\'"))}')" style="flex: 1; background: #f59e0b; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">⭐ Valorar</button>` : ''}
              <button onclick="app.candidaturas.retirarPostulacion(${post.id})" style="flex: 1; background: #ef4444; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">🗑️ Retirar</button>
            </div>
          </div>
        `;
      });
      html += "</div>";
      return html;
    },

    // "Ver Publicación" desde una postulación: abre exactamente la misma ficha que en
    // "Publicaciones de dentistas". Antes se detiene el refresco automático de la
    // lista, que si no seguiría repintándola por detrás del detalle.
    async abrirPublicacionDePostulacion(publicacionId) {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
      try {
        await app.rutas.abrirPublicacion(publicacionId);
      } catch (error) {
        console.error("Error al abrir la publicación:", error);
        utils.mostrarAlerta("No se ha podido abrir la publicación", "error");
      }
    },

    mostrarDetalleMiPostulacion(post) {
      // Detener el refresco automático: si no, sobrescribe este detalle con la lista a los pocos segundos
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }

      const estadoColor = utils.colorEstado(post.estado);
      const especialidad = post.especialidad_nombre || 'Sin especialidad';
      const fecha = utils.formatearFecha(post.creado_en);

      let html = `
        <div style="padding: 2rem; background: #f9fafb; border-radius: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h3 style="margin: 0; color: #0f4c75; font-size: 1.5rem; font-weight: 700;">${utils.escapeHtml(post.empresa_nombre || post.ciudad)}</h3>
            <span style="background: ${estadoColor}; color: white; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; text-transform: capitalize;">${utils.textoEstado(post.estado)}</span>
          </div>

          <div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 0.5rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📈 Estado de tu candidatura</h4>
            ${utils.lineaTiempoCandidatura(post.estado, post.actualizado_en)}
          </div>

          <div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📋 Detalles</h4>
            <p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📍 Ciudad:</strong> ${utils.escapeHtml(post.ciudad)}</p>
            <p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📅 Fecha:</strong> ${fecha}</p>
            <p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>🦷 Especialidad:</strong> ${especialidad}</p>
            ${post.salario ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>💰 Salario:</strong> ${utils.escapeHtml(post.salario)}</p>` : ''}
            ${post.contrato ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📋 Contrato:</strong> ${utils.escapeHtml(post.contrato)}</p>` : ''}
            ${post.jornada ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>⏰ Jornada:</strong> ${utils.escapeHtml(post.jornada)}</p>` : ''}
            ${post.empresa_email ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📧 Email:</strong> ${utils.escapeHtml(post.empresa_email)}</p>` : ''}
          </div>

          ${post.descripcion ? `<div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📝 Descripción</h4>
            <p style="margin: 0; font-size: 0.95rem; line-height: 1.6; white-space: pre-wrap;">${utils.escapeHtml(post.descripcion)}</p>
          </div>` : ''}

          ${post.mensaje ? `<div style="background: white; border-radius: 8px; padding: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">💬 Tu mensaje</h4>
            <p style="margin: 0; font-size: 0.95rem; line-height: 1.6; white-space: pre-wrap;">${utils.escapeHtml(post.mensaje)}</p>
          </div>` : ''}
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = post.empresa_nombre || post.ciudad;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarListaPostulaciones(postulaciones, titulo) {
      if (postulaciones.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      const html = await this.generarHtmlPostulaciones(postulaciones);
      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${postulaciones.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarMisPostulacionesDentistas() {
      try {
        const data = await utils.request("/candidaturas/mis-postulaciones");
        const misPostulaciones = data.candidaturas || [];

        // Filtrar solo postulaciones a solicitudes de dentistas
        const postulacionesDentistas = misPostulaciones.filter(p => p.publicacion_tipo === 'solicitud');

        app.stats.mostrarListaPostulaciones(postulacionesDentistas, "Mis Postulaciones a Dentistas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarMisPostulacionesDentistasAceptadas() {
      try {
        const data = await utils.request("/candidaturas/mis-postulaciones");
        const misPostulaciones = data.candidaturas || [];

        // Filtrar solo postulaciones aceptadas a solicitudes de dentistas
        const postulacionesAceptadas = misPostulaciones.filter(p => p.publicacion_tipo === 'solicitud' && p.estado === 'aceptada');

        app.stats.mostrarListaPostulaciones(postulacionesAceptadas, "Mis Postulaciones a Dentistas Aceptadas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarMisSolicitudes() {
      try {
        const misSolicitudes = await utils.request(`/publicaciones?tipo=solicitud&usuario_id=${estadoApp.usuario.id}&limit=500`);

        if (misSolicitudes.length === 0) {
          utils.mostrarAlerta("No has publicado ninguna solicitud", "info");
          return;
        }

        // Obtener respuestas para cada solicitud
        const solicitudesConRespuestas = [];
        for (const solicitud of misSolicitudes) {
          const mensajes = await utils.request(`/mensajes/${solicitud.id}`);
          solicitudesConRespuestas.push({
            ...solicitud,
            respuestas: mensajes.length,
            mensajes: mensajes
          });
        }

        // Agrupar por ciudad
        const agrupadoPorCiudad = {};
        solicitudesConRespuestas.forEach(s => {
          if (!agrupadoPorCiudad[s.ciudad]) agrupadoPorCiudad[s.ciudad] = [];
          agrupadoPorCiudad[s.ciudad].push(s);
        });

        // Ordenar por ciudad
        let html = `<h3>${misSolicitudes.length} Mis solicitudes</h3><div class="desglose-grupos">`;

        Object.keys(agrupadoPorCiudad).sort().forEach(ciudad => {
          html += `<div class="desglose-grupo"><h4>${utils.escapeHtml(ciudad)}</h4>`;

          agrupadoPorCiudad[ciudad].forEach(s => {
            const esp = estadoApp.especialidades.find(e => e.id === s.especialidad_id);
            const tituloSolicitud = esp ? `${esp.nombre} - ${s.ciudad}` : s.ciudad;
            const resp = s.respuestas > 0 ? `${s.respuestas} respuesta${s.respuestas !== 1 ? 's' : ''}` : 'Sin respuestas';
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarSolicitudConRespuesta(${s.id})">
                <div>
                  <strong>${tituloSolicitud}</strong>
                  <p style="font-size: 0.85rem; color: var(--gray-600); margin: 0.25rem 0 0 0;">${esp?.nombre || 'Sin especialidad'}</p>
                </div>
                <span class="desglose-numero">${resp}</span>
              </div>
            `;
          });

          html += "</div>";
        });

        html += "</div>";

        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    mostrarOfertaCompleta(oferta) {
      const esp = estadoApp.especialidades.find(e => e.id === oferta.especialidad_id);
      const titulo = esp ? `${esp.nombre} - ${utils.escapeHtml(oferta.ciudad)}` : oferta.ciudad;

      let html = `
        <div class="perfil-dentista">
          <h3 style="margin-top: 0; color: var(--primary);">${titulo}</h3>

          <div class="info-section">
            <h4>Detalles</h4>
            <p><strong>Ciudad:</strong> ${utils.escapeHtml(oferta.ciudad)}</p>
            ${esp ? `<p><strong>Especialidades:</strong> ${esp.nombre}</p>` : ''}
            ${oferta.contrato ? `<p><strong>Contrato:</strong> ${utils.escapeHtml(oferta.contrato)}</p>` : ''}
            ${oferta.jornada ? `<p><strong>Jornada:</strong> ${utils.escapeHtml(oferta.jornada)}</p>` : ''}
            ${oferta.salario ? `<p><strong>Salario:</strong> ${utils.escapeHtml(oferta.salario)}</p>` : ''}
          </div>

          ${oferta.descripcion ? `
          <div class="info-section">
            <h4>Descripción</h4>
            <p style="white-space: pre-wrap;">${utils.escapeHtml(oferta.descripcion)}</p>
          </div>
          ` : ''}

          ${oferta.nombre_contacto ? `
          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>Nombre:</strong> ${utils.escapeHtml(oferta.nombre_contacto)}</p>
            ${oferta.email_contacto ? `<p><strong>Email:</strong> <a href="mailto:${utils.escapeHtml(oferta.email_contacto)}">${utils.escapeHtml(oferta.email_contacto)}</a></p>` : ''}
            ${oferta.telefono_contacto ? `<p><strong>Teléfono:</strong> <a href="tel:${utils.escapeHtml(oferta.telefono_contacto)}">${utils.escapeHtml(oferta.telefono_contacto)}</a></p>` : ''}
          </div>
          ` : ''}
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Oferta de Trabajo";
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarSolicitudConRespuesta(solicitudId) {
      try {
        // Obtener la solicitud completa
        const solicitud = await utils.request(`/publicaciones/${solicitudId}`);

        const esp = estadoApp.especialidades.find(e => e.id === solicitud.especialidad_id);

        // Obtener mensajes
        const mensajes = await utils.request(`/mensajes/${solicitudId}`);

        const tituloSolicitud = esp ? `${esp.nombre} - ${utils.escapeHtml(solicitud.ciudad)}` : solicitud.ciudad;

        let html = `
          <div class="perfil-dentista">
            <h3 style="margin-top: 0; color: var(--primary);">${tituloSolicitud}</h3>

            <div class="info-section">
              <h4>Detalles</h4>
              <p><strong>Ciudad:</strong> ${utils.escapeHtml(solicitud.ciudad)}</p>
              <p><strong>Especialidad:</strong> ${esp?.nombre || 'No especificada'}</p>
              ${solicitud.jornada ? `<p><strong>Disponibilidad:</strong> ${utils.escapeHtml(solicitud.jornada)}</p>` : ''}
              ${solicitud.salario ? `<p><strong>Salario esperado:</strong> ${utils.escapeHtml(solicitud.salario)}</p>` : ''}
              ${solicitud.contrato ? `<p><strong>Contrato:</strong> ${utils.escapeHtml(solicitud.contrato)}</p>` : ''}
            </div>

            <div class="info-section">
              <h4>Descripción</h4>
              <p style="white-space: pre-wrap;">${utils.escapeHtml(solicitud.descripcion)}</p>
            </div>

            <div class="info-section">
              <h4>Mi Contacto</h4>
              ${solicitud.nombre_contacto ? `<p><strong>Nombre:</strong> ${utils.escapeHtml(solicitud.nombre_contacto)}</p>` : ''}
              ${solicitud.email_contacto ? `<p><strong>Email:</strong> <a href="mailto:${utils.escapeHtml(solicitud.email_contacto)}">${utils.escapeHtml(solicitud.email_contacto)}</a></p>` : ''}
              ${solicitud.telefono_contacto ? `<p><strong>Teléfono:</strong> <a href="tel:${utils.escapeHtml(solicitud.telefono_contacto)}">${utils.escapeHtml(solicitud.telefono_contacto)}</a></p>` : ''}
            </div>
        `;

        // Mostrar mensajes recibidos
        if (mensajes && mensajes.length > 0) {
          html += `
            <div class="info-section">
              <h4>Respuestas Recibidas (${mensajes.length})</h4>
          `;

          mensajes.forEach(m => {
            html += `
              <div style="background: #F8FAFF; padding: 1rem; border-radius: 8px; border-left: 4px solid #2ec4b6; margin-bottom: 1rem;">
                <p><strong>De:</strong> ${utils.escapeHtml(m.remitente_nombre)}</p>
                <p><strong>Email:</strong> <a href="mailto:${utils.escapeHtml(m.remitente_email)}">${utils.escapeHtml(m.remitente_email)}</a></p>
                <p style="white-space: pre-wrap; margin-top: 1rem; font-style: italic;">💬 "${utils.escapeHtml(m.cuerpo)}"</p>
                <p style="font-size: 0.85rem; color: var(--gray-600); margin-top: 0.5rem;">📅 ${utils.formatearFecha(m.creado_en)}</p>
              </div>
            `;
          });

          html += `</div>`;
        } else {
          html += `
            <div class="info-section">
              <p style="color: var(--gray-600); font-style: italic;">Sin respuestas aún</p>
            </div>
          `;
        }

        html += `</div>`;

        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Mi Búsqueda";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarPosiblesCandidatos() {
      try {
        const candidatos = await utils.request(`/stats/posibles-candidatos-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaCandidatosSimple(candidatos, "Dentistas Potenciales");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarCandidatosInteresados() {
      try {
        const candidatos = await utils.request(`/stats/candidatos-interesados-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaCandidatos(candidatos, "Postulaciones Recibidas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarPostulacionesRecibidas() {
      try {
        const postulaciones = await utils.request(`/stats/postulaciones-recibidas-dentista-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaPostulacionesRecibidas(postulaciones, "Postulaciones Recibidas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarPostulacionesRecibdasAceptadas() {
      try {
        const postulaciones = await utils.request(`/stats/postulaciones-recibidas-aceptadas-dentista-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaPostulacionesRecibidas(postulaciones, "Postulaciones Recibidas Aceptadas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarEstadisticasPublicacion(publicacionId, titulo) {
      try {
        const stats = await utils.request(`/publicaciones/${publicacionId}/estadisticas`);
        const p = stats.postulantes;

        const tiempoMedio = stats.tiempo_medio_respuesta_dias !== null
          ? (stats.tiempo_medio_respuesta_dias < 1
              ? "menos de 1 día"
              : `${stats.tiempo_medio_respuesta_dias} días`)
          : "—";

        const html = `
          <div style="padding: 1rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
              <div class="pub-stat-card">
                <span style="font-size: 1.6rem;">👁️</span>
                <h3 style="margin: 0.3rem 0; font-size: 1.8rem; color: #0f4c75;">${stats.vistas}</h3>
                <p style="margin: 0; color: #6b7280; font-size: 0.85rem;">Vistas</p>
              </div>
              <div class="pub-stat-card">
                <span style="font-size: 1.6rem;">📬</span>
                <h3 style="margin: 0.3rem 0; font-size: 1.8rem; color: #0f4c75;">${p.total}</h3>
                <p style="margin: 0; color: #6b7280; font-size: 0.85rem;">Postulantes</p>
              </div>
              <div class="pub-stat-card">
                <span style="font-size: 1.6rem;">⏱️</span>
                <h3 style="margin: 0.3rem 0; font-size: 1.4rem; color: #0f4c75;">${tiempoMedio}</h3>
                <p style="margin: 0; color: #6b7280; font-size: 0.85rem;">Tiempo medio de respuesta</p>
              </div>
            </div>

            <h4 style="color: #0f4c75; margin: 0 0 0.75rem 0;">Postulantes por estado</h4>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <span class="pub-stat-chip" style="background: #fef3c7; color: #92400e;">⏳ Pendientes: ${p.pendientes}</span>
              <span class="pub-stat-chip" style="background: #d1fae5; color: #065f46;">✅ Aceptadas: ${p.aceptadas}</span>
              <span class="pub-stat-chip" style="background: #fee2e2; color: #991b1b;">❌ Rechazadas: ${p.rechazadas}</span>
              <span class="pub-stat-chip" style="background: #f3f4f6; color: #4b5563;">↩️ Retiradas: ${p.retiradas}</span>
            </div>

            ${p.total === 0 ? '<p style="color: #9ca3af; margin-top: 1.5rem; text-align: center;">Todavía nadie se ha postulado a esta publicación.</p>' : ''}
          </div>
        `;

        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `📊 ${titulo}`;
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async cambiarEstadoCandidatura(candidaturaId, nuevoEstado) {
      try {
        await utils.request(`/candidaturas/${candidaturaId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: nuevoEstado })
        });
        utils.mostrarAlerta("Estado actualizado correctamente", "success");

        // Recargar stats del banner
        await app.ui.actualizarStats();

        // Recargar el contenido del modal SIN cerrarlo
        setTimeout(() => {
          const modal = document.getElementById("modalInteresados");
          if (modal && modal.classList.contains("active")) {
            const publicacionId = estadoApp.publicacionActual?.id;
            const tipo = estadoApp.publicacionActual?.tipo;

            if (publicacionId && tipo === 'solicitud') {
              // Recargar desde "Empresas" (abrirInteresados) - dentista
              app.modal.abrirInteresados(publicacionId, tipo);
            } else if (publicacionId && tipo === 'oferta') {
              // Recargar desde "Postulaciones Recibidas" - clínica
              app.modal.abrirInteresados(publicacionId, tipo);
            } else if (estadoApp.tipoUsuario === 'dentista') {
              // Recargar desde stats "Postulaciones Recibidas" - dentista
              app.stats.mostrarPostulacionesRecibidas();
              // También recargar aceptadas
              app.stats.mostrarPostulacionesRecibdasAceptadas();
            } else if (estadoApp.tipoUsuario === 'clinica') {
              // Recargar desde stats "Candidatos Interesados" - clínica
              app.stats.mostrarCandidatosInteresados();
            }
          }
        }, 300);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },


    async mostrarListaPostulacionesRecibidas(postulaciones, titulo) {
      if (postulaciones.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      // Agrupar por publicación
      const porPublicacion = {};
      const porPublicacionId = {};

      postulaciones.forEach(p => {
        if (!porPublicacionId[p.publicacion_id]) {
          porPublicacionId[p.publicacion_id] = {
            ciudad: p.solicitud_ciudad,
            especialidad_id: p.especialidad_id,
            postulaciones: []
          };
        }
        porPublicacionId[p.publicacion_id].postulaciones.push(p);
      });

      // Obtener especialidades para cada publicación
      for (const pubId of Object.keys(porPublicacionId)) {
        try {
          const data = await utils.request(`/publicaciones/${pubId}/especialidades`, { method: 'GET' });
          const especialidades = data.especialidades ? data.especialidades.map(e => e.nombre).join(", ") : 'Sin especialidades';
          const ciudad = porPublicacionId[pubId].ciudad;
          const clave = `${especialidades}-${utils.escapeHtml(ciudad)}`;

          porPublicacion[clave] = {
            especialidades: especialidades,
            ciudad: ciudad,
            postulaciones: porPublicacionId[pubId].postulaciones
          };
        } catch (error) {
          console.error("Error al obtener especialidades:", error);
        }
      }

      let totalPostulaciones = 0;
      let html = `<div class="candidatos-list">`;

      // Ordenar grupos por: ciudad → especialidad
      const publicacionesOrdenadas = utils.ordenarPorCiudadYEspecialidad(Object.values(porPublicacion));

      publicacionesOrdenadas.forEach(pub => {
        // Ordenar postulaciones dentro del grupo por: ciudad → fecha → especialidad → salario
        const postulacionesOrdenadas = pub.postulaciones.sort((a, b) => {
          const ciudadA = (a.ciudad || '').toLowerCase();
          const ciudadB = (b.ciudad || '').toLowerCase();
          if (ciudadA !== ciudadB) {
            return ciudadA.localeCompare(ciudadB);
          }
          const fechaA = new Date(a.creado_en || 0);
          const fechaB = new Date(b.creado_en || 0);
          if (fechaA.getTime() !== fechaB.getTime()) {
            return fechaB - fechaA;
          }
          const espA = (a.especialidad_id || 0);
          const espB = (b.especialidad_id || 0);
          if (espA !== espB) {
            return espA - espB;
          }
          const salarioA = parseFloat(a.salario) || 0;
          const salarioB = parseFloat(b.salario) || 0;
          return salarioB - salarioA;
        });
        totalPostulaciones += postulacionesOrdenadas.length;

        html += `
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">
              🦷 ${utils.escapeHtml(pub.especialidades)} - 📍 ${utils.escapeHtml(pub.ciudad)}
            </h4>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem;">
        `;

        postulacionesOrdenadas.forEach(p => {
          const estadoColor = utils.colorEstado(p.estado);
          html += `
            <div style="background: white; border-left: 3px solid ${estadoColor}; border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="flex: 1; cursor: pointer;" onclick="app.stats.mostrarDetallePostulacion('${p.id}', '${utils.escapeHtml(p.nombre.replace(/'/g, "\\'"))}', '${utils.escapeHtml(p.email.replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.ciudad || '').replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.direccion || '').replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.codigo_postal || '').replace(/'/g, "\\'"))}', '${p.estado}', '${utils.escapeHtml((p.mensaje || '').replace(/'/g, "\\'").replace(/"/g, '\\"'))}')">
                  <strong style="color: #0f4c75; display: block; margin-bottom: 0.3rem;">${utils.escapeHtml(p.nombre)}</strong>
                  <p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📧 ${utils.escapeHtml(p.email)}</p>
                  ${p.ciudad ? `<p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📍 ${utils.escapeHtml(p.ciudad)}</p>` : ''}
                </div>
                <span style="background: ${estadoColor}; color: white; padding: 0.2rem 0.5rem; border-radius: 3px; font-size: 0.75rem; text-transform: capitalize; white-space: nowrap; margin-left: 1rem;">${utils.textoEstado(p.estado)}</span>
              </div>
              <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">
                <button onclick="event.stopPropagation(); app.stats.mostrarDetallePostulacion('${p.id}', '${utils.escapeHtml(p.nombre.replace(/'/g, "\\'"))}', '${utils.escapeHtml(p.email.replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.ciudad || '').replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.direccion || '').replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.codigo_postal || '').replace(/'/g, "\\'"))}', '${p.estado}', '${utils.escapeHtml((p.mensaje || '').replace(/'/g, "\\'").replace(/"/g, '\\"'))}')" style="background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">👁️ Ver Detalles</button>
                ${utils.selectorEstado(p.id, p.estado, `event.stopPropagation(); app.stats.cambiarEstadoCandidatura(${p.id}, this.value)`)}
                ${p.estado === 'aceptada' ? `<button onclick="event.stopPropagation(); app.resenyas.abrirFormulario(${p.id}, '${utils.escapeHtml(p.nombre.replace(/'/g, "\\'"))}')" style="background: #8b5cf6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">⭐ Valorar</button>` : ''}
              </div>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${totalPostulaciones})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    mostrarDetallePostulacion(id, nombre, email, ciudad, direccion, codigoPostal, estado, mensaje) {
      let html = `
        <div style="padding: 1.5rem;">
          <h3 style="margin-top: 0; color: var(--primary);">${utils.escapeHtml(nombre)}</h3>

          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>📧 Email:</strong> ${utils.escapeHtml(email)}</p>
          </div>

          <div class="info-section">
            <h4>Ubicación</h4>
            ${ciudad ? `<p><strong>📍 Ciudad:</strong> ${utils.escapeHtml(ciudad)}</p>` : ''}
            ${direccion ? `<p><strong>🏠 Dirección:</strong> ${utils.escapeHtml(direccion)}</p>` : ''}
            ${codigoPostal ? `<p><strong>📮 Código Postal:</strong> ${utils.escapeHtml(codigoPostal)}</p>` : ''}
          </div>

          <div class="info-section">
            <h4>Estado de la Postulación</h4>
            <p><strong>Estado:</strong> ${estado}</p>
            ${mensaje ? `<p><strong>Mensaje:</strong> ${utils.escapeHtml(mensaje)}</p>` : ''}
          </div>
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = nombre;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarListaCandidatosSimple(candidatos, titulo) {
      if (candidatos.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      // Agrupar por publicación y obtener especialidades
      const porPublicacion = {};

      // Primero, agrupar por publicación_id para obtener especialidades
      const porPublicacionId = {};
      candidatos.forEach(c => {
        if (!porPublicacionId[c.publicacion_id]) {
          porPublicacionId[c.publicacion_id] = {
            ciudad: c.ciudad,
            dentistas: {}
          };
        }
        if (!porPublicacionId[c.publicacion_id].dentistas[c.usuario_id]) {
          porPublicacionId[c.publicacion_id].dentistas[c.usuario_id] = c;
        }
      });

      // Obtener especialidades para cada publicación
      for (const pubId of Object.keys(porPublicacionId)) {
        try {
          const data = await utils.request(`/publicaciones/${pubId}/especialidades`, { method: 'GET' });
          const especialidades = data.especialidades ? data.especialidades.map(e => e.nombre).join(", ") : 'Sin especialidades';
          const ciudad = porPublicacionId[pubId].ciudad;
          const clave = `${especialidades}-${utils.escapeHtml(ciudad)}`;

          porPublicacion[clave] = {
            especialidades: especialidades,
            ciudad: ciudad,
            dentistas: porPublicacionId[pubId].dentistas
          };
        } catch (error) {
          console.error("Error al obtener especialidades:", error);
        }
      }

      let totalDentistas = 0;
      let html = `<div class="candidatos-list">`;

      Object.values(porPublicacion).forEach(pub => {
        const dentistas = Object.values(pub.dentistas);
        totalDentistas += dentistas.length;

        html += `
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">
              🦷 ${utils.escapeHtml(pub.especialidades)} - 📍 ${utils.escapeHtml(pub.ciudad)}
            </h4>
            <p style="margin: 0 0 1rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Dentistas coincidentes: ${dentistas.length}</strong></p>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem;">
        `;

        dentistas.forEach(d => {
          html += `
            <div style="background: white; border-left: 3px solid #0F4C75; border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: #0f4c75; display: block; margin-bottom: 0.3rem;">${utils.escapeHtml(d.nombre)}</strong>
                <p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📧 ${utils.escapeHtml(d.email)}</p>
                ${d.ciudad ? `<p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📍 ${utils.escapeHtml(d.ciudad)}</p>` : ''}
              </div>
              <button class="btn-primary" onclick="app.stats.mostrarPerfilDentistaCompleto(${JSON.stringify(d).replace(/"/g, '&quot;')})" style="white-space: nowrap; margin-left: 1rem;">Ver detalles</button>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${totalDentistas})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    // Tarjeta de un dentista que se ha postulado a una de nuestras publicaciones: su
    // estado, su mensaje, las respuestas de criba y las acciones. Es la de
    // "Postulaciones Recibidas", extraída aparte porque la lista de "Dentistas"
    // enseña exactamente lo mismo para quien se haya postulado.
    tarjetaCandidatoHtml(c) {
      const estadoColor = utils.colorEstado(c.estado);
      const abrir = `app.stats.abrirSolicitudDeDentista(${c.usuario_id})`;
      return `
        <div style="background: white; padding: 1rem; border-radius: 6px; margin-bottom: 0.75rem; border-left: 3px solid ${estadoColor};">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="flex: 1; cursor: pointer;" onclick="${abrir}">
              <strong>${utils.escapeHtml(c.nombre)}</strong>
              <p style="margin: 0.3rem 0 0 0; font-size: 0.85rem; color: #6b7280;">${utils.escapeHtml(c.email)}</p>
              ${c.ciudad ? `<p style="margin: 0.2rem 0 0 0; font-size: 0.85rem; color: #6b7280;">📍 ${utils.escapeHtml(c.ciudad)}</p>` : ''}
            </div>
            <span style="background: ${estadoColor}; color: white; padding: 0.3rem 0.6rem; border-radius: 4px; font-size: 0.8rem; text-transform: capitalize; white-space: nowrap; margin-left: 1rem;">${utils.textoEstado(c.estado)}</span>
          </div>
          ${c.mensaje ? `<p style="margin: 0.5rem 0 0 0; font-size: 0.85rem; padding: 0.75rem; background: #f0f9ff; border-radius: 4px; border-left: 2px solid #0ea5e9; color: #0c4a6e;"><strong>Mensaje:</strong> ${utils.escapeHtml(c.mensaje)}</p>` : ''}
          ${utils.respuestasCribaHtml(c.respuestas)}
          <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">
            <button onclick="${abrir}" style="background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">👁️ Ver Detalles</button>
            ${utils.selectorEstado(c.id, c.estado, `app.stats.cambiarEstadoCandidatura(${c.id}, this.value)`)}
            ${c.estado === 'aceptada' ? `<button onclick="app.resenyas.abrirFormulario(${c.id}, '${utils.escapeHtml(c.nombre.replace(/'/g, "\\'"))}')" style="background: #8b5cf6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">⭐ Valorar</button>` : ''}
          </div>
        </div>
      `;
    },

    // "Ver Detalles" de un dentista: abre lo mismo que en "Publicaciones de dentistas",
    // es decir, el modal de su solicitud (con su % de compatibilidad). Si no tuviera
    // solicitud publicada, se cae a su ficha de perfil, que es lo más parecido.
    async abrirSolicitudDeDentista(usuarioId) {
      const cerrarLista = () => document.getElementById("modalInteresados")?.classList.remove("active");
      try {
        const sols = await utils.request(`/publicaciones?tipo=solicitud&usuario_id=${usuarioId}&limit=1`);
        if (sols && sols.length) {
          cerrarLista();
          return app.modal.abrirDetalleConManejo(sols[0]);
        }
      } catch (error) {
        console.error("Error al abrir la solicitud del dentista:", error);
      }
      cerrarLista();
      app.perfiles.verDetalle(usuarioId);
    },

    async mostrarListaCandidatos(candidatos, titulo) {
      if (candidatos.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      // Agrupar por oferta
      const porOferta = {};
      candidatos.forEach(c => {
        if (!porOferta[c.publicacion_id]) {
          porOferta[c.publicacion_id] = {
            oferta_descripcion: c.oferta_descripcion,
            oferta_ciudad: c.oferta_ciudad,
            publicacion_id: c.publicacion_id,
            candidatos: []
          };
        }
        porOferta[c.publicacion_id].candidatos.push(c);
      });

      let html = `<div class="candidatos-list">`;

      const entries = Object.entries(porOferta);
      for (let idx = 0; idx < entries.length; idx++) {
        const [pubId, oferta] = entries[idx];
        let especialidadesText = '';

        try {
          const data = await utils.request(`/publicaciones/${pubId}/especialidades`, { method: 'GET' });
          if (data.especialidades && data.especialidades.length > 0) {
            especialidadesText = data.especialidades.map(e => e.nombre).join(", ");
          }
        } catch (error) {
          console.error("Error al obtener especialidades:", error);
        }

        html += `
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
            <p style="margin: 0 0 1rem 0; color: #1f2937; font-size: 0.9rem;"><strong>🦷 Especialidades:</strong> ${especialidadesText || 'Sin especialidades'} | <strong>📍 Ciudad:</strong> ${oferta.oferta_ciudad}</p>
            <div style="border-top: 1px solid #d1d5db; padding-top: 1rem;">
        `;

        oferta.candidatos.forEach(c => {
          html += app.stats.tarjetaCandidatoHtml(c);
        });

        html += `
            </div>
          </div>
        `;
      }

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${candidatos.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarPerfilDentistaCompleto(dentista) {
      const resumenResenyas = dentista.usuario_id ? await app.resenyas.cargarResumen(dentista.usuario_id) : null;

      // Datos públicos (años de experiencia, descripción)
      let publico = null;
      let trayectoria = null;
      if (dentista.usuario_id) {
        try { publico = await utils.request(`/usuarios/${dentista.usuario_id}/publico`); } catch (e) { /* opcional */ }
        try { trayectoria = await utils.request(`/usuarios/${dentista.usuario_id}/trayectoria`); } catch (e) { /* opcional */ }
      }

      // Obtener especialidades del dentista si existen
      let especialidadesText = "";
      try {
        const publicacionesDentista = estadoApp.publicaciones.filter(p => p.usuario_id === dentista.usuario_id && p.tipo === 'solicitud');
        if (publicacionesDentista.length > 0) {
          const publicacionId = publicacionesDentista[0].id;
          const data = await utils.request(`/publicaciones/${publicacionId}/especialidades`, { method: 'GET' });
          if (data && data.especialidades && data.especialidades.length > 0) {
            especialidadesText = data.especialidades.map(e => e.nombre).join(", ");
          }
        }
      } catch (error) {
        console.error("Error al cargar especialidades:", error);
      }

      let html = `
        ${resumenResenyas ? `<div style="margin-bottom: 1rem;">${app.resenyas.resumenHtml(resumenResenyas, dentista.usuario_id, dentista.nombre)}</div>` : ''}
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
          <tbody>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; width: 30%; color: #0F4C75;">Nombre:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(dentista.nombre || '-')}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📧 Email:</td>
              <td style="padding: 0.8rem;"><a href="mailto:${utils.escapeHtml(dentista.email)}" style="color: #0F4C75; text-decoration: none;">${utils.escapeHtml(dentista.email || '-')}</a></td>
            </tr>
            ${(dentista.telefono || dentista.movil) ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📞 Teléfono:</td>
              <td style="padding: 0.8rem;"><a href="tel:${utils.escapeHtml(dentista.telefono || dentista.movil)}" style="color: #0F4C75; text-decoration: none;">${utils.escapeHtml(dentista.telefono || dentista.movil)}</a></td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📍 Ciudad:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(dentista.ciudad || '-')}</td>
            </tr>
            ${dentista.direccion ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🏠 Dirección:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(dentista.direccion)}</td>
            </tr>
            ` : ''}
            ${dentista.codigo_postal ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📮 Código Postal:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(dentista.codigo_postal)}</td>
            </tr>
            ` : ''}
            ${dentista.pais ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🌍 País:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(dentista.pais)}</td>
            </tr>
            ` : ''}
            ${especialidadesText ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🦷 Especialidades:</td>
              <td style="padding: 0.8rem;">${especialidadesText}</td>
            </tr>
            ` : ''}
            ${publico && publico.anyos_experiencia !== null && publico.anyos_experiencia !== undefined ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🎓 Experiencia:</td>
              <td style="padding: 0.8rem;">${publico.anyos_experiencia} año${publico.anyos_experiencia === 1 ? '' : 's'}</td>
            </tr>
            ` : ''}
          </tbody>
        </table>
        ${publico && publico.descripcion ? `
        <div style="background: #F8FAFF; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #0F4C75; font-weight: 700;">👤 Sobre mí</h4>
          <p style="margin: 0; line-height: 1.6; white-space: pre-wrap;">${utils.escapeHtml(publico.descripcion)}</p>
        </div>
        ` : ''}
        ${trayectoria && trayectoria.experiencia.length > 0 ? `
        <div style="background: #F8FAFF; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #0F4C75; font-weight: 700;">💼 Experiencia laboral</h4>
          ${trayectoria.experiencia.map(e => `
            <div style="margin-bottom: 0.9rem;">
              <strong>${utils.escapeHtml(e.especialidad || "")}</strong>${e.lugar ? ` · ${utils.escapeHtml(e.lugar)}` : ''}
              <p style="margin: 0.2rem 0; font-size: 0.85rem; color: #6b7280;">${utils.escapeHtml(app.trayectoria.formatearRango(e.fecha_inicio, e.fecha_fin, e.actual))}</p>
              ${e.descripcion ? `<p style="margin: 0.2rem 0 0 0; font-size: 0.9rem; white-space: pre-wrap;">${utils.escapeHtml(e.descripcion)}</p>` : ''}
            </div>
          `).join('')}
        </div>
        ` : ''}
        ${trayectoria && trayectoria.formacion.length > 0 ? `
        <div style="background: #F8FAFF; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #0F4C75; font-weight: 700;">🎓 Formación</h4>
          ${trayectoria.formacion.map(f => `<p style="margin: 0.3rem 0;">${utils.escapeHtml(f.titulo)}${f.centro ? ` · ${utils.escapeHtml(f.centro)}` : ''}${f.anyo ? ` (${utils.escapeHtml(f.anyo)})` : ''}</p>`).join('')}
        </div>
        ` : ''}
        ${trayectoria && trayectoria.idiomas.length > 0 ? `
        <div style="background: #F8FAFF; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #0F4C75; font-weight: 700;">🌐 Idiomas</h4>
          <p style="margin: 0;">${trayectoria.idiomas.map(i => `${utils.escapeHtml(i.idioma)} (${utils.escapeHtml(i.nivel)})`).join('  ·  ')}</p>
        </div>
        ` : ''}
        ${trayectoria && trayectoria.certificaciones && trayectoria.certificaciones.length > 0 ? `
        <div style="background: #F8FAFF; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #0F4C75; font-weight: 700;">📜 Certificaciones</h4>
          <p style="margin: 0;">${trayectoria.certificaciones.map(c => utils.escapeHtml(c)).join('  ·  ')}</p>
        </div>
        ` : ''}
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Perfil: " + dentista.nombre;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarPerfilDentista(dentista) {
      let publico = null;
      if (dentista.usuario_id) {
        try { publico = await utils.request(`/usuarios/${dentista.usuario_id}/publico`); } catch (e) { /* opcional */ }
      }

      let html = `
        <div class="perfil-dentista">
          <h3 style="margin-top: 0;">${utils.escapeHtml(dentista.nombre)}</h3>

          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>Email:</strong> <a href="mailto:${utils.escapeHtml(dentista.email)}">${utils.escapeHtml(dentista.email)}</a></p>
            ${(dentista.telefono || dentista.movil) ? `<p><strong>Teléfono:</strong> <a href="tel:${utils.escapeHtml(dentista.telefono || dentista.movil)}">${utils.escapeHtml(dentista.telefono || dentista.movil)}</a></p>` : ''}
          </div>

          <div class="info-section">
            <h4>Ubicación</h4>
            ${dentista.ciudad ? `<p><strong>Ciudad:</strong> ${utils.escapeHtml(dentista.ciudad)}</p>` : ''}
            ${dentista.direccion ? `<p><strong>Dirección:</strong> ${utils.escapeHtml(dentista.direccion)}</p>` : ''}
            ${dentista.codigo_postal ? `<p><strong>Código Postal:</strong> ${utils.escapeHtml(dentista.codigo_postal)}</p>` : ''}
            ${dentista.pais ? `<p><strong>País:</strong> ${utils.escapeHtml(dentista.pais)}</p>` : ''}
          </div>
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Perfil: " + dentista.nombre;
      document.getElementById("modalInteresados").classList.add("active");
    }
  },

  // ============================================
  // Módulo: Archivos
  // ============================================

  archivos: {
    async subirCV() {
      const input = document.getElementById("cvInput");
      if (input.files.length === 0) return;

      const formData = new FormData();
      formData.append("archivo", input.files[0]);
      formData.append("tipo", "cv");

      try {
        const response = await utils.requestForm("/archivos/upload", formData);
        utils.mostrarAlerta("CV subido exitosamente", "success");
        input.value = '';
        app.archivos.cargarArchivosUsuario();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async subirPortfolio() {
      const input = document.getElementById("portfolioInput");
      if (input.files.length === 0) return;

      const formData = new FormData();
      formData.append("archivo", input.files[0]);
      formData.append("tipo", "portfolio");

      try {
        const response = await utils.requestForm("/archivos/upload", formData);
        utils.mostrarAlerta("Archivo subido exitosamente", "success");
        input.value = '';
        app.archivos.cargarArchivosUsuario();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async subirFoto() {
      const input = document.getElementById("fotoInput");
      if (input.files.length === 0) return;

      const formData = new FormData();
      formData.append("archivo", input.files[0]);
      formData.append("tipo", "foto");

      try {
        await utils.requestForm("/archivos/upload", formData);
        utils.mostrarAlerta("Foto subida exitosamente", "success");
        input.value = '';
        app.archivos.cargarArchivosUsuario();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    manejarDrop(event, tipo) {
      event.preventDefault();
      const zone = event.currentTarget;
      zone.classList.remove('dragover');

      const files = event.dataTransfer.files;
      if (files.length > 0) {
        const inputIds = { cv: "cvInput", portfolio: "portfolioInput", foto: "fotoInput" };
        const input = document.getElementById(inputIds[tipo]);
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(files[0]);
        input.files = dataTransfer.files;

        if (tipo === 'cv') {
          app.archivos.subirCV();
        } else if (tipo === 'portfolio') {
          app.archivos.subirPortfolio();
        } else {
          app.archivos.subirFoto();
        }
      }
    },

    async cargarArchivosUsuario() {
      if (!estadoApp.usuario) return;

      try {
        const archivos = await utils.request(`/archivos/usuario/${estadoApp.usuario.id}`);
        estadoApp.archivosUsuario = archivos;
        app.archivos.renderizarArchivos();
      } catch (error) {
        console.error(error);
      }
    },

    renderizarArchivos() {
      const cv = estadoApp.archivosUsuario.find(a => a.tipo === 'cv');
      const portfolios = estadoApp.archivosUsuario.filter(a => a.tipo === 'portfolio');

      // Renderizar CV
      const cvContainer = document.getElementById("cvContainer");
      if (cv) {
        cvContainer.innerHTML = `
          <div style="background: #F8FAFF; padding: 1.5rem; border-radius: 8px; border-left: 4px solid #0F4C75;">
            <p style="font-weight: 700; color: #0F4C75; margin-bottom: 0.5rem;">📄 ${utils.escapeHtml(cv.nombre_archivo)}</p>
            <p style="font-size: 0.9rem; color: #666; margin-bottom: 1rem;">Subido el ${utils.formatearFecha(cv.creado_en)} · ${utils.formatearTamanyo(cv.tamanyo)}</p>
            <div style="display: flex; gap: 0.8rem;">
              <a href="${API}/archivos/${cv.id}/download" class="btn-primary btn-small" style="text-decoration: none; display: inline-block;">Descargar</a>
              <button class="btn-outline btn-small" onclick="app.archivos.eliminar(${cv.id})">Eliminar</button>
            </div>
          </div>
        `;
      } else {
        cvContainer.innerHTML = `
          <div class="drag-drop-zone" id="cvDropZone" ondrop="event.preventDefault(); app.archivos.manejarDrop(event, 'cv')" ondragover="event.preventDefault(); document.getElementById('cvDropZone').classList.add('dragover')" ondragleave="document.getElementById('cvDropZone').classList.remove('dragover')">
            <p>📄 Sube tu CV (PDF, máx 5 MB)</p>
            <span>Arrastra y suelta o haz clic para seleccionar</span>
            <input type="file" id="cvInput" accept=".pdf" style="display: none;" onchange="app.archivos.subirCV()">
          </div>
          <button class="btn-primary" style="width: 100%; margin-top: 1rem;" onclick="document.getElementById('cvInput').click()">Seleccionar archivo</button>
        `;
      }

      // Renderizar galería de fotos (clínicas)
      const fotos = estadoApp.archivosUsuario.filter(a => a.tipo === 'foto');
      const fotosGallery = document.getElementById("fotosGallery");
      if (fotosGallery) {
        if (fotos.length > 0) {
          fotosGallery.innerHTML = fotos.map(f => `
            <div class="foto-item">
              <img src="${API}/archivos/${f.id}/download" alt="Foto de la clínica" loading="lazy">
              <button class="foto-eliminar" title="Eliminar foto" onclick="app.archivos.eliminar(${f.id})">✕</button>
            </div>
          `).join('');
        } else {
          fotosGallery.innerHTML = `<p style="color: #9ca3af; text-align: center;">Aún no has subido fotos de tu clínica.</p>`;
        }
      }

      // Renderizar Portfolio
      const portfolioList = document.getElementById("portfolioList");
      if (portfolios.length > 0) {
        portfolioList.innerHTML = portfolios.map(p => `
          <div style="background: #F8FAFF; padding: 1rem; border-radius: 8px; border-left: 4px solid #2ec4b6; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <p style="font-weight: 700; color: #2ec4b6; margin-bottom: 0.3rem;">🎨 ${utils.escapeHtml(p.nombre_archivo)}</p>
              <p style="font-size: 0.9rem; color: #666;">${utils.formatearFecha(p.creado_en)} · ${utils.formatearTamanyo(p.tamanyo)}</p>
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <a href="${API}/archivos/${p.id}/download" class="btn-primary btn-small" style="text-decoration: none; display: inline-block;">Descargar</a>
              <button class="btn-outline btn-small" onclick="app.archivos.eliminar(${p.id})">Eliminar</button>
            </div>
          </div>
        `).join("");
      }
    },

    async eliminar(id) {
      if (!confirm("¿Estás seguro de que deseas eliminar este archivo?")) return;

      try {
        await utils.request(`/archivos/${id}`, { method: "DELETE" });
        utils.mostrarAlerta("Archivo eliminado", "success");
        app.archivos.cargarArchivosUsuario();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Selector de municipio + provincia (dataset window.MUNICIPIOS_ES)
  // ============================================

  ciudades: {
    lista() { return window.MUNICIPIOS_ES || []; },

    // Monta un autocompletado sobre un input de ciudad que, al elegir un municipio,
    // rellena el input (oculto) de provincia y un span opcional con su etiqueta.
    montar(inputCiudad, inputProvincia, labelProvincia, alElegir) {
      if (!inputCiudad || inputCiudad.dataset.autocompleteMontado) return;
      inputCiudad.dataset.autocompleteMontado = "1";
      const cont = inputCiudad.parentElement;
      cont.style.position = "relative";

      const drop = document.createElement("div");
      drop.style.cssText = "position:absolute;left:0;right:0;top:100%;z-index:60;background:white;border:1px solid #e5e7eb;border-radius:6px;max-height:220px;overflow:auto;display:none;box-shadow:0 4px 12px rgba(0,0,0,.12);";
      cont.appendChild(drop);
      const cerrar = () => { drop.style.display = "none"; };
      const fijarProvincia = (valor) => {
        if (inputProvincia) inputProvincia.value = valor || "";
        if (labelProvincia) labelProvincia.textContent = valor ? `· Provincia: ${valor}` : "";
      };

      inputCiudad.addEventListener("input", () => {
        const q = inputCiudad.value.trim().toLowerCase();
        fijarProvincia(""); // hasta que se elija un municipio válido, no hay provincia
        if (q.length < 2) { cerrar(); return; }
        const res = this.lista().filter(m => m.m.toLowerCase().includes(q)).slice(0, 20);
        if (!res.length) { cerrar(); return; }
        drop.innerHTML = res.map(m =>
          `<div class="ciudad-op" data-m="${utils.escapeHtml(m.m)}" data-p="${utils.escapeHtml(m.p)}" style="padding:.5rem .75rem;cursor:pointer;">${utils.escapeHtml(m.m)} <span style="color:#9ca3af;">(${utils.escapeHtml(m.p)})</span></div>`
        ).join("");
        drop.style.display = "block";
      });

      drop.addEventListener("mousedown", (e) => {
        const op = e.target.closest(".ciudad-op");
        if (!op) return;
        inputCiudad.value = op.dataset.m;
        fijarProvincia(op.dataset.p);
        cerrar();
        // Elegir del catálogo cuenta como fijar la ciudad: se avisa por callback (p. ej.
        // para recargar la búsqueda), sin re-disparar el "input" que abriría el desplegable.
        if (typeof alElegir === "function") alElegir(op.dataset.m, op.dataset.p);
      });

      inputCiudad.addEventListener("blur", () => setTimeout(cerrar, 150));
    }
  },

  // ============================================
  // Módulo: Perfil
  // ============================================

  perfil: {
    async cargar() {
      if (!estadoApp.usuario) return;

      // Mostrar/ocultar tabs según tipo de usuario
      if (estadoApp.tipoUsuario === 'clinica') {
        document.getElementById("tabDatos").style.display = "inline-block";
        document.getElementById("tabTrayectoria").style.display = "none";
        document.getElementById("tabCv").style.display = "none";
        document.getElementById("tabPortfolio").style.display = "none";
        document.getElementById("tabDisponibilidad").style.display = "none";
        // El test de compatibilidad lo responden los dos: la clínica dice cómo es
        document.getElementById("tabCompatibilidad").style.display = "inline-block";
        document.getElementById("tabFotos").style.display = "inline-block";
        // El título es el nombre de la clínica: identifica de quién es el perfil
        // mejor que un rótulo genérico. Si aún no se conoce, se cae al rótulo.
        document.getElementById("perfilTitle").textContent =
          estadoApp.usuario?.nombre || "Datos de la clínica";
        app.sedes.cargar();
      } else {
        document.getElementById("tabDatos").style.display = "inline-block";
        document.getElementById("tabTrayectoria").style.display = "inline-block";
        document.getElementById("tabCv").style.display = "inline-block";
        document.getElementById("tabPortfolio").style.display = "inline-block";
        document.getElementById("tabDisponibilidad").style.display = "inline-block";
        document.getElementById("tabCompatibilidad").style.display = "inline-block";
        document.getElementById("tabFotos").style.display = "none";
        // El título es el nombre del dentista, igual que la clínica se titula con el
        // suyo. Si aún no se conoce, se cae al rótulo genérico.
        document.getElementById("perfilTitle").textContent =
          estadoApp.usuario?.nombre || "Mi perfil";
        app.trayectoria.cargar();
      }

      app.perfil.mostrarFormularioEdicion();

      // Archivos: CV/portfolio para dentistas, fotos para clínicas
      app.archivos.cargarArchivosUsuario();
    },

    async cargarDatos() {
      // Método vacío - las publicaciones se cargan desde la página principal
      // No se muestran en el perfil
    },

    switchTab(tab) {
      document.querySelectorAll("#modalPerfil .tab-content").forEach(el => el.classList.remove("active"));
      document.querySelectorAll("#modalPerfil .tab-btn").forEach(el => el.classList.remove("active"));

      document.getElementById(`tab-${tab}`).classList.add("active");
      event.target.classList.add("active");

      // La pestaña de CV muestra una vista previa generada a partir de Mis datos + Trayectoria
      if (tab === 'cv' && estadoApp.tipoUsuario === 'dentista') {
        app.perfil.renderPreviewCv();
      }
      if (tab === 'disponibilidad' && estadoApp.tipoUsuario === 'dentista') {
        app.disponibilidad.cargar();
      }
      // El test de compatibilidad lo responden los dos lados con las mismas preguntas
      if (tab === 'compatibilidad') {
        app.preferencias.cargar();
      }
    },

    // Las sedes se muestran dentro de "Mis datos", pero su marcado vive fuera del
    // contenedor que se reconstruye en cada render. Estas dos funciones lo mueven de
    // un sitio a otro en vez de duplicarlo: así el formulario de alta y toda la
    // lógica de app.sedes siguen siendo los mismos de siempre.
    aparcarSedes() {
      const bloque = document.getElementById("bloqueSedes");
      const aparcadero = document.getElementById("modalPerfil");
      if (bloque && aparcadero && bloque.parentElement !== aparcadero) {
        bloque.style.display = "none";
        aparcadero.appendChild(bloque);
      }
    },

    colocarSedes() {
      const bloque = document.getElementById("bloqueSedes");
      const ancla = document.getElementById("anclaSedes");
      if (!bloque || !ancla) return;
      ancla.appendChild(bloque);
      bloque.style.display = "block";
    },

    async mostrarFormularioEdicion() {
      const misDatosContainer = document.getElementById("misDatosContainer");

      // El bloque de sedes se mete dentro de este formulario, así que hay que sacarlo
      // ANTES de reconstruirlo: `innerHTML = …` borra los hijos, y con ellos se
      // llevaría por delante el bloque y sus campos.
      app.perfil.aparcarSedes();

      try {
        // Obtener datos completos del usuario desde el backend
        const u = await utils.request("/auth/mi-perfil");

        if (!u) {
          utils.mostrarAlerta("Error al cargar perfil", "error");
          return;
        }

      if (estadoApp.tipoUsuario === 'clinica') {
        misDatosContainer.innerHTML = `
          <form id="formPerfilEmpresa" onsubmit="app.perfil.guardar(event)">
            <div class="form-group">
              <label>Nombre de la clínica</label>
              <input type="text" id="perfilNombre" value="${utils.escapeHtml(u.nombre)}" required>
            </div>

            <div class="form-group">
              <label>Email</label>
              <input type="email" id="perfilEmail" value="${utils.escapeHtml(u.email)}" required>
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Se enviará un email de confirmación al cambiar</small>
              ${u.email_verificado
                ? `<small style="color: #10b981; font-weight: 600; margin-top: 0.3rem; display: block;">✓ Email verificado</small>`
                : `<small style="color: #f59e0b; margin-top: 0.3rem; display: block;">⚠️ Email sin verificar
                     <button type="button" class="btn-text btn-small" onclick="app.auth.reenviarVerificacion()">Reenviar correo</button>
                   </small>`}
            </div>

            <div class="form-group">
              <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                <input type="checkbox" id="perfilRecibirEmails" ${u.recibir_emails ? 'checked' : ''}>
                Recibir avisos por email (postulaciones, mensajes, cambios de estado)
              </label>
            </div>

            <div class="form-group">
              <label>Fijo</label>
              <input type="tel" id="perfilTelefono" value="${utils.escapeHtml(u.telefono || '')}">
            </div>

            <div class="form-group">
              <label>Móbil</label>
              <input type="tel" id="perfilMovil" value="${utils.escapeHtml(u.movil || '')}">
            </div>

            <div class="form-group">
              <label>Dirección</label>
              <input type="text" id="perfilDireccion" value="${utils.escapeHtml(u.direccion || '')}">
            </div>

            <div class="form-group">
              <label>Código Postal</label>
              <input type="text" id="perfilCodigoPostal" value="${utils.escapeHtml(u.codigo_postal || '')}">
            </div>

            <div class="form-group">
              <label>Ciudad</label>
              <input type="text" id="perfilCiudad" value="${utils.escapeHtml(u.ciudad || '')}">
            </div>

            <div class="form-group">
              <label>País</label>
              <input type="text" id="perfilPais" value="${utils.escapeHtml(u.pais || '')}">
            </div>

            <div class="form-group">
              <label>Descripción de la clínica</label>
              <textarea id="perfilDescripcion" placeholder="Cuenta cómo es tu clínica: equipo, instalaciones, filosofía de trabajo...">${utils.escapeHtml(u.descripcion || '')}</textarea>
            </div>

            <div class="form-group">
              <label>Especialidades que ofrece</label>
              <div id="especialidadesContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <!-- Se llenarán dinámicamente -->
              </div>
            </div>

            <div class="form-group">
              <label>🦷 Equipamiento de la clínica</label>
              <div id="clinicaEquipamientoContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem;"></div>
            </div>

            <hr style="margin: 1.5rem 0; border: none; border-top: 1px solid #e5e7eb;">

            <div class="form-group">
              <label>Contraseña actual (obligatorio para cambiar)</label>
              <input type="text" id="perfilPasswordActual" placeholder="Ingresa tu contraseña actual" style="margin-bottom: 0.8rem;">

              <label>Nueva contraseña (opcional)</label>
              <input type="text" id="perfilPasswordNueva" placeholder="Deja vacío si no quieres cambiar" style="margin-bottom: 0.8rem;">

              <label>Confirmar contraseña (debe coincidir)</label>
              <input type="text" id="perfilPasswordConfirma" placeholder="Repite la nueva contraseña">
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Si no cambias contraseña, deja los últimos dos campos en blanco.</small>
            </div>

            <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
              <button type="button" class="btn-outline" style="flex: 1;" onclick="app.perfil.cancelarEdicion()">❌ Deshacer cambios</button>
              <button type="submit" class="btn-primary" style="flex: 1;">💾 Guardar cambios</button>
            </div>
          </form>
          <hr style="margin: 1.5rem 0; border: none; border-top: 1px solid #e5e7eb;">
          <div id="anclaSedes"></div>
          <div class="zona-peligro">
            <h4>⚠️ Zona de peligro</h4>
            <p>Eliminar tu cuenta borra tus datos personales, archivos y publicaciones de forma irreversible. Los mensajes y reseñas que compartiste con otros usuarios quedarán anonimizados.</p>
            <button type="button" class="btn-outline btn-small" style="border-color: #dc2626; color: #dc2626;" onclick="app.perfil.eliminarCuenta()">Eliminar mi cuenta</button>
          </div>
        `;

        app.perfil.colocarSedes();

        // Equipamiento de la clínica (vale para todas sus sedes)
        try {
          await app.catalogos.cargar();
          const equip = await utils.requestOpcional("/auth/mi-equipamiento");
          app.catalogos.renderizarEquipamientoPerfil(equip?.equipamiento || []);
        } catch (e) {
          console.error("No se pudo cargar el equipamiento:", e);
        }

        // Cargar especialidades para empresa
        await app.perfil.cargarEspecialidades();
      } else {
        misDatosContainer.innerHTML = `
          <form id="formPerfilCandidato" onsubmit="app.perfil.guardar(event)">
            <div class="form-group">
              <label>Nombre Completo</label>
              <input type="text" id="perfilNombre" value="${utils.escapeHtml(u.nombre)}" required>
            </div>

            <div class="form-group">
              <label>Email</label>
              <input type="email" id="perfilEmail" value="${utils.escapeHtml(u.email)}" required>
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Se enviará un email de confirmación al cambiar</small>
              ${u.email_verificado
                ? `<small style="color: #10b981; font-weight: 600; margin-top: 0.3rem; display: block;">✓ Email verificado</small>`
                : `<small style="color: #f59e0b; margin-top: 0.3rem; display: block;">⚠️ Email sin verificar
                     <button type="button" class="btn-text btn-small" onclick="app.auth.reenviarVerificacion()">Reenviar correo</button>
                   </small>`}
            </div>

            <div class="form-group">
              <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                <input type="checkbox" id="perfilRecibirEmails" ${u.recibir_emails ? 'checked' : ''}>
                Recibir avisos por email (postulaciones, mensajes, cambios de estado)
              </label>
            </div>

            <div class="form-group">
              <label>Fijo</label>
              <input type="tel" id="perfilTelefono" value="${utils.escapeHtml(u.telefono || '')}">
            </div>

            <div class="form-group">
              <label>Móbil</label>
              <input type="tel" id="perfilMovil" value="${utils.escapeHtml(u.movil || '')}">
            </div>

            <div class="form-group">
              <label>Dirección</label>
              <input type="text" id="perfilDireccion" value="${utils.escapeHtml(u.direccion || '')}">
            </div>

            <div class="form-group">
              <label>Código Postal</label>
              <input type="text" id="perfilCodigoPostal" value="${utils.escapeHtml(u.codigo_postal || '')}">
            </div>

            <div class="form-group">
              <label>Ciudad</label>
              <input type="text" id="perfilCiudad" value="${utils.escapeHtml(u.ciudad || '')}" autocomplete="off" placeholder="Escribe tu municipio…">
              <input type="hidden" id="perfilProvincia" value="${utils.escapeHtml(u.provincia || '')}">
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Elige un municipio de la lista para fijar la provincia. <span id="perfilProvinciaLabel">${u.provincia ? '· Provincia: ' + utils.escapeHtml(u.provincia) : ''}</span></small>
            </div>

            <div class="form-group">
              <label>País</label>
              <input type="text" id="perfilPais" value="${utils.escapeHtml(u.pais || '')}">
            </div>

            <div class="form-group">
              <label>Años de experiencia</label>
              <input type="number" id="perfilAnyosExperiencia" min="0" value="${u.anyos_experiencia ?? ''}" placeholder="Ej: 5">
            </div>

            <div class="form-group">
              <label>Certificaciones</label>
              <div id="certificacionesContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <!-- Se llenarán dinámicamente -->
              </div>
            </div>

            <div class="form-group">
              <label>Sobre mí</label>
              <textarea id="perfilDescripcion" placeholder="Cuenta tu trayectoria, formación y qué tipo de trabajo buscas...">${utils.escapeHtml(u.descripcion || '')}</textarea>
            </div>

            <div class="form-group">
              <label>Especialidades</label>
              <div id="especialidadesContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <!-- Se llenarán dinámicamente -->
              </div>
            </div>

            <hr style="margin: 1.5rem 0; border: none; border-top: 1px solid #e5e7eb;">

            <div class="form-group">
              <label>Contraseña actual (obligatorio para cambiar)</label>
              <input type="text" id="perfilPasswordActual" placeholder="Ingresa tu contraseña actual" style="margin-bottom: 0.8rem;">

              <label>Nueva contraseña (opcional)</label>
              <input type="text" id="perfilPasswordNueva" placeholder="Deja vacío si no quieres cambiar" style="margin-bottom: 0.8rem;">

              <label>Confirmar contraseña (debe coincidir)</label>
              <input type="text" id="perfilPasswordConfirma" placeholder="Repite la nueva contraseña">
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Si no cambias contraseña, deja los últimos dos campos en blanco.</small>
            </div>

            <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
              <button type="button" class="btn-outline" style="flex: 1;" onclick="app.perfil.cancelarEdicion()">❌ Deshacer cambios</button>
              <button type="submit" class="btn-primary" style="flex: 1;">💾 Guardar cambios</button>
            </div>
          </form>
          <div class="zona-peligro">
            <h4>⚠️ Zona de peligro</h4>
            <p>Eliminar tu cuenta borra tus datos personales, archivos y publicaciones de forma irreversible. Los mensajes y reseñas que compartiste con otros usuarios quedarán anonimizados.</p>
            <button type="button" class="btn-outline btn-small" style="border-color: #dc2626; color: #dc2626;" onclick="app.perfil.eliminarCuenta()">Eliminar mi cuenta</button>
          </div>
        `;

        // Cargar especialidades y certificaciones para candidatos
        await app.perfil.cargarEspecialidades();
        await app.perfil.cargarCertificaciones();

        // Autocompletado de municipio + provincia
        app.ciudades.montar(
          document.getElementById("perfilCiudad"),
          document.getElementById("perfilProvincia"),
          document.getElementById("perfilProvinciaLabel")
        );
      }
      } catch (error) {
        utils.mostrarAlerta("Error al cargar perfil: " + error.message, "error");
      }
    },

    async cargarCertificaciones() {
      try {
        await app.catalogos.cargar();
        const respuesta = await utils.request("/auth/mis-certificaciones");
        app.catalogos.renderizarCertificacionesPerfil(respuesta.certificaciones || []);
      } catch (error) {
        console.error("Error al cargar certificaciones:", error);
      }
    },

    async guardar(event) {
      event.preventDefault();

      const nuevoEmail = document.getElementById("perfilEmail").value;

      // Validar email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(nuevoEmail)) {
        utils.mostrarAlerta("Por favor ingresa un email válido", "error");
        return;
      }

      const emailCambio = nuevoEmail !== estadoApp.usuario.email;

      const datosActualizados = {
        nombre: document.getElementById("perfilNombre").value,
        email: nuevoEmail,
        telefono: document.getElementById("perfilTelefono").value || null,
        movil: document.getElementById("perfilMovil").value || null,
        ciudad: document.getElementById("perfilCiudad").value || null,
        provincia: document.getElementById("perfilProvincia")?.value || null,
        direccion: document.getElementById("perfilDireccion").value || null,
        codigo_postal: document.getElementById("perfilCodigoPostal").value || null,
        pais: document.getElementById("perfilPais").value || null,
        descripcion: document.getElementById("perfilDescripcion")?.value || null,
        anyos_experiencia: document.getElementById("perfilAnyosExperiencia")?.value || null,
        recibir_emails: document.getElementById("perfilRecibirEmails")?.checked ?? true
      };

      try {
        if (emailCambio) {
          // Si cambió el email, solicitar confirmación
          await app.perfil.solicitarCambioEmail(datosActualizados);
        } else {
          // Si no cambió el email, solo actualizar otros datos
          const response = await utils.request("/auth/actualizar-perfil", {
            method: "PUT",
            body: JSON.stringify(datosActualizados)
          });

          if (response.error) {
            utils.mostrarAlerta(response.error, "error");
            return;
          }

          estadoApp.usuario = { ...estadoApp.usuario, ...datosActualizados };

          // El título del perfil es el nombre del usuario (clínica o dentista): si
          // acaba de cambiarlo, que no se quede el anterior en la cabecera.
          if (estadoApp.usuario.nombre) {
            const titulo = document.getElementById("perfilTitle");
            if (titulo) titulo.textContent = estadoApp.usuario.nombre;
          }

          // Guardar especialidades si es candidato o empresa
          if (['dentista', 'clinica'].includes(estadoApp.tipoUsuario)) {
            const checkboxes = document.querySelectorAll('#especialidadesContainer input[type="checkbox"]');
            const especialidadesSeleccionadas = Array.from(checkboxes)
              .filter(cb => cb.checked)
              .map(cb => parseInt(cb.value));

            await utils.request("/auth/guardar-especialidades", {
              method: "POST",
              body: JSON.stringify({ especialidades: especialidadesSeleccionadas })
            });
          }

          // Equipamiento de la clínica: se guarda con el resto de "Mis datos"
          if (estadoApp.tipoUsuario === 'clinica') {
            const equipos = Array.from(
              document.querySelectorAll('#clinicaEquipamientoContainer input[type="checkbox"]:checked')
            ).map(cb => cb.value);
            await utils.request("/auth/guardar-equipamiento", {
              method: "POST",
              body: JSON.stringify({ equipamiento: equipos })
            });
            // La vista previa al publicar lo tiene cacheado: que no muestre lo viejo
            app.catalogos.equipamientoClinica = equipos;
          }

          // Guardar certificaciones (solo dentistas)
          if (estadoApp.tipoUsuario === 'dentista') {
            const certCheckboxes = document.querySelectorAll('#certificacionesContainer input[type="checkbox"]');
            const certificacionesSeleccionadas = Array.from(certCheckboxes)
              .filter(cb => cb.checked)
              .map(cb => cb.value);

            await utils.request("/auth/guardar-certificaciones", {
              method: "POST",
              body: JSON.stringify({ certificaciones: certificacionesSeleccionadas })
            });
          }

          // Cambiar contraseña si se proporcionó
          const passwordActual = document.getElementById("perfilPasswordActual").value;
          const passwordNueva = document.getElementById("perfilPasswordNueva").value;
          const passwordConfirma = document.getElementById("perfilPasswordConfirma").value;

          // Procesar cambio si hay intención: si se ingresó algo en cualquier campo
          const hayIntencionCambio = passwordActual || passwordNueva || passwordConfirma;

          if (hayIntencionCambio) {
            // Validar que las nuevas contraseñas coincidan
            if (passwordNueva !== passwordConfirma) {
              utils.mostrarAlerta("❌ Las contraseñas no coinciden", "error");
              return;
            }

            // Nota: passwordActual puede ser vacío si la contraseña actual es también vacía
            // Se enviará al backend para validar

            const resPassword = await utils.request("/auth/cambiar-password", {
              method: "PUT",
              body: JSON.stringify({ passwordActual, passwordNueva })
            });

            if (resPassword.error) {
              utils.mostrarAlerta("❌ " + resPassword.error, "error");
              return;
            }

            // Limpiar campos de password después de guardar exitosamente
            document.getElementById("perfilPasswordActual").value = "";
            document.getElementById("perfilPasswordNueva").value = "";
            document.getElementById("perfilPasswordConfirma").value = "";
          }

          utils.mostrarAlerta("✅ Perfil actualizado correctamente", "success");
          app.modal.cerrarPerfil();
        }
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async solicitarCambioEmail(datosActualizados) {
      try {
        // Guardar especialidades primero si es candidato o empresa
        if (['dentista', 'clinica'].includes(estadoApp.tipoUsuario)) {
          const checkboxes = document.querySelectorAll('#especialidadesContainer input[type="checkbox"]');
          const especialidadesSeleccionadas = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => parseInt(cb.value));

          await utils.request("/auth/guardar-especialidades", {
            method: "POST",
            body: JSON.stringify({ especialidades: especialidadesSeleccionadas })
          });
        }

        // Guardar certificaciones (solo dentistas)
        if (estadoApp.tipoUsuario === 'dentista') {
          const certCheckboxes = document.querySelectorAll('#certificacionesContainer input[type="checkbox"]');
          const certificacionesSeleccionadas = Array.from(certCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

          await utils.request("/auth/guardar-certificaciones", {
            method: "POST",
            body: JSON.stringify({ certificaciones: certificacionesSeleccionadas })
          });
        }

        // Cambiar contraseña si se proporcionó (ANTES de cambiar email)
        const passwordActual = document.getElementById("perfilPasswordActual").value;
        const passwordNueva = document.getElementById("perfilPasswordNueva").value;
        const passwordConfirma = document.getElementById("perfilPasswordConfirma").value;

        // Procesar cambio si hay intención: si se ingresó algo en cualquier campo
        const hayIntencionCambio = passwordActual || passwordNueva || passwordConfirma;

        if (hayIntencionCambio) {
          // Validar que las nuevas contraseñas coincidan
          if (passwordNueva !== passwordConfirma) {
            utils.mostrarAlerta("❌ Las contraseñas no coinciden", "error");
            return;
          }

          const resPassword = await utils.request("/auth/cambiar-password", {
            method: "PUT",
            body: JSON.stringify({ passwordActual, passwordNueva })
          });

          if (resPassword.error) {
            utils.mostrarAlerta("❌ " + resPassword.error, "error");
            return;
          }

          // Limpiar campos de password después de guardar exitosamente
          document.getElementById("perfilPasswordActual").value = "";
          document.getElementById("perfilPasswordNueva").value = "";
          document.getElementById("perfilPasswordConfirma").value = "";
        }

        // Solicitar cambio de email
        const response = await utils.request("/auth/solicitar-cambio-email", {
          method: "POST",
          body: JSON.stringify({
            nuevoEmail: datosActualizados.email,
            datos: {
              nombre: datosActualizados.nombre,
              telefono: datosActualizados.telefono,
              movil: datosActualizados.movil,
              ciudad: datosActualizados.ciudad,
              direccion: datosActualizados.direccion,
              codigo_postal: datosActualizados.codigo_postal,
              pais: datosActualizados.pais
            }
          })
        });

        if (response.error) {
          utils.mostrarAlerta(response.error, "error");
          return;
        }

        // Actualizar estadoApp con los datos (sin email, que se confirmará después)
        const { email: emailNuevo, ...datosOtros } = datosActualizados;
        estadoApp.usuario = { ...estadoApp.usuario, ...datosOtros };

        // Mostrar modal de confirmación
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'modalConfirmacionEmail';
        modal.innerHTML = `
          <div class="modal-overlay"></div>
          <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
              <h2>Confirmación de Email</h2>
              <button class="close-btn" onclick="document.getElementById('modalConfirmacionEmail').remove()">✕</button>
            </div>
            <div style="padding: 1.5rem;">
              <div style="background: #F0F9FF; padding: 1rem; border-radius: 8px; border-left: 4px solid #3b82f6; margin-bottom: 1rem;">
                <p style="margin: 0; font-size: 0.95rem;">
                  📧 Se ha enviado un email de confirmación a <strong>${datosActualizados.email}</strong>
                </p>
              </div>
              <p style="color: var(--gray-600); margin: 1rem 0;">
                Haz clic en el link de confirmación en el email para completar el cambio de email. Tu email actual seguirá siendo válido hasta confirmar.
              </p>
              <div style="background: #FEF3C7; padding: 0.75rem; border-radius: 6px; border-left: 3px solid #F59E0B;">
                <small style="color: #92400E;">💡 Verifica tu carpeta de spam si no ves el email</small>
              </div>
              <button class="btn-primary" style="width: 100%; margin-top: 1.5rem;" onclick="document.getElementById('modalConfirmacionEmail').remove(); app.perfil.cargar();">
                Entendido
              </button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);

      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    cancelarEdicion() {
      app.perfil.cargar();
    },

    // Derecho de supresión: borra la cuenta previa doble confirmación
    async eliminarCuenta() {
      const seguro = confirm("⚠️ Vas a eliminar tu cuenta de forma IRREVERSIBLE.\n\nSe borrarán tus datos, archivos y publicaciones. ¿Quieres continuar?");
      if (!seguro) return;

      const password = prompt("Para confirmar, escribe tu contraseña:");
      if (password === null) return;

      try {
        const res = await utils.request("/auth/mi-cuenta", {
          method: "DELETE",
          body: JSON.stringify({ password })
        });
        app.modal.cerrarTodosModales();
        utils.mostrarAlerta(res.mensaje || "Cuenta eliminada", "info");
        app.auth.logout();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Descarga el CV en PDF generado por el backend (fetch con token → blob)
    async descargarCvPdf() {
      try {
        const response = await fetch(`${API}/auth/mi-cv.pdf`, {
          headers: { Authorization: `Bearer ${estadoApp.token}` }
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Error al generar el CV");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement("a");
        enlace.href = url;
        enlace.download = `CV-${(estadoApp.usuario?.nombre || 'dentista').replace(/\s+/g, '-')}.pdf`;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Vista previa en pantalla del CV, con los mismos datos que el PDF (Mis datos + Trayectoria)
    async renderPreviewCv() {
      const cont = document.getElementById("cvPreview");
      if (!cont) return;
      try {
        const cv = await utils.request("/auth/mi-cv");
        const u = cv.usuario || {};
        const seccion = (titulo, cuerpo) => cuerpo
          ? `<h4 style="color: #0f4c75; margin: 1rem 0 0.4rem;">${titulo}</h4>${cuerpo}`
          : "";

        const contacto = [u.email, u.movil || u.telefono, [u.ciudad, u.pais].filter(Boolean).join(", ")]
          .filter(Boolean).map(utils.escapeHtml).join("  ·  ");

        const valoracion = (cv.resenyas && cv.resenyas.total > 0)
          ? `<p style="color: #b45309; font-size: 0.85rem; margin: 0.3rem 0;">Valoración media: ${Math.round(cv.resenyas.media * 10) / 10}/5 (${cv.resenyas.total} reseña${cv.resenyas.total === 1 ? "" : "s"})</p>`
          : "";

        const experiencia = (u.anyos_experiencia !== null && u.anyos_experiencia !== undefined)
          ? `<p style="margin: 0.2rem 0;">${u.anyos_experiencia} año${u.anyos_experiencia === 1 ? "" : "s"} de experiencia profesional</p>` : "";

        const expLaboral = (cv.experienciaLaboral || []).map(e => {
          const rango = [e.fecha_inicio, e.actual ? "Actualidad" : e.fecha_fin].filter(Boolean).join(" – ");
          return `<div style="margin-bottom: 0.5rem;">
            <strong>${utils.escapeHtml(e.especialidad || "")}${e.lugar ? " · " + utils.escapeHtml(e.lugar) : ""}</strong>
            ${rango ? `<div style="color: #6b7280; font-size: 0.85rem;">${utils.escapeHtml(rango)}</div>` : ""}
            ${e.descripcion ? `<div style="color: #6b7280; font-size: 0.9rem;">${utils.escapeHtml(e.descripcion)}</div>` : ""}
          </div>`;
        }).join("");

        const formacion = (cv.formacionLista || [])
          .map(f => `<div>${utils.escapeHtml([f.titulo, f.centro].filter(Boolean).join(" · ") + (f.anyo ? ` (${f.anyo})` : ""))}</div>`).join("");
        const idiomas = (cv.idiomasLista || []).length
          ? `<p style="margin: 0.2rem 0;">${cv.idiomasLista.map(i => `${utils.escapeHtml(i.idioma)} (${utils.escapeHtml(i.nivel)})`).join("  ·  ")}</p>` : "";
        const especialidades = (cv.especialidades || [])
          .map(e => `<div>•  ${utils.escapeHtml(e.nombre)}</div>`).join("");
        const certificaciones = (cv.certificacionesLista || [])
          .map(c => `<div>•  ${utils.escapeHtml(c.certificacion)}</div>`).join("");

        cont.innerHTML = `
          <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem; background: white;">
            <h3 style="color: #0f4c75; margin: 0;">${utils.escapeHtml(u.nombre || "")}</h3>
            <p style="color: #4b5563; margin: 0.1rem 0;">Dentista</p>
            ${contacto ? `<p style="font-size: 0.85rem; color: #4b5563; margin: 0.3rem 0;">${contacto}</p>` : ""}
            ${valoracion}
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0.75rem 0;">
            ${seccion("Perfil", u.descripcion ? `<p style="margin: 0.2rem 0;">${utils.escapeHtml(u.descripcion)}</p>` : "")}
            ${seccion("Experiencia", experiencia)}
            ${seccion("Experiencia laboral", expLaboral)}
            ${seccion("Formación", formacion)}
            ${seccion("Idiomas", idiomas)}
            ${seccion("Especialidades", especialidades)}
            ${seccion("Certificaciones", certificaciones)}
          </div>`;
      } catch (error) {
        cont.innerHTML = `<p style="color: #ef4444;">${utils.escapeHtml(error.message)}</p>`;
      }
    },

    async cargarEspecialidades() {
      // Funciona tanto para candidatos como para empresas
      if (!['dentista', 'clinica'].includes(estadoApp.tipoUsuario)) return;

      try {
        // Obtener especialidades disponibles
        if (!estadoApp.especialidades || estadoApp.especialidades.length === 0) {
          await app.especialidades.cargar();
        }

        // Obtener especialidades del usuario
        const respuesta = await utils.request("/auth/mi-especialidades");
        const especialidadesUsuario = respuesta.especialidades || [];

        const container = document.getElementById("especialidadesContainer");
        if (!container) return;

        container.innerHTML = estadoApp.especialidades.map(esp => `
          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
            <input type="checkbox" value="${esp.id}" ${especialidadesUsuario.includes(esp.id) ? 'checked' : ''} style="cursor: pointer;">
            ${esp.nombre}
          </label>
        `).join('');
      } catch (error) {
        console.error("Error al cargar especialidades:", error);
      }
    }
  },

  // ============================================
  // Módulo: UI
  // ============================================

  ui: {
    statsPollingInterval: null,

    iniciarActualizacionAutomatica() {
      // Detener pollings anteriores si existen
      if (this.statsPollingInterval) clearInterval(this.statsPollingInterval);
      if (this.badgePollingInterval) clearInterval(this.badgePollingInterval);

      // Actualizar stats cada 3 minutos; no son datos que cambien al segundo,
      // así que no hace falta más frecuencia y se ahorran peticiones al backend
      this.statsPollingInterval = setInterval(async () => {
        // Con la pestaña en segundo plano, esperar a que vuelva a estar visible
        if (document.visibilityState !== "visible") return;
        try {
          await app.ui.actualizarStats();
        } catch (error) {
          console.error("Error al actualizar stats:", error);
        }
      }, 180000);

      // El contador de mensajes no leídos sí debe reaccionar rápido: se comprueba
      // cada 20 s (consulta ligera) para que el número rojo aparezca casi al momento.
      this.badgePollingInterval = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        app.chat.actualizarContador();
        app.notificaciones.actualizar();
      }, 20000);

      // Y al volver a la pestaña, refrescar los contadores de inmediato
      if (!this._visibilidadBadgeListener) {
        this._visibilidadBadgeListener = () => {
          if (document.visibilityState === "visible" && estadoApp.usuario) {
            app.chat.actualizarContador();
            app.notificaciones.actualizar();
          }
        };
        document.addEventListener("visibilitychange", this._visibilidadBadgeListener);
      }
    },

    detenerActualizacionAutomatica() {
      if (this.statsPollingInterval) {
        clearInterval(this.statsPollingInterval);
        this.statsPollingInterval = null;
      }
      if (this.badgePollingInterval) {
        clearInterval(this.badgePollingInterval);
        this.badgePollingInterval = null;
      }
    },

    async init() {
      await app.especialidades.cargar();
      await app.catalogos.cargar();
      app.catalogos.renderizarFiltros();

      if (estadoApp.token && estadoApp.usuario) {
        app.ui.mostrarPlataforma();
      } else {
        app.ui.mostrarLanding();
      }

      // Enlaces llegados por correo (verificación, restablecer contraseña…)
      app.auth.procesarEnlacesDeCorreo();
    },

    mostrarLanding() {
      document.getElementById("heroLanding").style.display = "block";
      document.getElementById("heroPlataforma").style.display = "none";
      document.getElementById("statsContainer").style.display = "none";
      document.getElementById("mainContainer").style.display = "none";
      document.getElementById("navButtonsLanding").style.display = "flex";
      document.getElementById("navButtonsLogueado").style.display = "none";
    },

    async mostrarPlataforma() {
      utils.ocultarElementos("heroLanding", "landingFeatures", "landingBenefitsDentistas", "landingBenefitsClinicas");
      document.getElementById("heroPlataforma").style.display = "block";
      document.getElementById("statsContainer").style.display = "block";
      document.getElementById("mainContainer").style.display = "block";
      document.getElementById("navButtonsLanding").style.display = "none";
      document.getElementById("navButtonsLogueado").style.display = "flex";
      document.getElementById("btnPublicar").style.display = "inline-block";
      document.getElementById("btnPerfil").style.display = "inline-block";
      document.getElementById("btnLogout").style.display = "inline-block";
      document.getElementById("btnExportarCsv").style.display = "inline-block";
      // "Favoritos" solo lo usa el dentista; en la clínica se retiró de la búsqueda
      document.getElementById("btnFavoritos").style.display =
        estadoApp.tipoUsuario === 'clinica' ? "none" : "inline-block";
      document.getElementById("btnChat").style.display = "inline-block";
      document.getElementById("btnNotif").style.display = "inline-block";
      app.chat.actualizarContador();
      app.notificaciones.actualizar();
      app.onboarding.refrescar();
      app.recordatorios.comprobar();

      // Actualizar texto del hero según tipo de usuario
      const heroTitle = document.querySelector("#heroPlataforma h1");
      const filtersTitle = document.getElementById("filtrosTitle");
      const btnTodas = document.getElementById("btnTodas");
      const btnMias = document.getElementById("btnMias");

      const btnContactadas = document.getElementById("btnContactadas");

      if (estadoApp.tipoUsuario === 'clinica') {
        heroTitle.textContent = `🦷 ${estadoApp.usuario?.nombre || 'Mi Empresa'}`;
        filtersTitle.textContent = "";
        filtersTitle.style.display = "none";
        btnTodas.style.display = "inline-block";
        btnMias.style.display = "none";
        document.getElementById("btnPublicaciones").style.display = "inline-block";
        btnContactadas.style.display = "none";
        const btnMisPostClinica = document.getElementById("btnMisPostulacionesDentistas");
        btnMisPostClinica.style.display = "inline-block";
        btnMisPostClinica.textContent = "📌 Mis Postulaciones";
        document.getElementById("btnMisPostulacionesDentistasAceptadas").style.display = "none";
        document.getElementById("btnKanban").style.display = "none";
        document.getElementById("btnSuplencias").style.display = "none";
        document.getElementById("filterEquipamientoGroup").style.display = "none";
        document.getElementById("filterCertificacionGroup").style.display = "block";
        const btnPerfilesClinica = document.getElementById("btnPerfiles");
        btnPerfilesClinica.style.display = "inline-block";
        btnPerfilesClinica.textContent = "🦷 Dentistas";
        btnPerfilesClinica.title = "Dentistas abiertos a cambios profesionales";
        btnTodas.textContent = "Publicaciones de dentistas";
      } else {
        // Dentista
        const nombrePartes = (estadoApp.usuario?.nombre || 'Candidato').split(' ');
        const nombreCorto = nombrePartes.length >= 2 ? `${nombrePartes[0]} ${nombrePartes[1]}` : nombrePartes[0];
        heroTitle.textContent = `🦷 ${nombreCorto}`;
        filtersTitle.textContent = "Clínicas";
        filtersTitle.style.display = "block";
        btnTodas.style.display = "inline-block";
        btnMias.style.display = "none";
        document.getElementById("btnPublicaciones").style.display = "inline-block";
        btnContactadas.style.display = "none";
        document.getElementById("btnMisPostulacionesDentistas").style.display = "none";
        document.getElementById("btnMisPostulacionesDentistasAceptadas").style.display = "none";
        document.getElementById("btnKanban").style.display = "inline-block";
        document.getElementById("btnSuplencias").style.display = "inline-block";
        document.getElementById("filterEquipamientoGroup").style.display = "block";
        document.getElementById("filterCertificacionGroup").style.display = "none";
        const btnPerfilesDentista = document.getElementById("btnPerfiles");
        btnPerfilesDentista.style.display = "inline-block";
        btnPerfilesDentista.textContent = "👤 Perfiles de clínicas";
        btnPerfilesDentista.title = "";
        btnTodas.textContent = "Publicaciones de clínicas";
      }

      estadoApp.filtros.soloMias = false;
      estadoApp.vistaActual = "publicaciones";
      app.exportar.actualizarBoton();
      document.querySelectorAll(".tipo-toggle button").forEach(btn => btn.classList.remove("active"));
      document.getElementById("btnTodas").classList.add("active");

      await app.publicaciones.cargar();
      await app.ui.actualizarStats();

      // Iniciar actualización automática cada 30 segundos
      app.ui.iniciarActualizacionAutomatica();
    },

    async actualizarStats() {
      try {
        if (!estadoApp.usuario) return; // el usuario pudo cerrar sesión mientras esto cargaba

        const statsGrid = document.getElementById("statsGrid");
        const statsContainer = document.getElementById("statsContainer");

        if (estadoApp.tipoUsuario === 'clinica') {
          // La clínica ya no tiene panel de cifras: sus accesos viven en la barra de
          // búsqueda ("Mis Postulaciones"). Sin tarjetas se oculta el recuadro entero,
          // que si no quedaría un panel vacío.
          statsGrid.innerHTML = "";
          if (statsContainer) statsContainer.style.display = "none";
          return;
        } else {
          if (statsContainer) statsContainer.style.display = "block";
          // Dentista: mostrar Clínicas, Clínicas Potenciales, Postulaciones a Clínicas y Postulaciones Recibidas
          const [totalClinicas, clinicasPotenciales, misPostulaciones, postulacionesRecibidas] = await Promise.all([
            utils.requestOpcional("/stats/total-clinicas"),
            utils.requestOpcional(`/stats/clinicas-potenciales/${estadoApp.usuario.id}`),
            utils.requestOpcional(`/stats/mis-postulaciones/${estadoApp.usuario.id}`),
            utils.requestOpcional(`/stats/postulaciones-recibidas-dentista/${estadoApp.usuario.id}`)
          ]);

          statsGrid.innerHTML = `
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarTotalClinicas()">
              <span>📋</span>
              <h3>${utils.cifra(totalClinicas)}</h3>
              <p>Clínicas</p>
              <div class="stat-tooltip">Total de clínicas en la plataforma. Ver desglose por especialidad, ciudad o ambas</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarClinicasPotenciales()">
              <span>🔍</span>
              <h3>${utils.cifra(clinicasPotenciales)}</h3>
              <p>Clínicas Potenciales</p>
              <div class="stat-tooltip">Clínicas que coinciden con ciudad y especialidad de mis publicaciones</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarMisPostulaciones()">
              <span>📬</span>
              <h3>${utils.cifra(misPostulaciones)}</h3>
              <p>Postulaciones a Clínicas</p>
              <div class="stat-tooltip">Postulaciones a publicaciones de clínicas</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarPostulacionesRecibidas()">
              <span>📧</span>
              <h3>${utils.cifra(postulacionesRecibidas)}</h3>
              <p>Postulaciones Recibidas</p>
              <div class="stat-tooltip">Clínicas postuladas a nuestras publicaciones</div>
            </div>
          `;
        }
      } catch (error) {
        console.error(error);
      }
    },

    async renderizarPublicaciones() {
      const container = document.getElementById("publicacionesContainer");

      // Cargar postulaciones del usuario actual para verificar estado
      let misPostulaciones = [];
      let misFavoritos = new Set();
      if (estadoApp.usuario) {
        try {
          const data = await utils.request("/candidaturas/mis-postulaciones");
          misPostulaciones = data.candidaturas || [];
        } catch (error) {
          console.error("Error al cargar postulaciones:", error);
        }
        try {
          const favoritos = await utils.request("/favoritos");
          misFavoritos = new Set(favoritos.map(f => f.id));
        } catch (error) {
          console.error("Error al cargar favoritos:", error);
        }
      }

      if (estadoApp.publicaciones.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <h3>No hay publicaciones</h3>
            <p>Intenta cambiar los filtros o vuelve más tarde.</p>
          </div>
        `;
        return;
      }

      // Cargar candidatos para las ofertas propias
      const candidatosPorOferta = {};
      if (estadoApp.tipoUsuario === 'clinica' && estadoApp.usuario) {
        try {
          const data = await utils.request(`/publicaciones/usuario/${estadoApp.usuario.id}/candidatos`);
          if (data.ofertas) {
            data.ofertas.forEach(oferta => {
              candidatosPorOferta[oferta.publicacion_id] = oferta.candidatos_count || 0;
            });
          }
        } catch (error) {
          console.error("Error al cargar candidatos:", error);
        }
      }

      const html = await Promise.all(estadoApp.publicaciones.map(async pub => {
        let especialidadesText = '';
        try {
          const data = await utils.request(`/publicaciones/${pub.id}/especialidades`, { method: 'GET' });
          if (data.especialidades && data.especialidades.length > 0) {
            especialidadesText = data.especialidades.map(e => e.nombre).join(", ");
          }
        } catch (error) {
          console.error("Error al obtener especialidades:", error);
        }
        const ciudadLabel = utils.escapeHtml(pub.provincia ? `${pub.ciudad} (${pub.provincia})` : pub.ciudad);
        // En sus propias publicaciones, la clínica ve la SEDE (su nombre de cuenta no
        // le distingue nada si tiene varias); si la publicación no tiene sede asignada,
        // se cae al nombre de la clínica. Quien mira desde fuera sigue viendo la clínica.
        const esMia = estadoApp.usuario && parseInt(pub.usuario_id) === parseInt(estadoApp.usuario.id);
        const nombreClinica = (esMia && pub.sede_nombre) ? pub.sede_nombre : (pub.usuario_nombre || 'Clínica');
        const generatedTitle = pub.tipo === 'solicitud'
          ? `${ciudadLabel} - ${pub.usuario_nombre || 'Dentista'}`
          : pub.tipo === 'suplencia'
            ? `Suplencia en ${ciudadLabel} - ${nombreClinica}`
            : `${ciudadLabel} - ${nombreClinica}`;
        let tipoBadge, tipoClase;
        if (pub.tipo === "oferta") {
          tipoBadge = "";
          tipoClase = "type-oferta";
        } else if (pub.tipo === "suplencia") {
          tipoBadge = pub.urgente ? "🚨 Urgente" : "🚨 Suplencia";
          tipoClase = "type-suplencia";
        } else {
          // tipo: 'solicitud' (dentistas)
          tipoBadge = "";
          tipoClase = "type-solicitud";
        }

        let interesadosHTML = "";
        // Solo mostrar interesados para solicitudes (dentistas buscando trabajo), no para ofertas (usamos candidaturas)
        if (estadoApp.filtros.soloMias && estadoApp.usuario && pub.usuario_id === estadoApp.usuario.id && pub.tipo === 'solicitud') {
          try {
            const data = await utils.request(`/publicaciones/${pub.id}/candidatos`);
            const interesados = (data.candidatos || []).length;
              interesadosHTML = `
              <button class="btn-interesados" onclick="app.modal.abrirInteresados(${pub.id}, '${pub.tipo}')">
                👥 Clínicas (${interesados})
              </button>
            `;
          } catch (error) {
            console.error("Error al obtener mensajes:", error);
          }
        }

        const esFavorito = misFavoritos.has(pub.id);
        // Badge de compatibilidad: solo llega en el listado ordenado por % (dentista).
        const compatBadge = (pub.compat_porcentaje != null) ? (() => {
          const c = pub.compat_porcentaje >= 80 ? "#16a34a" : pub.compat_porcentaje >= 55 ? "#f59e0b" : "#dc2626";
          return `<span style="background:${c}; color:#fff; border-radius:99px; padding:.15rem .55rem; font-size:.8rem; font-weight:700;" title="Tu compatibilidad con esta publicación">🧩 ${pub.compat_porcentaje}%</span>`;
        })() : "";
        return `
          <div class="card ${tipoClase}">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
              <span style="display: flex; gap: .4rem; align-items: center;">${tipoBadge ? `<span class="card-type ${tipoClase}">${tipoBadge}</span>` : ""}${compatBadge}</span>
              ${estadoApp.usuario && ((estadoApp.tipoUsuario === 'clinica' && pub.tipo === 'solicitud') || (estadoApp.tipoUsuario === 'dentista' && (pub.tipo === 'oferta' || pub.tipo === 'suplencia'))) ? `<button onclick="app.favoritos.toggle(${pub.id}, this)" data-favorito="${esFavorito}" style="background: none; border: none; cursor: pointer; font-size: 1.3rem; padding: 0;" title="${esFavorito ? 'Quitar de favoritos' : 'Guardar en favoritos'}">${esFavorito ? '⭐' : '☆'}</button>` : ''}
            </div>
            <h3>${utils.escapeHtml(generatedTitle)}</h3>
            <div class="card-details">
              <div class="detail">
                <span class="detail-icon">🦷</span>
                <span>${especialidadesText || 'Sin especialidades'}</span>
              </div>
              ${pub.tipo === 'suplencia' && (pub.fecha_desde || pub.fecha_hasta) ? `<div class="detail"><span class="detail-icon">🗓️</span><span>${utils.escapeHtml([pub.fecha_desde, pub.fecha_hasta].filter(Boolean).join(' → '))}</span></div>` : ""}
              ${pub.contrato ? `<div class="detail"><span class="detail-icon">📋</span><span>${utils.escapeHtml(pub.contrato)}</span></div>` : ""}
              ${pub.jornada ? `<div class="detail"><span class="detail-icon">⏰</span><span>${utils.escapeHtml(pub.jornada)}</span></div>` : ""}
              ${pub.salario ? `<div class="detail"><span class="detail-icon">💰</span><span>${utils.escapeHtml(pub.salario)}</span></div>` : ""}
              ${pub.experiencia_minima !== null && pub.experiencia_minima !== undefined ? `<div class="detail"><span class="detail-icon">🎓</span><span>${pub.experiencia_minima} años exp.</span></div>` : ""}
            </div>
            <div class="badges">
              ${pub.nombre_contacto ? `<span class="badge">${utils.escapeHtml(pub.nombre_contacto)}</span>` : ""}
              <span class="badge" style="margin-left: auto;">${utils.formatearFecha(pub.creado_en)}</span>
            </div>
            <div class="card-footer" style="display: flex; gap: 0.5rem;">
              <button class="btn-primary" onclick="app.modal.abrirDetalleConManejo(${JSON.stringify(pub).replace(/"/g, '&quot;')})" style="flex: 1;">Ver Publicación</button>
              ${(() => {
                if (estadoApp.usuario && parseInt(pub.usuario_id) === parseInt(estadoApp.usuario.id)) {
                  return `${(pub.tipo === 'oferta' || pub.tipo === 'suplencia') ? `<button class="btn-outline" onclick="app.publicaciones.copiarEnlacePublico(${pub.id})" style="flex: 1;" title="Copiar el enlace público de esta publicación">🔗 Copiar Enlace</button>` : ''}
                          ${pub.tipo === 'suplencia' ? `<button class="btn-outline" onclick="app.suplencias.verDisponibles(${pub.id}, '${utils.escapeHtml(generatedTitle.replace(/'/g, "\\'"))}')" style="flex: 1;" title="Dentistas disponibles para estos días">🗓️ Disponibles</button>` : ''}
                          <button class="btn-outline" onclick="app.stats.mostrarEstadisticasPublicacion(${pub.id}, '${utils.escapeHtml(generatedTitle.replace(/'/g, "\\'"))}')" style="flex: 1;">📊 Estadísticas</button>
                          <button class="btn-danger" onclick="app.publicaciones.retirarPublicacion(${pub.id})" style="flex: 1;">🗑️ Retirar</button>`;
                }
                return '';
              })()}
              ${(() => {
                if (estadoApp.tipoUsuario === 'dentista' && (pub.tipo === 'oferta' || pub.tipo === 'suplencia')) {
                  const yaPostulada = misPostulaciones.find(p => p.publicacion_id === pub.id);
                  if (yaPostulada) {
                    const estadoText = yaPostulada.estado === 'aceptada' ? 'Aceptada' : 'Pendiente';
                    const estadoColor = yaPostulada.estado === 'aceptada' ? '#10b981' : '#f59e0b';
                    return `<button style="flex: 1; opacity: 0.7; background: ${estadoColor}; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; font-weight: 600; font-size: 0.9rem;">✓ ${estadoText}</button>
                            <button class="btn-danger" onclick="app.candidaturas.retirarPostulacion(${yaPostulada.id})" style="flex: 1;">Retirar</button>`;
                  } else {
                    return `<button class="btn-secondary" onclick="estadoApp.publicacionActual = estadoApp.publicaciones.find(p => p.id === ${pub.id}); app.modal.abrirPostularseModal();" style="flex: 1;">Postularme</button>`;
                  }
                }
                return '';
              })()}
              ${(() => {
                if (estadoApp.tipoUsuario === 'clinica' && pub.tipo === 'solicitud') {
                  const yaPostulada = misPostulaciones.find(p => p.publicacion_id === pub.id);
                  if (yaPostulada) {
                    return `<button class="btn-success" style="flex: 1; opacity: 0.7;">✓ Postulada</button>
                            <button class="btn-danger" onclick="app.candidaturas.retirarPostulacion(${yaPostulada.id})" style="flex: 1;">Retirar</button>`;
                  } else {
                    return `<button class="btn-secondary" onclick="estadoApp.publicacionActual = estadoApp.publicaciones.find(p => p.id === ${pub.id}); app.modal.abrirPostularseModal();" style="flex: 1;">Postularme</button>`;
                  }
                }
                return '';
              })()}
              ${estadoApp.tipoUsuario === 'clinica' && (pub.tipo === 'oferta' || pub.tipo === 'suplencia') && estadoApp.usuario && parseInt(pub.usuario_id) === parseInt(estadoApp.usuario.id) && candidatosPorOferta[pub.id] > 0 ? `<button class="btn-outline" onclick="app.modal.abrirCandidatos(${pub.id}, '${utils.escapeHtml((pub.sede_nombre || pub.ciudad || generatedTitle).replace(/'/g, "\\'"))}')" style="flex: 1;">👥 Dentistas (${candidatosPorOferta[pub.id]})</button>` : ''}
              ${interesadosHTML}
            </div>
          </div>
        `;
      }));

      const botonCargarMas = estadoApp.hayMasPublicaciones
        ? `<div style="text-align: center; margin-top: 2rem;">
             <button class="btn-outline" onclick="app.publicaciones.cargar(${estadoApp.paginaActual + 1})">Cargar más</button>
           </div>`
        : "";

      // En "Mis Publicaciones" de una clínica, separar visualmente Ofertas de Empleo y Suplencia
      let cuerpo;
      if (estadoApp.filtros.soloMias && estadoApp.tipoUsuario === 'clinica') {
        const ofertas = [];
        const suplencias = [];
        estadoApp.publicaciones.forEach((pub, i) => {
          (pub.tipo === 'suplencia' ? suplencias : ofertas).push(html[i]);
        });
        const encabezado = (texto) => `<h3 style="margin: 1.5rem 0 1rem; color: #0f4c75;">${texto}</h3>`;
        cuerpo = "";
        if (ofertas.length) cuerpo += `${encabezado("Ofertas de Empleo")}<div class="publicaciones">${ofertas.join("")}</div>`;
        if (suplencias.length) cuerpo += `${encabezado("Suplencia")}<div class="publicaciones">${suplencias.join("")}</div>`;
      } else {
        cuerpo = `<div class="publicaciones">${html.join("")}</div>`;
      }

      container.innerHTML = `${cuerpo}${botonCargarMas}`;
    }
  },

  // ============================================
  // Módulo: Alertas de búsqueda guardadas
  // ============================================

  alertas: {
    _cache: [],

    // Lee los filtros actuales de la barra de búsqueda
    recogerFiltrosActuales() {
      const get = id => (document.getElementById(id)?.value || "").trim();
      return {
        tipo: estadoApp.filtros.tipo || "",
        q: get("filterQ"),
        ciudad: get("filterCiudad"),
        especialidad: get("filterEspecialidad"),
        contrato: get("filterContrato"),
        jornada: get("filterJornada"),
        equipamiento: get("filterEquipamiento"),
        certificacion: get("filterCertificacion"),
        retribucion: get("filterRetribucion"),
        salarioMin: get("filterSalarioMin"),
        experienciaMin: get("filterExperienciaMin")
      };
    },

    // Texto legible que resume una alerta
    describirFiltros(f) {
      f = f || {};
      const partes = [];
      if (f.tipo) partes.push({ oferta: "Ofertas", solicitud: "Dentistas", suplencia: "Suplencias" }[f.tipo] || f.tipo);
      if (f.ciudad) partes.push("📍 " + f.ciudad);
      if (f.especialidad) {
        const e = (estadoApp.especialidades || []).find(x => String(x.id) === String(f.especialidad));
        partes.push("🦷 " + (e ? e.nombre : f.especialidad));
      }
      if (f.q) partes.push(`“${f.q}”`);
      if (f.contrato) partes.push(f.contrato);
      if (f.jornada) partes.push(f.jornada);
      if (f.salarioMin) partes.push("desde " + f.salarioMin + " €");
      if (f.experienciaMin) partes.push("≥" + f.experienciaMin + " años exp.");
      if (f.equipamiento) partes.push(f.equipamiento);
      if (f.certificacion) partes.push(f.certificacion);
      if (f.retribucion) partes.push(f.retribucion);
      return partes.length ? partes.join(" · ") : "Todas las publicaciones";
    },

    async guardarBusquedaActual() {
      if (!estadoApp.usuario || !estadoApp.token) {
        utils.mostrarAlerta("Inicia sesión para guardar búsquedas y recibir alertas", "info");
        return;
      }
      const filtros = this.recogerFiltrosActuales();
      const reales = Object.entries(filtros).filter(([k, v]) => k !== "tipo" && v && String(v).trim() !== "");
      if (reales.length === 0) {
        utils.mostrarAlerta("Ajusta algún filtro (ciudad, especialidad, salario…) antes de guardar la búsqueda", "info");
        return;
      }
      const nombre = this.describirFiltros(filtros).slice(0, 60);
      try {
        await utils.request("/alertas", {
          method: "POST",
          body: JSON.stringify({ nombre, filtros, frecuencia: "semanal" })
        });
        utils.mostrarAlerta("🔔 Alerta guardada. Te avisaremos por email de las nuevas coincidencias.", "success");
      } catch (e) {
        utils.mostrarAlerta(e.message || "No se pudo guardar la alerta", "error");
      }
    },

    async abrir() {
      if (!estadoApp.usuario || !estadoApp.token) {
        utils.mostrarAlerta("Inicia sesión para ver tus alertas", "info");
        return;
      }
      const body = document.getElementById("alertasBody");
      body.innerHTML = '<p style="color:#6b7280;">Cargando…</p>';
      document.getElementById("modalAlertas").classList.add("active");
      try {
        const data = await utils.request("/alertas");
        this._cache = data.alertas || [];
        body.innerHTML = this.render(this._cache);
      } catch (e) {
        body.innerHTML = `<p style="color:#ef4444;">${utils.escapeHtml(e.message || "Error al cargar las alertas")}</p>`;
      }
    },

    cerrar() {
      const m = document.getElementById("modalAlertas");
      if (m) m.classList.remove("active");
    },

    render(alertas) {
      if (!alertas || alertas.length === 0) {
        return '<p style="color:#6b7280;">Aún no tienes alertas guardadas. Ajusta los filtros de búsqueda y pulsa «🔔 Guardar esta búsqueda».</p>';
      }
      return alertas.map(a => {
        const desc = this.describirFiltros(a.filtros);
        const activa = String(a.activa) === "1";
        const n = a.coincidencias || 0;
        // La tarjeta entera lleva a las coincidencias: es lo que se quiere hacer al
        // mirar una alerta. Los botones paran la propagación para conservar su
        // acción propia (pausar o eliminar no deben además abrir la búsqueda).
        return `
          <div onclick="app.alertas.aplicar(${a.id})" title="Ver las coincidencias de esta alerta" style="border: 1px solid #e5e7eb; border-radius: 10px; padding: 1rem; margin-bottom: 1rem; cursor: pointer; ${activa ? "" : "opacity: 0.6;"}">
            <div style="display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start;">
              <div style="min-width: 0;">
                <strong style="color: #0f4c75;">${utils.escapeHtml(a.nombre || desc)}</strong>
                <p style="margin: 0.25rem 0 0 0; color: #6b7280; font-size: 0.85rem;">${utils.escapeHtml(desc)}</p>
              </div>
              <span title="Coincidencias ahora mismo" style="background: ${n > 0 ? "#10b981" : "#9ca3af"}; color: white; padding: 0.2rem 0.6rem; border-radius: 20px; font-size: 0.8rem; font-weight: 600; white-space: nowrap;">${n} ahora</span>
            </div>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem;">
              <button onclick="event.stopPropagation(); app.alertas.aplicar(${a.id})" style="background: #3b82f6; color: white; border: none; padding: 0.45rem 0.9rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem;">🔎 Ver coincidencias</button>
              <button onclick="event.stopPropagation(); app.alertas.toggleActiva(${a.id}, ${activa ? 0 : 1})" style="background: white; color: #374151; border: 1px solid #d1d5db; padding: 0.45rem 0.9rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem;">${activa ? "⏸️ Pausar" : "▶️ Activar"}</button>
              <button onclick="event.stopPropagation(); app.alertas.eliminar(${a.id})" style="background: white; color: #ef4444; border: 1px solid #fecaca; padding: 0.45rem 0.9rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem;">🗑️ Eliminar</button>
            </div>
          </div>`;
      }).join("");
    },

    aplicar(id) {
      const a = (this._cache || []).find(x => x.id === id);
      if (!a) return;
      const f = a.filtros || {};
      const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val ?? ""; };
      set("filterQ", f.q);
      set("filterCiudad", f.ciudad);
      set("filterEspecialidad", f.especialidad);
      set("filterContrato", f.contrato);
      set("filterJornada", f.jornada);
      set("filterEquipamiento", f.equipamiento);
      set("filterCertificacion", f.certificacion);
      set("filterRetribucion", f.retribucion);
      set("filterSalarioMin", f.salarioMin);
      set("filterExperienciaMin", f.experienciaMin);
      this.cerrar();
      app.publicaciones.cargar();
    },

    async toggleActiva(id, activa) {
      try {
        await utils.request(`/alertas/${id}`, { method: "PUT", body: JSON.stringify({ activa }) });
        this.abrir();
      } catch (e) {
        utils.mostrarAlerta(e.message || "No se pudo actualizar la alerta", "error");
      }
    },

    async eliminar(id) {
      if (!confirm("¿Eliminar esta alerta? Dejarás de recibir avisos de sus coincidencias.")) return;
      try {
        await utils.request(`/alertas/${id}`, { method: "DELETE" });
        utils.mostrarAlerta("Alerta eliminada", "success");
        this.abrir();
      } catch (e) {
        utils.mostrarAlerta(e.message || "No se pudo eliminar la alerta", "error");
      }
    }
  },

  // ============================================
  // Módulo: Favoritos
  // ============================================

  favoritos: {
    async toggle(publicacionId, btn) {
      const esFavorito = btn.dataset.favorito === "true";
      try {
        if (esFavorito) {
          await utils.request(`/favoritos/${publicacionId}`, { method: "DELETE" });
          btn.dataset.favorito = "false";
          btn.textContent = "☆";
          btn.title = "Guardar en favoritos";
        } else {
          await utils.request("/favoritos", {
            method: "POST",
            body: JSON.stringify({ publicacion_id: publicacionId })
          });
          btn.dataset.favorito = "true";
          btn.textContent = "⭐";
          btn.title = "Quitar de favoritos";
        }
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Favorito de un PERFIL (ficha de usuario), distinto de los favoritos de publicaciones
    async togglePerfil(perfilId, btn) {
      const esFavorito = btn.dataset.favorito === "true";
      try {
        if (esFavorito) {
          await utils.request(`/favoritos-perfil/${perfilId}`, { method: "DELETE" });
          btn.dataset.favorito = "false";
          btn.textContent = "☆";
          btn.title = "Guardar en favoritos";
        } else {
          await utils.request("/favoritos-perfil", {
            method: "POST",
            body: JSON.stringify({ perfil_id: perfilId })
          });
          btn.dataset.favorito = "true";
          btn.textContent = "⭐";
          btn.title = "Quitar de favoritos";
        }
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Perfiles (fichas navegables de usuarios)
  // ============================================

  perfiles: {
    async cargar() {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }
      const rol = estadoApp.tipoUsuario === 'clinica' ? 'dentista' : 'clinica';
      const q = document.getElementById("filterQ").value;
      // En "Dentistas" (clínica) la ciudad viene del desplegable; si no se elige
      // ninguna, no se filtra y salen todos, ordenados por ciudad más abajo.
      const ciudad = app.filtros.ciudadSeleccionada();
      const especialidad = document.getElementById("filterEspecialidad").value;
      const radioKm = document.getElementById("filterRadio")?.value || "";

      let url = `/perfiles?rol=${rol}`;
      if (q) url += `&q=${encodeURIComponent(q)}`;
      if (ciudad) url += `&ciudad=${encodeURIComponent(ciudad)}`;
      if (especialidad) url += `&especialidad=${especialidad}`;
      if (radioKm && ciudad) url += `&radioKm=${radioKm}`;

      try {
        const data = await utils.request(url);
        const perfiles = data.perfiles || [];

        // Ordenar por ciudad y, a igualdad de ciudad, por especialidad (la primera del
        // perfil, que ya viene alfabetizada del backend). Los perfiles sin ciudad van al
        // final para no encabezar la lista.
        perfiles.sort((a, b) => {
          const ciudadA = (a.ciudad || "").trim().toLowerCase();
          const ciudadB = (b.ciudad || "").trim().toLowerCase();
          if (ciudadA !== ciudadB) {
            if (!ciudadA) return 1;
            if (!ciudadB) return -1;
            return ciudadA.localeCompare(ciudadB, "es");
          }
          const espA = ((a.especialidades || [])[0] || "").toLowerCase();
          const espB = ((b.especialidades || [])[0] || "").toLowerCase();
          return espA.localeCompare(espB, "es");
        });

        let favSet = new Set();
        try {
          const f = await utils.request("/favoritos-perfil");
          favSet = new Set((f.perfiles || []).map(p => p.id));
        } catch (e) { /* sin favoritos */ }
        this.render(perfiles, favSet);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    render(perfiles, favSet) {
      const container = document.getElementById("publicacionesContainer");
      if (!perfiles.length) {
        container.innerHTML = `<div class="empty-state"><h3>No hay perfiles</h3><p>Prueba a cambiar los filtros.</p></div>`;
        return;
      }
      container.innerHTML = this.tarjetasHtml(perfiles, favSet);
    },

    // Chip de especialidad, con el color del tipo de perfil
    chipEspecialidad(nombre, esClinica) {
      const fondo = esClinica ? "rgba(15,76,117,.1)" : "rgba(46,196,182,.15)";
      const color = esClinica ? "#0f4c75" : "#0f766e";
      return `<span class="badge" style="background:${fondo};color:${color};font-weight:600;">${utils.escapeHtml(nombre)}</span>`;
    },

    // Devuelve el HTML de una rejilla de tarjetas de perfil (reutilizado en la vista de Favoritos)
    tarjetasHtml(perfiles, favSet) {
      return `<div class="publicaciones">` + perfiles.map(p => {
        const esFav = favSet.has(p.id);
        const esClinica = p.tipo === "clinica";
        const ciudadLabel = p.ciudad ? (p.provincia ? `${p.ciudad} (${p.provincia})` : p.ciudad) : "Ubicación no indicada";
        const especialidades = p.especialidades || [];
        // Se muestran TODAS las especialidades juntas (los chips fluyen en la misma
        // fila y saltan solas si no caben), sin recortar con un "+N".
        const chips = especialidades.map(e => this.chipEspecialidad(e, esClinica)).join("");
        return `
          <div class="card ${esClinica ? "type-oferta" : "type-solicitud"}">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
              ${esClinica ? `<span class="card-type type-oferta">🏥 Clínica</span>` : `<span></span>`}
              <button onclick="app.favoritos.togglePerfil(${p.id}, this)" data-favorito="${esFav}" style="background:none;border:none;cursor:pointer;font-size:1.3rem;padding:0;" title="${esFav ? "Quitar de favoritos" : "Guardar en favoritos"}">${esFav ? "⭐" : "☆"}</button>
            </div>
            <h3>${utils.escapeHtml(p.nombre)}</h3>
            <div class="card-details">
              <div class="detail"><span class="detail-icon">📍</span><span>${utils.escapeHtml(ciudadLabel)}</span></div>
              ${p.anyos_experiencia !== null && p.anyos_experiencia !== undefined ? `<div class="detail"><span class="detail-icon">🎓</span><span>${p.anyos_experiencia} años de experiencia</span></div>` : ""}
            </div>
            ${chips
              ? `<div class="badges">${chips}</div>`
              : `<p style="color:#9ca3af;font-size:.85rem;margin:.2rem 0 1rem;">${esClinica ? "Especialidades no indicadas" : "Sin especialidades indicadas"}</p>`}
            ${p.descripcion ? `<p style="color:#6b7280;font-size:.9rem;margin:.2rem 0 1rem;line-height:1.5;">${utils.escapeHtml(p.descripcion.slice(0, 150))}${p.descripcion.length > 150 ? "…" : ""}</p>` : ""}
            <div class="card-footer" style="display:flex;gap:.5rem;">
              <button class="btn-primary" onclick="app.perfiles.verDetalle(${p.id})" style="flex:1;">Ver perfil</button>
              ${estadoApp.tipoUsuario === 'clinica'
                ? `<button class="btn-secondary" onclick="app.perfiles.iniciarChat(${p.id}, '${utils.escapeHtml(p.nombre || "este dentista").replace(/'/g, "\\'")}')" style="flex:1;">💬 Iniciar chat</button>`
                : `<button class="btn-secondary" onclick="app.perfiles.contactar(${p.id}, '${utils.escapeHtml(p.nombre || "este perfil").replace(/'/g, "\\'")}', '${p.tipo}')" style="flex:1;">✉️ Contactar</button>`}
            </div>
          </div>`;
      }).join("") + `</div>`;
    },

    // Abre el modal de contacto con un mensaje editable pre-rellenado, para que
    // el usuario vea y ajuste lo que se enviará antes de pulsar "Enviar".
    contactar(perfilId, perfilNombre, perfilTipo) {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }
      estadoApp.perfilContactoActual = { id: perfilId, nombre: perfilNombre || "este perfil" };

      const titulo = document.getElementById("contactarPerfilTitulo");
      if (titulo) titulo.textContent = `Contactar con ${estadoApp.perfilContactoActual.nombre}`;

      const errorDiv = document.getElementById("contactarPerfilError");
      if (errorDiv) errorDiv.style.display = "none";

      const textarea = document.getElementById("contactarPerfilMensaje");
      if (textarea) {
        // Mensaje por defecto según quién contacta (editable)
        textarea.value = estadoApp.tipoUsuario === "clinica"
          ? `Hola, hemos visto tu perfil en DentalJobs y nos gustaría hablar contigo sobre una posible colaboración.`
          : `Hola, me interesa vuestra clínica y me gustaría poder hablar con vosotros sobre posibles oportunidades.`;
      }

      document.getElementById("modalContactarPerfil").classList.add("active");
      if (textarea) textarea.focus();
    },

    // Chat directo con un dentista: abre el canal (contacto ya aceptado en el backend)
    // y lleva a la conversación, sin pasar por la solicitud de contacto.
    async iniciarChat(perfilId, perfilNombre) {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }
      try {
        await utils.request(`/perfiles/${perfilId}/chat-directo`, { method: "POST" });
        app.modal.cerrarTodosModales();
        document.getElementById("modalChat").classList.add("active");
        await app.chat.abrirConversacion(perfilId, perfilNombre);
        app.chat.iniciarPolling();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    cerrarContactarModal() {
      document.getElementById("modalContactarPerfil").classList.remove("active");
      estadoApp.perfilContactoActual = null;
    },

    async enviarContacto() {
      const perfil = estadoApp.perfilContactoActual;
      if (!perfil) return;

      const errorDiv = document.getElementById("contactarPerfilError");
      const mensaje = (document.getElementById("contactarPerfilMensaje").value || "").trim();
      if (!mensaje) {
        errorDiv.textContent = "Escribe un mensaje antes de enviar.";
        errorDiv.style.display = "block";
        return;
      }

      try {
        await utils.request("/contactos-perfil", {
          method: "POST",
          body: JSON.stringify({ perfil_id: perfil.id, mensaje })
        });
        errorDiv.style.display = "none";
        this.cerrarContactarModal();
        utils.mostrarAlerta("✅ Solicitud de contacto enviada. Podréis chatear cuando la acepten.", "success");
      } catch (error) {
        errorDiv.textContent = error.message || "Error al enviar el contacto";
        errorDiv.style.display = "block";
      }
    },

    // `encima`: la ficha se abre sobre otro modal (la lista de candidatos) y debe verse
    // por delante; al cerrarla se vuelve a esa lista.
    async verDetalle(id, encima = false) {
      try {
        const u = await utils.request(`/usuarios/${id}/publico`);
        const html = u.tipo === "clinica"
          ? await this.fichaClinica(u, id)
          : await this.fichaDentista(u, id);

        document.getElementById("detalleTitle").textContent = u.nombre;
        document.getElementById("detalleBody").innerHTML = html;
        const modal = document.getElementById("modalDetalle");
        modal.classList.toggle("modal-encima", !!encima);
        modal.classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Los archivos del "Book" de un dentista. Las imágenes se ven directamente y el
    // resto (PDF, sobre todo) se descarga. Se abre en el mismo modal de detalle.
    async verBook(id, nombre, encima = false) {
      try {
        const archivos = await utils.request(`/archivos/usuario/${id}`);
        const book = (archivos || []).filter(a => a.tipo === "portfolio");

        let html = `<div class="perfil-dentista"><div class="info-section"><h4>📕 Book</h4>`;
        if (!book.length) {
          html += `<p style="color:#9ca3af;">Este dentista aún no ha subido su Book.</p>`;
        } else {
          const imagenes = book.filter(a => (a.mime_type || "").startsWith("image/"));
          const otros = book.filter(a => !(a.mime_type || "").startsWith("image/"));

          if (imagenes.length) {
            html += `<div class="fotos-gallery">` + imagenes.map(a => `
              <div class="foto-item">
                <a href="${API}/archivos/${a.id}/download" target="_blank" rel="noopener">
                  <img src="${API}/archivos/${a.id}/download" alt="${utils.escapeHtml(a.nombre_archivo)}" loading="lazy">
                </a>
              </div>`).join("") + `</div>`;
          }
          if (otros.length) {
            html += otros.map(a => `
              <div style="display:flex;align-items:center;gap:.6rem;margin-top:.6rem;">
                <a href="${API}/archivos/${a.id}/download" class="btn-primary btn-small" style="text-decoration:none;display:inline-block;">📄 Descargar</a>
                <span style="font-size:.9rem;">${utils.escapeHtml(a.nombre_archivo)}</span>
                <span style="color:#9ca3af;font-size:.85rem;">${a.tamanyo ? utils.formatearTamanyo(a.tamanyo) : ""}</span>
              </div>`).join("");
          }
        }
        html += `</div></div>`;

        document.getElementById("detalleTitle").textContent = `Book de ${nombre || "este dentista"}`;
        document.getElementById("detalleBody").innerHTML = html;
        const modal = document.getElementById("modalDetalle");
        modal.classList.toggle("modal-encima", !!encima);
        modal.classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Formatea un "YYYY-MM" (input tipo month) como "MM/YYYY"; deja el resto tal cual
    formatearMes(valor) {
      if (!valor) return "";
      const m = String(valor).match(/^(\d{4})-(\d{2})/);
      return m ? `${m[2]}/${m[1]}` : String(valor);
    },

    rangoFechas(inicio, fin, actual) {
      const desde = this.formatearMes(inicio);
      const hasta = actual ? "Actualidad" : this.formatearMes(fin);
      if (desde && hasta) return `${desde} — ${hasta}`;
      return desde || hasta || "";
    },

    // Fila de badges de especialidades, o un aviso si no hay
    bloqueEspecialidades(u, esClinica) {
      if (!(u.especialidades || []).length) {
        return `<p style="margin:.3rem 0;color:#9ca3af;">${esClinica ? "Especialidades no indicadas" : "Sin especialidades indicadas"}</p>`;
      }
      return `<div class="badges" style="margin-top:.4rem;">${u.especialidades.map(e => this.chipEspecialidad(e, esClinica)).join("")}</div>`;
    },

    // Ficha pública del dentista: datos personales (profesionales) + trayectoria,
    // en secciones con estilo para que no se vea vacía aunque falten campos.
    async fichaDentista(u, id) {
      let tray = { experiencia: [], formacion: [], idiomas: [], certificaciones: [] };
      try { tray = await utils.request(`/usuarios/${id}/trayectoria`); } catch (e) { /* sin trayectoria */ }
      const resumen = await app.resenyas.cargarResumen(id);
      // El CV que el dentista tenga subido en su perfil ("Mi CV")
      let cv = null;
      try {
        const archivos = await utils.request(`/archivos/usuario/${id}`);
        cv = (archivos || []).find(a => a.tipo === "cv") || null;
      } catch (e) { /* sin archivos */ }

      const ciudadLabel = u.ciudad ? (u.provincia ? `${u.ciudad} (${u.provincia})` : u.ciudad) : "No indicada";

      let html = `<div class="perfil-dentista">`;

      // Apartado "Mis datos": los mismos datos que el dentista rellena en esa pestaña
      // (ubicación, experiencia, valoración, especialidades y descripción).
      html += `<div class="info-section"><h4>📋 Mis datos</h4>
        <p style="margin:.3rem 0;font-size:1.05rem;"><span class="detail-icon">👨‍⚕️</span> Dentista · <strong>${utils.escapeHtml(ciudadLabel)}</strong></p>
        ${u.anyos_experiencia !== null && u.anyos_experiencia !== undefined ? `<p style="margin:.3rem 0;">🎓 <strong>${u.anyos_experiencia}</strong> años de experiencia</p>` : ""}
        <div style="margin:.3rem 0;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;"><span>⭐</span>${app.resenyas.resumenHtml(resumen, id, u.nombre)}</div>
        <p style="margin:.6rem 0 .2rem;font-weight:600;color:#0f4c75;">Especialidades</p>
        ${this.bloqueEspecialidades(u, false)}
        <p style="margin:.7rem 0 .2rem;font-weight:600;color:#0f4c75;">Sobre mí</p>
        <p style="margin:.2rem 0;">${u.descripcion ? utils.escapeHtml(u.descripcion) : `<span style="color:#9ca3af;">Este dentista aún no ha añadido una descripción.</span>`}</p>
        <p style="margin:.7rem 0 0;color:#9ca3af;font-size:.85rem;">En DentalJobs desde ${utils.formatearFecha(u.creado_en)}</p>
      </div>`;

      // Apartado "Trayectoria": experiencia, formación, idiomas y certificaciones,
      // como sub-bloques dentro de una única sección.
      const hayTray = (tray.experiencia || []).length || (tray.formacion || []).length || (tray.idiomas || []).length || (tray.certificaciones || []).length;
      html += `<div class="info-section"><h4>🧭 Trayectoria</h4>`;
      if (!hayTray) {
        html += `<p style="color:#9ca3af;">Este dentista aún no ha añadido experiencia, formación ni idiomas.</p>`;
      } else {
        if ((tray.experiencia || []).length) {
          html += `<h5 style="margin:.8rem 0 .3rem;color:#0f4c75;">💼 Experiencia</h5>` +
            tray.experiencia.map(e => {
              const fechas = this.rangoFechas(e.fecha_inicio, e.fecha_fin, e.actual);
              return `<div style="margin-bottom:.7rem;"><strong>${utils.escapeHtml(e.especialidad || "")}</strong>${e.lugar ? " · " + utils.escapeHtml(e.lugar) : ""}${fechas ? `<div style="color:#6b7280;font-size:.85rem;">${fechas}</div>` : ""}${e.descripcion ? `<div style="color:#4b5563;font-size:.9rem;margin-top:.15rem;">${utils.escapeHtml(e.descripcion)}</div>` : ""}</div>`;
            }).join("");
        }
        if ((tray.formacion || []).length) {
          html += `<h5 style="margin:.8rem 0 .3rem;color:#0f4c75;">🎓 Formación</h5>` +
            tray.formacion.map(f => `<div style="margin-bottom:.3rem;">${utils.escapeHtml([f.titulo, f.centro].filter(Boolean).join(" · ") + (f.anyo ? ` (${f.anyo})` : ""))}</div>`).join("");
        }
        if ((tray.idiomas || []).length) {
          html += `<h5 style="margin:.8rem 0 .3rem;color:#0f4c75;">🌐 Idiomas</h5><div class="badges">` +
            tray.idiomas.map(i => `<span class="badge">${utils.escapeHtml(i.idioma)} · ${utils.escapeHtml(i.nivel)}</span>`).join("") + `</div>`;
        }
        if ((tray.certificaciones || []).length) {
          html += `<h5 style="margin:.8rem 0 .3rem;color:#0f4c75;">📜 Certificaciones</h5><div class="badges">` +
            tray.certificaciones.map(c => `<span class="badge">${utils.escapeHtml(c)}</span>`).join("") + `</div>`;
        }
      }
      html += `</div>`;

      // El CV cierra la ficha: es lo último que se mira y lo que uno se lleva. Sin
      // rótulo, el propio botón dice lo que hace.
      html += `<div class="info-section">
        ${cv
          ? `<a href="${API}/archivos/${cv.id}/download" class="btn-primary" style="text-decoration:none;display:inline-block;">📄 Descargar CV</a>
             <span style="color:#9ca3af;font-size:.85rem;margin-left:.5rem;">${utils.escapeHtml(cv.nombre_archivo)}${cv.tamanyo ? " · " + utils.formatearTamanyo(cv.tamanyo) : ""}</span>`
          : `<p style="margin:0;color:#9ca3af;">Este dentista aún no ha subido su CV.</p>`}
      </div>`;

      html += `</div>`;
      return html;
    },

    // Ficha pública de la clínica: sus datos (sin duplicar los que ya están en la
    // Sede) más valoraciones, fotos y la Sede completa, en secciones con estilo.
    async fichaClinica(u, id) {
      const sedes = u.sedes || [];
      const ciudadLabel = u.ciudad ? (u.provincia ? `${u.ciudad} (${u.provincia})` : u.ciudad) : "";
      const resumen = await app.resenyas.cargarResumen(id);
      let fotos = [];
      try {
        const archivos = await utils.request(`/archivos/usuario/${id}`);
        fotos = (archivos || []).filter(a => a.tipo === "foto");
      } catch (e) { /* sin fotos */ }

      let html = `<div class="perfil-dentista">`;
      html += `<div class="info-section">
        <p style="margin:.3rem 0;font-size:1.05rem;"><span class="detail-icon">🏥</span> Clínica${!sedes.length && ciudadLabel ? ` · <strong>${utils.escapeHtml(ciudadLabel)}</strong>` : ""}</p>
        <div style="margin:.3rem 0;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;"><span>⭐</span>${app.resenyas.resumenHtml(resumen, id, u.nombre)}</div>
        <p style="margin:.6rem 0 .2rem;font-weight:600;color:#0f4c75;">Especialidades</p>
        ${this.bloqueEspecialidades(u, true)}
        <p style="margin:.7rem 0 0;color:#9ca3af;font-size:.85rem;">En DentalJobs desde ${utils.formatearFecha(u.creado_en)}</p>
      </div>`;

      html += `<div class="info-section"><h4>Sobre la clínica</h4><p>${u.descripcion ? utils.escapeHtml(u.descripcion) : `<span style="color:#9ca3af;">Esta clínica aún no ha añadido una descripción.</span>`}</p></div>`;

      if (fotos.length) {
        html += `<div class="info-section"><h4>📷 Fotos de la clínica</h4>
          <div class="fotos-gallery">${fotos.map(f => `<div class="foto-item"><img src="${API}/archivos/${f.id}/download" alt="Foto de la clínica" loading="lazy"></div>`).join("")}</div>
        </div>`;
      }

      // El equipamiento es de la clínica entera, así que se muestra una sola vez y
      // no repetido en cada sede
      if ((u.equipamiento || []).length) {
        html += `<div class="info-section"><h4>🦷 Equipamiento</h4>
          <div class="badges">${u.equipamiento.map(e => `<span class="badge">${utils.escapeHtml(e)}</span>`).join("")}</div>
        </div>`;
      }

      if (sedes.length) {
        html += `<div class="info-section"><h4>📍 ${sedes.length > 1 ? `Sedes (${sedes.length})` : "Sede"}</h4>`;
        html += sedes.map(s => {
          const cpCiudad = [s.codigo_postal, s.ciudad].filter(Boolean).join(" ");
          const localizacion = [cpCiudad, s.provincia].filter(Boolean).join(", ");
          const lineas = [];
          if (s.direccion) lineas.push(`📍 ${utils.escapeHtml(s.direccion)}`);
          if (localizacion) lineas.push(utils.escapeHtml(localizacion));
          if (s.telefono) lineas.push(`📞 ${utils.escapeHtml(s.telefono)}`);
          return `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:.9rem 1rem;margin-bottom:.6rem;">
                    <strong>${utils.escapeHtml(s.nombre || s.ciudad)}</strong>
                    ${lineas.length ? `<div style="color:#4b5563;margin-top:.2rem;line-height:1.6;">${lineas.join("<br>")}</div>` : ""}
                  </div>`;
        }).join("");
        html += `</div>`;
      } else {
        html += `<div class="info-section"><p style="color:#9ca3af;">Esta clínica aún no ha publicado sus sedes.</p></div>`;
      }
      html += `</div>`;
      return html;
    }
  },

  // ============================================
  // Módulo: Exportar datos
  // ============================================

  exportar: {
    // Vistas exportables. `conFiltros` indica si envían los filtros del listado (las
    // "mías" y las de seguimiento se muestran sin filtros, así que tampoco los envían).
    // `etiqueta` describe lo que exporta el botón; puede depender del tipo de usuario.
    VISTAS: {
      "publicaciones": {
        conFiltros: true,
        etiqueta: () => (estadoApp.tipoUsuario === "clinica" ? "Publicaciones de dentistas" : "Publicaciones de clínicas")
      },
      "perfiles": {
        conFiltros: true,
        etiqueta: () => (estadoApp.tipoUsuario === "clinica" ? "Dentistas" : "Perfiles de clínicas")
      },
      "suplencias": { conFiltros: true, etiqueta: () => "Suplencias" },
      "mis-publicaciones": { conFiltros: false, etiqueta: () => "Mis Publicaciones" },
      "favoritos": { conFiltros: false, etiqueta: () => "Favoritos" },
      "mis-postulaciones": { conFiltros: false, etiqueta: () => "Mis Postulaciones" }
    },

    // Muestra u oculta el botón de exportar según la vista visible y ajusta su texto
    // para dejar claro qué se va a descargar.
    actualizarBoton() {
      const btn = document.getElementById("btnExportarCsv");
      if (!btn) return;
      const config = this.VISTAS[estadoApp.vistaActual];
      btn.style.display = config ? "inline-block" : "none";
      if (config) btn.textContent = `⬇️ Exportar «${config.etiqueta()}» a CSV`;
    },

    // Reúne los filtros del listado tal como los envía app.publicaciones.cargar(), para
    // que el CSV traiga exactamente las filas que se están viendo.
    filtrosQuery() {
      const params = new URLSearchParams();
      // En las búsquedas reducidas la ciudad sale del desplegable, no del campo de texto
      const idCiudad = app.filtros.vistaReducida() ? "filterCiudadLista" : "filterCiudad";
      const campos = {
        q: "filterQ", ciudad: idCiudad, especialidad: "filterEspecialidad",
        contrato: "filterContrato", jornada: "filterJornada", equipamiento: "filterEquipamiento",
        certificacion: "filterCertificacion", retribucion: "filterRetribucion",
        salarioMin: "filterSalarioMin", experienciaMin: "filterExperienciaMin"
      };
      for (const [clave, id] of Object.entries(campos)) {
        const el = document.getElementById(id);
        if (el && el.value) params.set(clave, el.value);
      }
      // El radio solo tiene sentido acompañando a una ciudad
      const radio = document.getElementById("filterRadio")?.value || "";
      if (radio && params.get("ciudad")) params.set("radioKm", radio);
      return params;
    },

    // Descarga el CSV de la vista actualmente visible
    async vistaActual() {
      const vista = estadoApp.vistaActual;
      const config = this.VISTAS[vista];
      if (!config) return;

      const params = config.conFiltros ? this.filtrosQuery() : new URLSearchParams();
      const cadena = params.toString();
      const url = `${API}/exportar/${vista}.csv${cadena ? `?${cadena}` : ""}`;

      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${estadoApp.token}` }
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Error al exportar");
        }

        const blob = await response.blob();
        const objUrl = URL.createObjectURL(blob);
        const enlace = document.createElement("a");
        enlace.href = objUrl;
        enlace.download = `${vista}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        URL.revokeObjectURL(objUrl);
        utils.mostrarAlerta("✅ CSV descargado", "success");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Kanban de postulaciones
  // ============================================

  kanban: {
    async render() {
      const container = document.getElementById("publicacionesContainer");

      try {
        const data = await utils.request("/candidaturas/mis-postulaciones");
        const candidaturas = data.candidaturas || [];

        if (candidaturas.length === 0) {
          container.innerHTML = `
            <div class="empty-state">
              <h3>No tienes postulaciones</h3>
              <p>Cuando te postules a una publicación aparecerá aquí su seguimiento.</p>
            </div>
          `;
          return;
        }

        const columnas = [
          { estado: 'pendiente', titulo: '⏳ Pendientes', color: '#f59e0b' },
          { estado: 'vista', titulo: '👁️ CV visto', color: '#6366f1' },
          { estado: 'en_proceso', titulo: '🔄 En proceso', color: '#0ea5e9' },
          { estado: 'entrevista', titulo: '🗓️ Entrevista', color: '#8b5cf6' },
          { estado: 'aceptada', titulo: '✅ Aceptadas', color: '#10b981' },
          { estado: 'rechazada', titulo: '❌ Rechazadas', color: '#ef4444' }
        ];

        container.innerHTML = `
          <div class="kanban-board">
            ${columnas.map(col => {
              const items = candidaturas.filter(c => c.estado === col.estado);
              return `
                <div class="kanban-col">
                  <div class="kanban-col-header" style="border-top: 4px solid ${col.color};">
                    <span>${col.titulo}</span>
                    <span class="kanban-col-contador" style="background: ${col.color};">${items.length}</span>
                  </div>
                  <div class="kanban-col-body">
                    ${items.length === 0
                      ? `<p class="kanban-vacio">Nada por aquí</p>`
                      : items.map(c => this.tarjetaHtml(c, col.color)).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    tarjetaHtml(c, color) {
      const destinatario = c.publicacion_tipo === 'oferta' ? 'clínica' : 'dentista';
      return `
        <div class="kanban-tarjeta" style="border-left: 3px solid ${color};">
          <strong>${utils.escapeHtml(c.empresa_nombre || 'Publicación')}</strong>
          <p class="kanban-tarjeta-detalle">📍 ${utils.escapeHtml(c.ciudad || '')}</p>
          ${c.salario ? `<p class="kanban-tarjeta-detalle">💰 ${utils.escapeHtml(c.salario)}</p>` : ''}
          ${c.contrato || c.jornada ? `<p class="kanban-tarjeta-detalle">📋 ${utils.escapeHtml([c.contrato, c.jornada].filter(Boolean).join(' · '))}</p>` : ''}
          <p class="kanban-tarjeta-fecha">Postulada el ${utils.formatearFecha(c.creado_en)}</p>
          <div class="kanban-tarjeta-acciones">
            ${c.estado === 'aceptada' ? `<button class="btn-small" style="background: #f59e0b; color: white; border: none; border-radius: 4px; padding: 0.35rem 0.7rem; cursor: pointer;" onclick="app.resenyas.abrirFormulario(${c.id}, '${(c.empresa_nombre || `la ${destinatario}`).replace(/'/g, "\\'")}')">⭐ Valorar</button>` : ''}
            <button class="btn-small" style="background: #ef4444; color: white; border: none; border-radius: 4px; padding: 0.35rem 0.7rem; cursor: pointer;" onclick="app.candidaturas.retirarPostulacion(${c.id})">🗑️ Retirar</button>
          </div>
        </div>
      `;
    }
  },

  // ============================================
  // Módulo: Trayectoria profesional
  // ============================================

  trayectoria: {
    async cargar() {
      if (!estadoApp.usuario) return;
      try {
        await this.cargarEspecialidades();
        const data = await utils.request(`/usuarios/${estadoApp.usuario.id}/trayectoria`);
        this.renderExperiencia(data.experiencia || []);
        this.renderFormacion(data.formacion || []);
        this.renderIdiomas(data.idiomas || []);
      } catch (error) {
        console.error("Error al cargar trayectoria:", error);
      }
    },

    // Rellena el desplegable de especialidad del formulario de experiencia con el
    // catálogo. Se conserva la opción vacía inicial (especialidad opcional).
    async cargarEspecialidades() {
      const select = document.getElementById("expEspecialidad");
      if (!select || select.dataset.cargado) return;
      const especialidades = await utils.requestOpcional("/especialidades");
      (especialidades || []).forEach(e => {
        const opt = document.createElement("option");
        opt.value = e.nombre;
        opt.textContent = e.nombre;
        select.appendChild(opt);
      });
      select.dataset.cargado = "1";
    },

    formatearRango(inicio, fin, actual) {
      const partes = [inicio, actual ? "Actualidad" : fin].filter(Boolean);
      return partes.join(" – ");
    },

    renderExperiencia(lista) {
      const contenedor = document.getElementById("trayectoriaExperienciaLista");
      if (!contenedor) return;
      if (lista.length === 0) {
        contenedor.innerHTML = `<p style="color: #9ca3af; font-size: 0.9rem;">Aún no has añadido experiencia laboral.</p>`;
        return;
      }
      contenedor.innerHTML = lista.map(e => `
        <div style="background: #f8faff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; gap: 1rem;">
          <div>
            <strong style="color: #0f4c75;">${utils.escapeHtml(e.especialidad || "")}</strong>${e.lugar ? ` · ${utils.escapeHtml(e.lugar)}` : ''}
            <p style="margin: 0.2rem 0; font-size: 0.85rem; color: #6b7280;">${utils.escapeHtml(this.formatearRango(e.fecha_inicio, e.fecha_fin, e.actual))}</p>
            ${e.descripcion ? `<p style="margin: 0.3rem 0 0 0; font-size: 0.9rem; color: #374151; white-space: pre-wrap;">${utils.escapeHtml(e.descripcion)}</p>` : ''}
          </div>
          <button class="btn-text btn-small" onclick="app.trayectoria.eliminarExperiencia(${e.id})" style="white-space: nowrap;">Eliminar</button>
        </div>
      `).join('');
    },

    renderFormacion(lista) {
      const contenedor = document.getElementById("trayectoriaFormacionLista");
      if (!contenedor) return;
      if (lista.length === 0) {
        contenedor.innerHTML = `<p style="color: #9ca3af; font-size: 0.9rem;">Aún no has añadido formación.</p>`;
        return;
      }
      contenedor.innerHTML = lista.map(f => `
        <div style="background: #f8faff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; gap: 1rem;">
          <div>
            <strong style="color: #0f4c75;">${utils.escapeHtml(f.titulo)}</strong>
            <p style="margin: 0.2rem 0; font-size: 0.85rem; color: #6b7280;">${[f.centro, f.anyo].filter(Boolean).map(x => utils.escapeHtml(x)).join(' · ')}</p>
          </div>
          <button class="btn-text btn-small" onclick="app.trayectoria.eliminarFormacion(${f.id})" style="white-space: nowrap;">Eliminar</button>
        </div>
      `).join('');
    },

    renderIdiomas(lista) {
      const contenedor = document.getElementById("trayectoriaIdiomasLista");
      if (!contenedor) return;
      if (lista.length === 0) {
        contenedor.innerHTML = `<p style="color: #9ca3af; font-size: 0.9rem;">Aún no has añadido idiomas.</p>`;
        return;
      }
      contenedor.innerHTML = `<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">` + lista.map(i => `
        <span style="background: #eef2ff; color: #3730a3; padding: 0.4rem 0.8rem; border-radius: 999px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 0.5rem;">
          ${utils.escapeHtml(i.idioma)} · ${utils.escapeHtml(i.nivel)}
          <button onclick="app.trayectoria.eliminarIdioma(${i.id})" style="background: none; border: none; cursor: pointer; color: #6366f1; font-weight: bold; padding: 0;">✕</button>
        </span>
      `).join('') + `</div>`;
    },

    async crearExperiencia() {
      const especialidad = document.getElementById("expEspecialidad").value;
      if (!especialidad) {
        utils.mostrarAlerta("Elige una especialidad", "error");
        return;
      }
      const datos = {
        especialidad,
        lugar: document.getElementById("expLugar").value || null,
        fecha_inicio: document.getElementById("expInicio").value || null,
        fecha_fin: document.getElementById("expFin").value || null,
        actual: document.getElementById("expActual").checked
      };
      datos.descripcion = document.getElementById("expDescripcion").value || null;

      try {
        await utils.request("/experiencia-laboral", { method: "POST", body: JSON.stringify(datos) });
        ["expEspecialidad", "expLugar", "expInicio", "expFin", "expDescripcion"].forEach(id => document.getElementById(id).value = "");
        document.getElementById("expActual").checked = false;
        document.getElementById("expFin").disabled = false;
        utils.mostrarAlerta("✅ Experiencia añadida", "success");
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async eliminarExperiencia(id) {
      if (!confirm("¿Eliminar esta experiencia?")) return;
      try {
        await utils.request(`/experiencia-laboral/${id}`, { method: "DELETE" });
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async crearFormacion() {
      const datos = {
        titulo: document.getElementById("formTitulo").value,
        centro: document.getElementById("formCentro").value || null,
        anyo: document.getElementById("formAnyo").value || null
      };
      try {
        await utils.request("/formacion", { method: "POST", body: JSON.stringify(datos) });
        ["formTitulo", "formCentro", "formAnyo"].forEach(id => document.getElementById(id).value = "");
        utils.mostrarAlerta("✅ Formación añadida", "success");
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async eliminarFormacion(id) {
      if (!confirm("¿Eliminar esta formación?")) return;
      try {
        await utils.request(`/formacion/${id}`, { method: "DELETE" });
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async crearIdioma() {
      const datos = {
        idioma: document.getElementById("idiomaNombre").value,
        nivel: document.getElementById("idiomaNivel").value
      };
      try {
        await utils.request("/idiomas", { method: "POST", body: JSON.stringify(datos) });
        document.getElementById("idiomaNombre").value = "";
        document.getElementById("idiomaNivel").value = "";
        utils.mostrarAlerta("✅ Idioma añadido", "success");
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async eliminarIdioma(id) {
      try {
        await utils.request(`/idiomas/${id}`, { method: "DELETE" });
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Sedes
  // ============================================

  sedes: {
    lista: [],

    async cargar() {
      try {
        const data = await utils.request("/sedes");
        this.lista = data.sedes || [];
        this.renderLista();
        this.prepararFormulario();
      } catch (error) {
        console.error("Error al cargar sedes:", error);
      }
    },

    // Prepara el formulario de "Añadir sede": checkboxes de equipamiento + autocompletado de ciudad
    async prepararFormulario() {
      try { await app.catalogos.cargar(); } catch (e) { /* el catálogo ya puede estar cargado */ }
      app.ciudades.montar(
        document.getElementById("sedeCiudad"),
        document.getElementById("sedeProvincia"),
        document.getElementById("sedeProvinciaLabel")
      );
    },

    renderLista() {
      const contenedor = document.getElementById("sedesLista");
      if (!contenedor) return;

      if (this.lista.length === 0) {
        contenedor.innerHTML = `<p style="color: #9ca3af; text-align: center;">Aún no has añadido ningún centro.</p>`;
        return;
      }

      contenedor.innerHTML = this.lista.map(s => {
        const ciudadLabel = s.provincia ? `${s.ciudad} (${s.provincia})` : s.ciudad;
        // El nombre es opcional: sin él, el centro se identifica por su ciudad, y
        // entonces no se repite abajo (quedaría "🏥 Manresa / 📍 Manresa").
        const detalle = [
          s.nombre ? utils.escapeHtml(ciudadLabel) : "",
          s.direccion ? utils.escapeHtml(s.direccion) : ""
        ].filter(Boolean).join(" · ");
        const linea = `${detalle}${s.codigo_postal ? ` (${utils.escapeHtml(s.codigo_postal)})` : ""}`.trim();
        return `
        <div style="background: #f8faff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
          <div>
            <strong style="color: #0f4c75;">🏥 ${utils.escapeHtml(s.nombre || ciudadLabel)}</strong>
            ${linea ? `<p style="margin: 0.2rem 0 0 0; font-size: 0.9rem; color: #6b7280;">📍 ${linea}</p>` : ''}
            ${s.telefono ? `<p style="margin: 0.2rem 0 0 0; font-size: 0.9rem; color: #6b7280;">📞 ${utils.escapeHtml(s.telefono)}</p>` : ''}
          </div>
          <button class="btn-outline btn-small" onclick="app.sedes.eliminar(${s.id})">Eliminar</button>
        </div>
      `;
      }).join('');
    },

    async crear() {
      const datos = {
        nombre: document.getElementById("sedeNombre").value,
        ciudad: document.getElementById("sedeCiudad").value,
        provincia: document.getElementById("sedeProvincia").value || null,
        direccion: document.getElementById("sedeDireccion").value || null,
        codigo_postal: document.getElementById("sedeCodigoPostal").value || null,
        telefono: document.getElementById("sedeTelefono").value || null
      };

      try {
        await utils.request("/sedes", {
          method: "POST",
          body: JSON.stringify(datos)
        });
        utils.mostrarAlerta("✅ Sede añadida", "success");
        ["sedeNombre", "sedeCiudad", "sedeProvincia", "sedeDireccion", "sedeCodigoPostal", "sedeTelefono"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        const lbl = document.getElementById("sedeProvinciaLabel");
        if (lbl) lbl.textContent = "";
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async eliminar(id) {
      if (!confirm("¿Eliminar esta sede? Sus publicaciones seguirán activas, pero sin sede asociada.")) return;
      try {
        await utils.request(`/sedes/${id}`, { method: "DELETE" });
        utils.mostrarAlerta("Centro eliminado", "success");
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Rellena el selector de UBICACIÓN del formulario de oferta/suplencia. La ciudad
    // solo puede ser la principal de la clínica (la del perfil) o la de uno de sus
    // centros; nada de texto libre. De ahí se heredan ciudad, provincia y teléfono.
    // prefijo: 'oferta' o 'suplencia' (ambas comparten el mismo patrón de ids)
    async cargarEnSelector(prefijo = 'oferta') {
      const grupo = document.getElementById(`${prefijo}SedeGroup`);
      const select = document.getElementById(`${prefijo}Sede`);
      if (!grupo || !select) return;

      grupo.style.display = "block";
      const aviso = document.getElementById(`${prefijo}SinSedes`);
      const submitBtn = document.querySelector(`#tab-${prefijo} button[type="submit"]`);
      const preview = document.getElementById(`${prefijo}SedePreview`);

      // La empresa y el email de contacto salen del perfil (constantes, no dependen de la ubicación)
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
      setVal(`${prefijo}NombreContacto`, estadoApp.usuario?.nombre || "");
      setVal(`${prefijo}EmailContacto`, estadoApp.usuario?.email || "");

      try {
        const [perfil, data] = await Promise.all([
          utils.requestOpcional("/auth/mi-perfil"),
          utils.request("/sedes")
        ]);
        this.lista = data.sedes || [];
        this.perfilPublicar = perfil || {};

        // "Principal" = la ciudad del perfil de la clínica; solo se ofrece si existe
        const opciones = [];
        if (perfil && perfil.ciudad) {
          const label = perfil.provincia ? `${perfil.ciudad} (${perfil.provincia})` : perfil.ciudad;
          opciones.push(`<option value="principal">Principal · ${utils.escapeHtml(label)}</option>`);
        }
        this.lista.forEach(s => {
          opciones.push(`<option value="${s.id}">${utils.escapeHtml(s.nombre ? `${s.nombre} · ${s.ciudad}` : s.ciudad)}</option>`);
        });

        // Sin ciudad en el perfil y sin centros: no hay ninguna ubicación posible
        if (opciones.length === 0) {
          select.innerHTML = `<option value="">— Sin ubicación —</option>`;
          if (aviso) aviso.style.display = "block";
          if (submitBtn) submitBtn.disabled = true;
          if (preview) preview.innerHTML = "";
          return;
        }

        if (aviso) aviso.style.display = "none";
        if (submitBtn) submitBtn.disabled = false;
        select.innerHTML = `<option value="">Elige una ubicación…</option>` + opciones.join('');
        if (preview) preview.innerHTML = "";
      } catch (error) {
        console.error("Error al cargar ubicaciones:", error);
        grupo.style.display = "none";
      }
    },

    // Al elegir la ubicación, rellenar (solo lectura) ciudad y teléfono, y mostrar
    // una vista previa. La ubicación es "principal" (ciudad del perfil) o un centro.
    async aplicarAPublicacion(prefijo = 'oferta') {
      const val = document.getElementById(`${prefijo}Sede`).value;
      const preview = document.getElementById(`${prefijo}SedePreview`);
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
      const empresa = estadoApp.usuario?.nombre || "";

      if (!val) {
        setVal(`${prefijo}Ciudad`, "");
        setVal(`${prefijo}TelefonoContacto`, "");
        if (preview) preview.innerHTML = "";
        return;
      }

      // Datos según sea la principal (perfil) o un centro concreto
      let ciudadLabel, telefono, direccion = null;
      if (val === "principal") {
        const p = this.perfilPublicar || {};
        ciudadLabel = p.provincia ? `${p.ciudad} (${p.provincia})` : (p.ciudad || "");
        telefono = p.telefono || p.movil || "";
      } else {
        const sede = this.lista.find(s => String(s.id) === val);
        if (!sede) { if (preview) preview.innerHTML = ""; return; }
        ciudadLabel = sede.provincia ? `${sede.ciudad} (${sede.provincia})` : sede.ciudad;
        telefono = sede.telefono || "";
        direccion = sede.direccion || null;
      }

      setVal(`${prefijo}Ciudad`, ciudadLabel);
      setVal(`${prefijo}TelefonoContacto`, telefono);

      const equipos = await app.catalogos.cargarEquipamientoClinica();
      if (preview) {
        preview.innerHTML = `
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:.75rem 1rem;font-size:.88rem;color:#0c4a6e;">
            <div><strong>Empresa:</strong> ${utils.escapeHtml(empresa)}</div>
            <div><strong>Ciudad:</strong> ${utils.escapeHtml(ciudadLabel)}</div>
            ${direccion ? `<div><strong>Dirección:</strong> ${utils.escapeHtml(direccion)}</div>` : ""}
            ${telefono ? `<div><strong>Teléfono:</strong> ${utils.escapeHtml(telefono)}</div>` : ""}
            <div><strong>Equipamiento:</strong> ${equipos.length ? equipos.map(utils.escapeHtml).join(", ") : "ninguno"}</div>
            <div style="margin-top:.3rem;color:#0369a1;">Estos datos se toman de la ubicación y de tu perfil; no son editables aquí.</div>
          </div>`;
      }
    }
  },

  // ============================================
  // Módulo: Plantillas de publicación
  // ============================================

  plantillas: {
    lista: [],

    // Ids de los campos del formulario según el tipo de publicación
    camposDe(tipo) {
      return {
        ciudad: `${tipo}Ciudad`,
        contrato: `${tipo}Contrato`,
        jornada: `${tipo}Jornada`,
        salario: null, // el salario de oferta ahora son dos campos numéricos; la plantilla no lo rellena
        experiencia: `${tipo}Experiencia`,
        descripcion: `${tipo}Descripcion`,
        nombre_contacto: `${tipo}NombreContacto`,
        email_contacto: `${tipo}EmailContacto`,
        telefono_contacto: `${tipo}TelefonoContacto`
      };
    },

    async cargar(tipo) {
      try {
        const data = await utils.request("/plantillas");
        this.lista = data.plantillas || [];

        const select = document.getElementById(`${tipo}Plantillas`);
        if (!select) return;

        const propias = this.lista.filter(p => p.tipo === tipo);
        select.innerHTML = `<option value="">Sin plantilla…</option>` +
          propias.map(p => `<option value="${p.id}">${utils.escapeHtml(p.nombre)}</option>`).join('');
      } catch (error) {
        console.error("Error al cargar plantillas:", error);
      }
    },

    aplicar(tipo) {
      const select = document.getElementById(`${tipo}Plantillas`);
      const plantilla = this.lista.find(p => p.id === parseInt(select.value));
      if (!plantilla) return;

      const campos = this.camposDe(tipo);
      Object.entries(campos).forEach(([campo, elementId]) => {
        if (!elementId) return;
        const el = document.getElementById(elementId);
        if (el) el.value = plantilla[campo] ?? '';
      });

      // Marcar especialidades de la plantilla
      const checkboxes = document.querySelectorAll(`#${tipo}EspecialidadesContainer input[type="checkbox"]`);
      checkboxes.forEach(cb => {
        cb.checked = (plantilla.especialidades || []).includes(parseInt(cb.value));
      });

      utils.mostrarAlerta(`Plantilla "${plantilla.nombre}" aplicada`, "info");
    },

    async guardar(tipo) {
      const nombre = prompt("Nombre de la plantilla (ej: 'Oferta ortodoncia Barcelona'):");
      if (!nombre || !nombre.trim()) return;

      const campos = this.camposDe(tipo);
      const datos = { nombre: nombre.trim(), tipo };
      Object.entries(campos).forEach(([campo, elementId]) => {
        if (!elementId) return;
        const el = document.getElementById(elementId);
        datos[campo] = el ? el.value || null : null;
      });

      datos.especialidades = Array.from(
        document.querySelectorAll(`#${tipo}EspecialidadesContainer input[type="checkbox"]:checked`)
      ).map(cb => parseInt(cb.value));

      try {
        await utils.request("/plantillas", {
          method: "POST",
          body: JSON.stringify(datos)
        });
        utils.mostrarAlerta("✅ Plantilla guardada", "success");
        await this.cargar(tipo);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async eliminar(tipo) {
      const select = document.getElementById(`${tipo}Plantillas`);
      const plantilla = this.lista.find(p => p.id === parseInt(select.value));
      if (!plantilla) {
        utils.mostrarAlerta("Selecciona primero la plantilla que quieres eliminar", "info");
        return;
      }
      if (!confirm(`¿Eliminar la plantilla "${plantilla.nombre}"?`)) return;

      try {
        await utils.request(`/plantillas/${plantilla.id}`, { method: "DELETE" });
        utils.mostrarAlerta("Plantilla eliminada", "success");
        await this.cargar(tipo);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Reseñas
  // ============================================

  resenyas: {
    candidaturaActual: null,
    puntuacionSeleccionada: 0,

    estrellasHtml(media) {
      if (media === null || media === undefined) return '';
      const llenas = Math.round(media);
      return '★'.repeat(llenas) + '☆'.repeat(5 - llenas);
    },

    abrirFormulario(candidaturaId, nombreOtro) {
      this.candidaturaActual = candidaturaId;
      this.puntuacionSeleccionada = 0;
      document.getElementById("resenyaTitle").textContent = `⭐ Valorar a ${nombreOtro}`;
      document.getElementById("resenyaComentario").value = "";
      document.getElementById("resenyaEstrellasTexto").textContent = "Elige una puntuación";
      this.renderEstrellas();
      document.getElementById("modalResenya").classList.add("active");
    },

    renderEstrellas() {
      const contenedor = document.getElementById("resenyaEstrellas");
      contenedor.innerHTML = [1, 2, 3, 4, 5].map(v => `
        <span class="resenya-estrella ${v <= this.puntuacionSeleccionada ? 'activa' : ''}"
              onclick="app.resenyas.seleccionar(${v})">${v <= this.puntuacionSeleccionada ? '★' : '☆'}</span>
      `).join('');
    },

    seleccionar(valor) {
      this.puntuacionSeleccionada = valor;
      const textos = { 1: "Muy mala", 2: "Mala", 3: "Normal", 4: "Buena", 5: "Excelente" };
      document.getElementById("resenyaEstrellasTexto").textContent = `${valor}/5 — ${textos[valor]}`;
      this.renderEstrellas();
    },

    async enviar() {
      if (!this.candidaturaActual) return;
      if (!this.puntuacionSeleccionada) {
        utils.mostrarAlerta("Elige una puntuación de 1 a 5 estrellas", "error");
        return;
      }

      try {
        await utils.request("/resenyas", {
          method: "POST",
          body: JSON.stringify({
            candidatura_id: this.candidaturaActual,
            puntuacion: this.puntuacionSeleccionada,
            comentario: document.getElementById("resenyaComentario").value
          })
        });
        document.getElementById("modalResenya").classList.remove("active");
        utils.mostrarAlerta("✅ ¡Gracias por tu valoración!", "success");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async cargarResumen(usuarioId) {
      try {
        return await utils.request(`/resenyas/usuario/${usuarioId}`);
      } catch (error) {
        console.error("Error al cargar reseñas:", error);
        return { media: null, total: 0, resenyas: [] };
      }
    },

    // Bloque HTML con la media de reseñas para incrustar en perfiles
    resumenHtml(resumen, usuarioId, nombre) {
      if (!resumen || resumen.total === 0) {
        return `<p style="margin: 0.3rem 0; font-size: 0.95rem; color: #9ca3af;">Sin valoraciones todavía</p>`;
      }
      const nombreEscapado = (nombre || '').replace(/'/g, "\\'");
      return `
        <p style="margin: 0.3rem 0; font-size: 1.05rem;">
          <span style="color: #f59e0b; letter-spacing: 2px;">${this.estrellasHtml(resumen.media)}</span>
          <strong>${resumen.media}</strong> · ${resumen.total} valoraci${resumen.total === 1 ? 'ón' : 'ones'}
          <button class="btn-text btn-small" onclick="app.resenyas.verDeUsuario(${usuarioId}, '${nombreEscapado}')">Ver reseñas</button>
        </p>
      `;
    },

    async verDeUsuario(usuarioId, nombre) {
      const resumen = await this.cargarResumen(usuarioId);

      let html = `<div class="candidatos-list">`;
      if (resumen.total === 0) {
        html += `<p style="text-align: center; color: #6b7280;">Este usuario aún no tiene reseñas.</p>`;
      } else {
        html += `
          <div style="text-align: center; margin-bottom: 1.5rem;">
            <span style="color: #f59e0b; font-size: 1.8rem; letter-spacing: 3px;">${this.estrellasHtml(resumen.media)}</span>
            <p style="margin: 0.3rem 0; color: #6b7280;">${resumen.media} de 5 · ${resumen.total} valoraci${resumen.total === 1 ? 'ón' : 'ones'}</p>
          </div>
        `;
        resumen.resenyas.forEach(r => {
          html += `
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <strong style="color: #0f4c75;">${utils.escapeHtml(r.autor_nombre)} ${r.autor_tipo === 'clinica' ? '🏥' : '👨‍⚕️'}</strong>
                <span style="color: #f59e0b; letter-spacing: 1px;">${this.estrellasHtml(r.puntuacion)}</span>
              </div>
              ${r.comentario ? `<p style="margin: 0.5rem 0; color: #374151; white-space: pre-wrap;">${utils.escapeHtml(r.comentario)}</p>` : ''}
              <span style="font-size: 0.8rem; color: #9ca3af;">${utils.formatearFecha(r.creado_en)}</span>
            </div>
          `;
        });
      }
      html += `</div>`;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `Reseñas de ${utils.escapeHtml(nombre)}`;
      document.getElementById("modalInteresados").classList.add("active");
    }
  },

  // ============================================
  // Módulo: Recordatorios
  // ============================================

  recordatorios: {
    async comprobar() {
      if (!estadoApp.usuario) return;
      if (sessionStorage.getItem("recordatoriosDescartados") === "1") return;

      try {
        const data = await utils.request("/recordatorios/pendientes");
        const pendientes = data.pendientes || [];
        const banner = document.getElementById("recordatoriosBanner");
        if (!banner) return;

        if (pendientes.length === 0) {
          banner.style.display = "none";
          return;
        }

        const masAntigua = Math.max(...pendientes.map(p => p.dias_esperando));
        banner.innerHTML = `
          <span>⏰ Tienes <strong>${pendientes.length}</strong> postulaci${pendientes.length === 1 ? 'ón' : 'ones'} sin responder
          (la más antigua lleva <strong>${masAntigua} día${masAntigua === 1 ? '' : 's'}</strong> esperando).</span>
          <div class="recordatorios-acciones">
            <button class="btn-primary btn-small" onclick="app.recordatorios.revisar()">Revisar</button>
            <button class="btn-text btn-small" onclick="app.recordatorios.descartar()">Descartar</button>
          </div>
        `;
        banner.style.display = "flex";
      } catch (error) {
        console.error("Error al comprobar recordatorios:", error);
      }
    },

    revisar() {
      if (estadoApp.tipoUsuario === 'clinica') {
        app.stats.mostrarCandidatosInteresados();
      } else {
        app.stats.mostrarPostulacionesRecibidas();
      }
    },

    descartar() {
      sessionStorage.setItem("recordatoriosDescartados", "1");
      const banner = document.getElementById("recordatoriosBanner");
      if (banner) banner.style.display = "none";
    }
  },

  // ============================================
  // Módulo: Chat
  // ============================================

  chat: {
    pollingInterval: null,
    conversacionActual: null,
    ultimaSenalEscribiendo: 0,
    // Límite de los adjuntos subidos desde el chat (tipo 'chat' en el backend).
    // El CV y el Book del perfil se referencian ya subidos, así que no lo aplican.
    MAX_ADJUNTO_MB: 25,
    // Adjuntos a la espera de que se pulse "Enviar". Cada uno es un fichero recién
    // elegido/arrastrado ({ file }) o un archivo del perfil ya subido ({ archivoId }).
    // Al enviar, cada adjunto va en su propio mensaje (el texto acompaña al primero).
    adjuntosPendientes: [],
    atajosArchivos: null,

    async abrir() {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }
      this.conversacionActual = null;
      document.getElementById("modalChat").classList.add("active");
      await this.renderConversaciones();
      this.iniciarPolling();
    },

    cerrar() {
      this.detenerPolling();
      this.conversacionActual = null;
      document.getElementById("modalChat").classList.remove("active");
      app.chat.actualizarContador();
    },

    // Abre el chat directamente en la conversación con un usuario sobre una publicación
    async abrirConDestinatario(publicacionId, otroId, otroNombre) {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }
      app.modal.cerrarTodosModales();
      document.getElementById("modalChat").classList.add("active");
      // `publicacionId` ya no hace falta para identificar el hilo (hay uno por
      // persona), pero el parámetro se conserva porque lo pasa el detalle de una
      // publicación, que es desde donde se abre el chat.
      await this.abrirConversacion(otroId, otroNombre);
      this.iniciarPolling();
    },

    async actualizarContador() {
      if (!estadoApp.usuario) return;
      try {
        const data = await utils.request("/chat/no-leidos");
        const badge = document.getElementById("chatBadge");
        if (data.total > 0) {
          badge.textContent = data.total;
          badge.style.display = "inline-block";
        } else {
          badge.style.display = "none";
        }
      } catch (error) {
        console.error("Error al contar mensajes no leídos:", error);
      }
    },

    async renderConversaciones() {
      try {
        const data = await utils.request("/chat/conversaciones");
        const conversaciones = data.conversaciones || [];

        // Contactos de perfil: los pendientes se aceptan aquí; los ya aceptados se
        // añaden a la lista aunque no tengan mensajes, para poder escribir el primero.
        // Se indexa por persona (no por contacto): con alguien hay un solo hilo.
        let pendientes = [];
        try {
          const c = await utils.request("/contactos-perfil");
          pendientes = (c.recibidos || []).filter(x => x.estado === 'pendiente');

          const yaEnLista = new Set(conversaciones.map(cv => cv.otro_id));
          const añadirAceptado = (otroId, otroNombre, fecha) => {
            if (!otroId || yaEnLista.has(otroId)) return;
            yaEnLista.add(otroId);
            conversaciones.push({ otro_id: otroId, otro_nombre: otroNombre, ultimo_mensaje: "", ultima_fecha: fecha, no_leidos: 0 });
          };
          (c.enviados || []).filter(x => x.estado === 'aceptada').forEach(x => añadirAceptado(x.perfil_id, x.perfil_nombre, x.actualizado_en));
          (c.recibidos || []).filter(x => x.estado === 'aceptada').forEach(x => añadirAceptado(x.solicitante_id, x.solicitante_nombre, x.actualizado_en));
        } catch (e) { /* sin contactos */ }

        document.getElementById("chatTitle").textContent = "💬 Mensajes";

        let pendientesHtml = "";
        if (pendientes.length) {
          pendientesHtml = `<div style="margin-bottom: 1rem;">
            <h4 style="color:#0f4c75;margin:0 0 .5rem;">Solicitudes de contacto</h4>` +
            pendientes.map(p => `
              <div id="contacto-${p.id}" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:.75rem 1rem;margin-bottom:.5rem;">
                <strong>${utils.escapeHtml(p.solicitante_nombre || 'Usuario')}</strong>
                <span style="color:#6b7280;font-size:.85rem;"> (${p.solicitante_tipo === 'dentista' ? 'Dentista' : 'Clínica'})</span>
                ${p.mensaje ? `<p style="margin:.3rem 0;font-size:.9rem;color:#4b5563;">${utils.escapeHtml(p.mensaje)}</p>` : ''}
                <div style="display:flex;gap:.5rem;margin-top:.4rem;">
                  <button class="btn-primary btn-small" onclick="app.chat.responderContacto(${p.id}, 'aceptada')">Aceptar</button>
                  <button class="btn-outline btn-small" onclick="app.chat.responderContacto(${p.id}, 'rechazada')">Rechazar</button>
                </div>
              </div>`).join("") + `</div>`;
        }

        if (conversaciones.length === 0 && !pendientes.length) {
          document.getElementById("chatBody").innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #6b7280;">
              <p>No tienes conversaciones todavía.</p>
              <p style="font-size: 0.9rem;">El chat se activa tras aceptar una postulación (a una publicación o a un perfil).</p>
            </div>
          `;
          return;
        }

        let html = pendientesHtml + `<div class="chat-conversaciones">`;
        conversaciones.forEach(c => {
          const nombreEsc = utils.escapeHtml(c.otro_nombre || 'Usuario').replace(/'/g, "\\'");
          html += `
            <div class="chat-conversacion-item" onclick="app.chat.abrirConversacion(${c.otro_id}, '${nombreEsc}')">
              <div class="chat-conversacion-info">
                <strong>${utils.escapeHtml(c.otro_nombre || 'Usuario')}</strong>
                <p class="chat-conversacion-ultimo">${utils.escapeHtml((c.ultimo_mensaje || '').slice(0, 60))}${(c.ultimo_mensaje || '').length > 60 ? '…' : ''}</p>
              </div>
              <div class="chat-conversacion-meta">
                <span class="chat-conversacion-fecha">${utils.formatearFecha(c.ultima_fecha)}</span>
                ${c.no_leidos > 0 ? `<span class="chat-no-leidos">${c.no_leidos}</span>` : ''}
              </div>
            </div>
          `;
        });
        html += `</div>`;
        document.getElementById("chatBody").innerHTML = html;
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async responderContacto(id, estado) {
      try {
        await utils.request(`/contactos-perfil/${id}`, { method: "PUT", body: JSON.stringify({ estado }) });
        utils.mostrarAlerta(estado === 'aceptada' ? "Contacto aceptado, ya podéis chatear" : "Contacto rechazado", "success");
        await this.renderConversaciones();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    renderHiloUI(otroNombre) {
      document.getElementById("chatTitle").textContent = `💬 ${otroNombre}`;
      document.getElementById("chatBody").innerHTML = `
        <div class="chat-hilo" id="chatHilo"
             ondragenter="app.chat.arrastrarEncima(event)"
             ondragover="app.chat.arrastrarEncima(event)"
             ondragleave="app.chat.arrastrarFuera(event)"
             ondrop="app.chat.soltarArchivos(event)">
          <div id="chatDropOverlay" class="chat-drop-overlay">📎 Suelta los archivos para adjuntarlos</div>
          <button class="btn-text btn-small" onclick="app.chat.volverALista()" style="margin-bottom: 0.5rem;">← Todas las conversaciones</button>
          <div id="chatEscribiendo" class="chat-escribiendo" style="visibility: hidden;">escribiendo…</div>
          <div id="chatMensajes" class="chat-mensajes"><p style="color: #9ca3af; text-align: center;">Cargando…</p></div>
          <div id="chatAtajos" class="chat-atajos"></div>
          <div id="chatAdjuntoPendiente" class="chat-adjunto-pendiente" style="display: none;"></div>
          <form class="chat-input-row" onsubmit="event.preventDefault(); app.chat.enviar();">
            <input id="chatFile" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,image/*" style="display: none;" onchange="app.chat.adjuntarFichero()">
            <button type="button" class="chat-adjuntar-btn" title="Adjuntar archivos (máx ${this.MAX_ADJUNTO_MB} MB)" onclick="document.getElementById('chatFile').click()">📎</button>
            <input id="chatInput" type="text" placeholder="Escribe un mensaje…" autocomplete="off" oninput="app.chat.notificarEscribiendo()">
            <button type="submit" class="btn-primary">Enviar</button>
          </form>
          <p class="chat-adjunto-limite">Arrastra aquí tus archivos o pulsa 📎 · hasta ${this.MAX_ADJUNTO_MB} MB cada uno.</p>
        </div>
      `;
    },

    // Con una persona hay un solo hilo: basta su id para identificarlo.
    //
    // El nombre es opcional a propósito. Abrir el hilo NO puede depender de haberlo
    // averiguado antes: cuando se llega desde una notificación solo se tiene el id, y
    // si la petición que resolvía el nombre fallaba (servidor dormido, red mala) el
    // usuario acababa en la bandeja en vez de en su conversación. Ahora el hilo se
    // abre siempre y el nombre se rellena cuando llega, si llega.
    async abrirConversacion(otroId, otroNombre) {
      this.conversacionActual = { otro_id: otroId, otro_nombre: otroNombre };
      this.adjuntosPendientes = [];
      this.renderHiloUI(otroNombre || "Conversación");
      const hilo = this.refrescarHilo(true);
      this.cargarAtajosArchivos();

      if (!otroNombre) {
        utils.requestOpcional(`/usuarios/${otroId}/publico`).then(perfil => {
          const nombre = perfil?.usuario?.nombre || perfil?.nombre;
          // Solo si seguimos en el mismo hilo: el usuario pudo cambiar mientras tanto
          if (nombre && this.conversacionActual?.otro_id === otroId) {
            this.conversacionActual.otro_nombre = nombre;
            const titulo = document.getElementById("chatTitle");
            if (titulo) titulo.textContent = `💬 ${nombre}`;
          }
        });
      }

      await hilo;
      const input = document.getElementById("chatInput");
      if (input) input.focus();
    },

    async volverALista() {
      this.conversacionActual = null;
      await this.renderConversaciones();
    },

    async refrescarHilo(forzarScroll = false) {
      const conv = this.conversacionActual;
      if (!conv) return;

      try {
        const data = await utils.request(`/chat/con/${conv.otro_id}`);
        const mensajes = data.mensajes || [];
        const contenedor = document.getElementById("chatMensajes");
        if (!contenedor) return;

        const estabaAbajo = forzarScroll ||
          (contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight < 60);

        if (mensajes.length === 0) {
          contenedor.innerHTML = `<p style="color: #9ca3af; text-align: center;">Todavía no hay mensajes. ¡Escribe el primero!</p>`;
        } else {
          // En un hilo único conviene saber sobre qué se hablaba. Los mensajes que
          // salieron de una publicación llevan una etiqueta, y solo se pinta cuando
          // cambia respecto al anterior: repetirla en cada burbuja sería ruido.
          let contextoAnterior = null;
          contenedor.innerHTML = mensajes.map(m => {
            const esMio = m.usuario_id === estadoApp.usuario.id;
            const ticks = esMio
              ? `<span class="chat-ticks ${m.leido ? 'chat-ticks-leido' : ''}">${m.leido ? '✓✓' : '✓'}</span>`
              : '';
            const hora = new Date(m.creado_en).toLocaleTimeString("es-ES", { hour: '2-digit', minute: '2-digit' });

            const contexto = m.publicacion_id
              ? `${m.publicacion_tipo === 'oferta' ? 'Oferta' : m.publicacion_tipo === 'suplencia' ? 'Suplencia' : 'Solicitud'}${m.publicacion_ciudad ? ' de ' + m.publicacion_ciudad : ''}`
              : m.contacto_perfil_id ? 'Contacto de perfil' : null;
            let separador = '';
            if (contexto && contexto !== contextoAnterior) {
              separador = `<div class="chat-contexto">sobre: ${utils.escapeHtml(contexto)}</div>`;
            }
            contextoAnterior = contexto;

            const cuerpoHtml = m.cuerpo ? `<p>${utils.escapeHtml(m.cuerpo)}</p>` : '';
            const adjuntoHtml = m.archivo_id ? this.renderAdjunto(m) : '';

            return separador + `
              <div class="chat-burbuja ${esMio ? 'chat-burbuja-mia' : 'chat-burbuja-otro'}">
                ${cuerpoHtml}${adjuntoHtml}
                <span class="chat-burbuja-meta">${utils.formatearFecha(m.creado_en)} ${hora} ${ticks}</span>
              </div>
            `;
          }).join('');
        }

        const escribiendoEl = document.getElementById("chatEscribiendo");
        if (escribiendoEl) {
          escribiendoEl.style.visibility = data.escribiendo ? "visible" : "hidden";
        }

        if (estabaAbajo) {
          contenedor.scrollTop = contenedor.scrollHeight;
        }
      } catch (error) {
        console.error("Error al refrescar chat:", error);
      }
    },

    // Envía al pulsar "Enviar": texto, adjuntos pendientes, o ambos. Cada adjunto va
    // en su propio mensaje (el texto acompaña al primero), así valen varios ficheros
    // —p. ej. las imágenes que componen el Book— en un solo envío. Los ficheros recién
    // elegidos/arrastrados se suben ahora; el CV/Book del perfil ya está subido y solo
    // se referencia por su id.
    async enviar() {
      const conv = this.conversacionActual;
      const input = document.getElementById("chatInput");
      if (!conv || this._enviando) return;

      const cuerpo = input ? input.value.trim() : "";
      const pendientes = this.adjuntosPendientes;
      if (!cuerpo && pendientes.length === 0) return;

      this._enviando = true;
      try {
        // Resolver el id de cada adjunto (subiendo los ficheros nuevos), en orden
        const archivoIds = [];
        for (const p of pendientes) {
          if (p.file) {
            const formData = new FormData();
            formData.append("archivo", p.file);
            formData.append("tipo", "chat");
            const resp = await utils.requestForm("/archivos/upload", formData);
            archivoIds.push(resp.id);
          } else {
            archivoIds.push(p.archivoId);
          }
        }

        const enviarMensaje = (body) => utils.request(`/chat/con/${conv.otro_id}`, {
          method: "POST",
          body: JSON.stringify(body)
        });

        if (archivoIds.length === 0) {
          await enviarMensaje({ cuerpo });
        } else {
          // El texto acompaña al primer adjunto; el resto van solos
          await enviarMensaje({ cuerpo, archivo_id: archivoIds[0] });
          for (let i = 1; i < archivoIds.length; i++) {
            await enviarMensaje({ cuerpo: "", archivo_id: archivoIds[i] });
          }
        }

        if (input) input.value = "";
        this.adjuntosPendientes = [];
        this.renderAdjuntosPendientes();
        await this.refrescarHilo(true);
      } catch (error) {
        // No se limpia ni el texto ni los adjuntos: así se puede reintentar sin rehacerlo
        utils.mostrarAlerta(error.message, "error");
      } finally {
        this._enviando = false;
      }
    },

    // Pinta la tarjeta de un adjunto dentro de una burbuja. El icono y la etiqueta
    // dependen de qué sea: el CV y el Book del perfil se reconocen por su tipo; un
    // fichero suelto ('chat') se muestra según su formato.
    renderAdjunto(m) {
      const mime = m.archivo_mime || '';
      let icono, etiqueta;
      if (m.archivo_tipo === 'cv') {
        icono = '📄'; etiqueta = 'CV';
      } else if (m.archivo_tipo === 'portfolio') {
        icono = '📕'; etiqueta = 'Book';
      } else if (mime.startsWith('image/')) {
        icono = '🖼️'; etiqueta = 'Imagen';
      } else if (mime === 'application/pdf') {
        icono = '📄'; etiqueta = 'PDF';
      } else {
        icono = '📎'; etiqueta = 'Archivo';
      }
      const tamanyo = m.archivo_tamanyo ? ' · ' + utils.formatearTamanyo(m.archivo_tamanyo) : '';
      return `
        <a class="chat-adjunto" href="${API}/archivos/${m.archivo_id}/download" target="_blank" rel="noopener">
          <span class="chat-adjunto-icono">${icono}</span>
          <span class="chat-adjunto-texto">
            <span class="chat-adjunto-nombre">${utils.escapeHtml(m.archivo_nombre || 'Archivo')}</span>
            <span class="chat-adjunto-meta">${etiqueta}${tamanyo}</span>
          </span>
        </a>`;
    },

    // Los dentistas tienen a mano botones para adjuntar su CV y su Book sin volver a
    // subirlos: se referencia lo que ya guardaron en su perfil. El Book puede estar
    // compuesto por varios ficheros; se conservan todos para poder adjuntarlos.
    async cargarAtajosArchivos() {
      const cont = document.getElementById("chatAtajos");
      if (!cont) return;
      cont.innerHTML = '';
      this.atajosArchivos = null;
      if (!estadoApp.usuario || estadoApp.usuario.tipo !== 'dentista') return;
      try {
        const archivos = await utils.request(`/archivos/usuario/${estadoApp.usuario.id}`);
        const cv = archivos.find(a => a.tipo === 'cv');
        const book = archivos.filter(a => a.tipo === 'portfolio');
        this.atajosArchivos = { cv, portfolio: book };
        let html = '';
        if (cv) html += `<button type="button" class="chat-atajo" onclick="app.chat.adjuntarPerfil('cv')">📄 Adjuntar mi CV</button>`;
        if (book.length) html += `<button type="button" class="chat-atajo" onclick="app.chat.adjuntarPerfil('portfolio')">📕 Adjuntar mi Book${book.length > 1 ? ` (${book.length})` : ''}</button>`;
        cont.innerHTML = html;
      } catch (error) {
        console.error("Error al cargar atajos de archivos:", error);
      }
    },

    // Añade un fichero a la lista de pendientes validando el tamaño (mismo tope que el
    // backend). Devuelve si se ha podido añadir. No envía nada: eso pasa en "Enviar".
    anadirFicheroPendiente(file) {
      if (file.size > this.MAX_ADJUNTO_MB * 1024 * 1024) {
        utils.mostrarAlerta(`«${file.name}» supera el máximo de ${this.MAX_ADJUNTO_MB} MB`, "error");
        return false;
      }
      this.adjuntosPendientes.push({ file, nombre: file.name, tamanyo: file.size, mime: file.type });
      return true;
    },

    // Elegir ficheros con el botón 📎 (admite varios). Solo se dejan pendientes.
    adjuntarFichero() {
      const input = document.getElementById("chatFile");
      if (!input || input.files.length === 0) return;
      for (const file of input.files) this.anadirFicheroPendiente(file);
      input.value = '';
      this.renderAdjuntosPendientes();
      const caja = document.getElementById("chatInput");
      if (caja) caja.focus();
    },

    // Dejar pendiente el CV o el Book del perfil (no se re-suben: ya están subidos, así
    // que no les aplica el tope del chat). El Book añade todos sus ficheros.
    adjuntarPerfil(tipo) {
      if (!this.atajosArchivos) return;
      const lista = tipo === 'cv'
        ? (this.atajosArchivos.cv ? [this.atajosArchivos.cv] : [])
        : (this.atajosArchivos.portfolio || []);
      lista.forEach(a => {
        // No duplicar un archivo del perfil que ya esté pendiente
        if (this.adjuntosPendientes.some(p => p.archivoId === a.id)) return;
        this.adjuntosPendientes.push({ archivoId: a.id, nombre: a.nombre_archivo, tamanyo: a.tamanyo, tipo: a.tipo });
      });
      this.renderAdjuntosPendientes();
      const caja = document.getElementById("chatInput");
      if (caja) caja.focus();
    },

    // Arrastrar y soltar ficheros sobre el hilo para adjuntarlos.
    arrastrarEncima(event) {
      // Solo reaccionar si lo que se arrastra son ficheros, no texto/enlaces
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
      event.preventDefault();
      const hilo = document.getElementById("chatHilo");
      if (hilo) hilo.classList.add("chat-arrastrando");
    },

    arrastrarFuera(event) {
      const hilo = document.getElementById("chatHilo");
      if (!hilo) return;
      // Al pasar de un hijo a otro dentro del hilo, no se considera que se ha salido
      if (event.relatedTarget && hilo.contains(event.relatedTarget)) return;
      hilo.classList.remove("chat-arrastrando");
    },

    soltarArchivos(event) {
      event.preventDefault();
      const hilo = document.getElementById("chatHilo");
      if (hilo) hilo.classList.remove("chat-arrastrando");
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || files.length === 0) return;
      for (const file of files) this.anadirFicheroPendiente(file);
      this.renderAdjuntosPendientes();
      const caja = document.getElementById("chatInput");
      if (caja) caja.focus();
    },

    // Vista previa de los adjuntos pendientes, cada uno con su ✕ para quitarlo.
    renderAdjuntosPendientes() {
      const cont = document.getElementById("chatAdjuntoPendiente");
      if (!cont) return;
      const lista = this.adjuntosPendientes;
      if (!lista.length) {
        cont.style.display = "none";
        cont.innerHTML = "";
        return;
      }
      cont.style.display = "flex";
      const caption = `<div class="chat-adjunto-pendiente-caption">Se enviará${lista.length > 1 ? 'n' : ''} al pulsar «Enviar»</div>`;
      cont.innerHTML = caption + lista.map((p, i) => {
        const mime = p.mime || '';
        let icono = '📎';
        if (p.tipo === 'cv') icono = '📄';
        else if (p.tipo === 'portfolio') icono = '📕';
        else if (mime.startsWith('image/')) icono = '🖼️';
        else if (mime === 'application/pdf') icono = '📄';
        const tamanyo = p.tamanyo ? utils.formatearTamanyo(p.tamanyo) : '';
        return `
          <div class="chat-adjunto-pendiente-item">
            <span class="chat-adjunto-pendiente-icono">${icono}</span>
            <span class="chat-adjunto-pendiente-texto">
              <span class="chat-adjunto-pendiente-nombre">${utils.escapeHtml(p.nombre || 'Archivo')}</span>
              <span class="chat-adjunto-pendiente-meta">${tamanyo}</span>
            </span>
            <button type="button" class="chat-adjunto-pendiente-quitar" title="Quitar el adjunto" onclick="app.chat.quitarAdjuntoPendiente(${i})">✕</button>
          </div>`;
      }).join('');
    },

    quitarAdjuntoPendiente(index) {
      this.adjuntosPendientes.splice(index, 1);
      this.renderAdjuntosPendientes();
    },

    notificarEscribiendo() {
      const conv = this.conversacionActual;
      if (!conv) return;
      // Throttle: como mucho una señal cada 2 segundos
      const ahora = Date.now();
      if (ahora - this.ultimaSenalEscribiendo < 2000) return;
      this.ultimaSenalEscribiendo = ahora;

      utils.request("/chat/escribiendo", {
        method: "POST",
        body: JSON.stringify({ destinatario_id: conv.otro_id })
      }).catch(err => console.error("Error señal escribiendo:", err));
    },

    iniciarPolling() {
      this.detenerPolling();
      this.pollingInterval = setInterval(async () => {
        const modal = document.getElementById("modalChat");
        if (!modal || !modal.classList.contains("active")) {
          this.detenerPolling();
          return;
        }
        if (this.conversacionActual) {
          await this.refrescarHilo();
        } else {
          await this.renderConversaciones();
        }
      }, 3000);
    },

    detenerPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    }
  },

  // ============================================
  // Módulo: Especialidades
  // ============================================

  especialidades: {
    async cargar() {
      try {
        const especialidades = await utils.request("/especialidades");
        estadoApp.especialidades = especialidades;
        app.especialidades.renderizarSelectos();
      } catch (error) {
        console.error(error);
      }
    },

    renderizarSelectos() {
      const selectores = [
        "filterEspecialidad",
        "ofertaEspecialidad",
        "solicitudEspecialidad"
      ];

      selectores.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;

        const opcionesHTML = estadoApp.especialidades
          .map(e => `<option value="${e.id}">${e.nombre}</option>`)
          .join("");

        const valorActual = select.value;
        select.innerHTML = `<option value="">Todas las especialidades</option>${opcionesHTML}`;
        select.value = valorActual;
      });
    }
  },

  // ============================================
  // Módulo: Test de compatibilidad (preferencias)
  //
  // Las mismas 5 preguntas para los dos lados: el dentista responde lo que busca
  // y la clínica lo que es. Cambia solo el enunciado, que viene del catálogo del
  // backend. Las ofertas heredan las respuestas de su clínica, así que esto se
  // rellena una vez y ya.
  // ============================================

  preferencias: {
    dimensiones: [],
    respuestas: {},
    // Prioridades personales (Fase 3): solo para dentistas
    dimsPrioridad: [],
    niveles: [],
    prioridades: {},

    async cargar() {
      try {
        const esDentista = estadoApp.tipoUsuario === 'dentista';
        const peticiones = [
          utils.request("/compatibilidad/catalogo"),
          utils.request("/preferencias")
        ];
        // El dentista, además del cuestionario, pondera las dimensiones (sus prioridades)
        if (esDentista) peticiones.push(utils.request("/prioridades"));
        const [catalogo, mias, prio] = await Promise.all(peticiones);
        this.dimensiones = catalogo.dimensiones || [];
        this.respuestas = mias.preferencias || {};
        if (prio) {
          this.dimsPrioridad = prio.dimensiones || [];
          this.niveles = prio.niveles || [];
          this.prioridades = prio.prioridades || {};
        }
        this.renderizar();
      } catch (error) {
        console.error("Error al cargar el test de compatibilidad:", error);
        const cont = document.getElementById("compatibilidadPreguntas");
        if (cont) cont.innerHTML = `<p style="color:#dc2626;">No se ha podido cargar el test. Inténtalo de nuevo.</p>`;
      }
    },

    renderizar() {
      const esDentista = estadoApp.tipoUsuario === 'dentista';
      const intro = document.getElementById("compatibilidadIntro");
      if (intro) {
        intro.textContent = esDentista
          ? "5 preguntas sobre cómo quieres trabajar. Con ellas calculamos tu % de encaje con cada clínica, y verás en qué coincidís y en qué no."
          : "5 preguntas sobre cómo es tu clínica. Los dentistas verán su % de encaje contigo, así que atraerás a quien de verdad encaja. Se responden una vez y valen para todas tus ofertas.";
      }

      const cont = document.getElementById("compatibilidadPreguntas");
      if (!cont) return;

      cont.innerHTML = this.dimensiones.map(dim => {
        const enunciado = esDentista ? dim.pregunta_dentista : dim.pregunta_clinica;
        const guardado = this.respuestas[dim.clave];

        const opciones = dim.opciones.map((op, i) => {
          const id = `pref_${dim.clave}_${i}`;
          const marcado = dim.tipo === 'multi'
            ? Array.isArray(guardado) && guardado.includes(op)
            : guardado === op;
          return `
            <label for="${id}" style="display:flex; align-items:center; gap:.5rem; padding:.35rem 0; cursor:pointer;">
              <input type="${dim.tipo === 'multi' ? 'checkbox' : 'radio'}"
                     id="${id}" name="pref_${dim.clave}" value="${utils.escapeHtml(op)}" ${marcado ? 'checked' : ''}>
              <span>${utils.escapeHtml(op)}</span>
            </label>`;
        }).join("");

        return `
          <div style="background:#F8FAFF; border:1px solid #dbe4f0; border-radius:10px; padding:1rem; margin-bottom:1rem;">
            <div style="font-weight:700; color:#0F4C75; margin-bottom:.15rem;">${utils.escapeHtml(enunciado)}</div>
            <div style="color:#6b7280; font-size:.8rem; margin-bottom:.5rem;">
              ${dim.tipo === 'multi' ? 'Puedes marcar varias' : 'Elige una'}
            </div>
            ${opciones}
          </div>`;
      }).join("");

      this.renderizarPrioridades();
    },

    // Bloque de prioridades: el dentista dice cuánto pesa cada dimensión en SU %.
    // Solo para dentistas (la clínica es el lado evaluado, no quien pondera).
    renderizarPrioridades() {
      const cont = document.getElementById("compatibilidadPrioridades");
      if (!cont) return;
      if (estadoApp.tipoUsuario !== 'dentista') { cont.innerHTML = ""; return; }

      const ETIQUETA_NIVEL = { alta: "Mucho", media: "Normal", baja: "Poco" };
      const filas = this.dimsPrioridad.map(dim => {
        const actual = this.prioridades[dim.clave] || "media";
        const opciones = this.niveles.map(n => {
          const id = `prio_${dim.clave}_${n}`;
          return `
            <label for="${id}" style="display:flex; align-items:center; gap:.3rem; cursor:pointer;">
              <input type="radio" id="${id}" name="prio_${dim.clave}" value="${n}" ${n === actual ? 'checked' : ''}>
              <span>${ETIQUETA_NIVEL[n] || n}</span>
            </label>`;
        }).join("");
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:.45rem 0; border-top:1px solid #eef2f7;">
            <span style="font-weight:600; color:#0F4C75;">${utils.escapeHtml(dim.etiqueta)}</span>
            <div style="display:flex; gap:.9rem; flex-shrink:0;">${opciones}</div>
          </div>`;
      }).join("");

      cont.innerHTML = `
        <div style="background:#F8FAFF; border:1px solid #dbe4f0; border-radius:10px; padding:1rem; margin-top:1.25rem;">
          <div style="font-weight:700; color:#0F4C75; margin-bottom:.15rem;">🎚️ ¿Qué es lo que más te importa?</div>
          <div style="color:#6b7280; font-size:.8rem; margin-bottom:.5rem;">
            Ajusta cuánto pesa cada aspecto en tu % de compatibilidad. Lo que marques como «Mucho» cuenta el doble; «Poco», la mitad.
          </div>
          ${filas}
        </div>`;
    },

    async guardar() {
      const preferencias = {};
      this.dimensiones.forEach(dim => {
        const marcados = Array.from(
          document.querySelectorAll(`input[name="pref_${dim.clave}"]:checked`)
        ).map(el => el.value);
        if (marcados.length === 0) return;
        preferencias[dim.clave] = dim.tipo === 'multi' ? marcados : marcados[0];
      });

      try {
        await utils.request("/preferencias", { method: 'PUT', body: JSON.stringify({ preferencias }) });
        this.respuestas = preferencias;

        // El dentista guarda además sus prioridades (cuánto pesa cada dimensión).
        if (estadoApp.tipoUsuario === 'dentista') {
          const prioridades = {};
          this.dimsPrioridad.forEach(dim => {
            const val = document.querySelector(`input[name="prio_${dim.clave}"]:checked`)?.value;
            if (val) prioridades[dim.clave] = val;
          });
          await utils.request("/prioridades", { method: 'PUT', body: JSON.stringify({ prioridades }) });
          this.prioridades = prioridades;
        }

        utils.mostrarAlerta("✅ Respuestas guardadas", "success");
        // Al guardar bien, cerrar la ventana de perfil (cerrarPerfil refresca el
        // onboarding). El toast de éxito vive en el body, así que sigue visible.
        app.modal.cerrarPerfil();
      } catch (error) {
        console.error("Error al guardar las preferencias:", error);
        utils.mostrarAlerta("Error al guardar las respuestas", "error");
      }
    }
  },

  // ============================================
  // Módulo: Catálogos fijos (equipamiento, certificaciones)
  // ============================================

  catalogos: {
    equipamiento: [],      // catálogo completo (lo que existe)
    certificaciones: [],
    equipamientoClinica: null, // lo que tiene ESTA clínica; null = aún no consultado

    // El equipamiento propio de la clínica, cacheado. Se usa en la vista previa al
    // publicar, que antes lo sacaba de la sede: ahora es de la clínica entera.
    async cargarEquipamientoClinica() {
      if (this.equipamientoClinica !== null) return this.equipamientoClinica;
      const data = await utils.requestOpcional("/auth/mi-equipamiento");
      this.equipamientoClinica = data?.equipamiento || [];
      return this.equipamientoClinica;
    },

    async cargar() {
      if (this.equipamiento.length > 0 || this.certificaciones.length > 0) return;
      try {
        const data = await utils.request("/catalogos");
        this.equipamiento = data.equipamiento || [];
        this.certificaciones = data.certificaciones || [];
      } catch (error) {
        console.error("Error al cargar catálogos:", error);
      }
    },

    // Rellena el <select> de filtro de equipamiento/certificación
    renderizarFiltros() {
      const selEquipo = document.getElementById("filterEquipamiento");
      if (selEquipo) {
        const actual = selEquipo.value;
        selEquipo.innerHTML = `<option value="">Cualquier equipamiento</option>` +
          this.equipamiento.map(e => `<option value="${utils.escapeHtml(e)}">${utils.escapeHtml(e)}</option>`).join("");
        selEquipo.value = actual;
      }
      const selCert = document.getElementById("filterCertificacion");
      if (selCert) {
        const actual = selCert.value;
        selCert.innerHTML = `<option value="">Cualquier certificación</option>` +
          this.certificaciones.map(c => `<option value="${utils.escapeHtml(c)}">${utils.escapeHtml(c)}</option>`).join("");
        selCert.value = actual;
      }
    },

    // Checkboxes de equipamiento en el formulario de publicar (prefijo: 'oferta' o 'suplencia')
    renderizarEquipamientoPublicar(prefijo) {
      const contenedor = document.getElementById(`${prefijo}EquipamientoContainer`);
      if (!contenedor) return;
      contenedor.innerHTML = this.equipamiento.map(e => `
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <input type="checkbox" value="${utils.escapeHtml(e)}">
          ${utils.escapeHtml(e)}
        </label>
      `).join("");
    },

    // Checkboxes de certificaciones en "Mis datos" del dentista
    renderizarCertificacionesPerfil(seleccionadas) {
      const contenedor = document.getElementById("certificacionesContainer");
      if (!contenedor) return;
      contenedor.innerHTML = this.certificaciones.map(c => `
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <input type="checkbox" value="${utils.escapeHtml(c)}" ${seleccionadas.includes(c) ? 'checked' : ''}>
          ${utils.escapeHtml(c)}
        </label>
      `).join("");
    },

    // Checkboxes de equipamiento en "Mis datos" de la clínica. Antes se declaraba en
    // cada sede; ahora es de la clínica entera y todas sus ofertas lo heredan.
    renderizarEquipamientoPerfil(seleccionados) {
      const contenedor = document.getElementById("clinicaEquipamientoContainer");
      if (!contenedor) return;
      contenedor.innerHTML = this.equipamiento.map(e => `
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <input type="checkbox" value="${utils.escapeHtml(e)}" ${seleccionados.includes(e) ? 'checked' : ''}>
          ${utils.escapeHtml(e)}
        </label>
      `).join("");
    }
  },

  candidaturas: {
    async enviarPostulacion() {
      if (!estadoApp.publicacionActual) return;

      const mensaje = document.getElementById("postulacionMensaje").value;
      const errorDiv = document.getElementById("postulacionError");

      // Recoger respuestas a las preguntas de criba (si las hay), en orden
      const camposPreguntas = Array.from(document.querySelectorAll("#postulacionPreguntas [data-pregunta-criba]"))
        .sort((a, b) => Number(a.dataset.preguntaCriba) - Number(b.dataset.preguntaCriba));
      const respuestas = camposPreguntas.map(c => c.value.trim());
      if (camposPreguntas.length > 0 && respuestas.some(r => r.length === 0)) {
        errorDiv.innerHTML = "Responde a todas las preguntas de la oferta.";
        errorDiv.style.display = "block";
        return;
      }

      try {
        await utils.request("/candidaturas", {
          method: "POST",
          body: JSON.stringify({
            publicacion_id: estadoApp.publicacionActual.id,
            mensaje: mensaje || null,
            respuestas: respuestas.length ? respuestas : undefined
          })
        });

        errorDiv.style.display = "none";
        utils.mostrarAlerta("✅ ¡Postulación enviada!", "success");
        app.modal.cerrarPostularseModal();
        app.modal.cerrarDetalle();
        await app.publicaciones.cargar();
        await app.ui.actualizarStats();
        app.onboarding.refrescar();
      } catch (error) {
        console.error("Error en postulación:", error);
        const mensajeError = error.message || "Error al enviar postulación";

        // Mostrar error dentro del modal
        errorDiv.innerHTML = mensajeError;
        errorDiv.style.display = "block";
      }
    },

    async postularse(publicacionId) {
      // Función antigua, mantener por compatibilidad
      estadoApp.publicacionActual = { id: publicacionId };
      app.modal.abrirPostularseModal();
    },

    async cargarMisPostulaciones() {
      try {
        const data = await utils.request("/candidaturas/mis-postulaciones");
        const candidaturas = data.candidaturas || [];
        const container = document.getElementById("misPostulacionesContainer");
        if (!container) return;
        if (candidaturas.length === 0) {
          container.innerHTML = `<div style="padding: 2rem; text-align: center; color: #6b7280;"><p>No tienes postulaciones aún</p></div>`;
          return;
        }
        const html = candidaturas.map(c => {
          const estadoColor = utils.colorEstado(c.estado);
          return `<div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;"><div style="display: flex; justify-content: space-between; align-items: start;"><div style="flex: 1;"><h3 style="margin: 0 0 0.5rem 0; color: #1f2937;">${utils.escapeHtml(c.titulo)}</h3><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Empresa:</strong> ${utils.escapeHtml(c.empresa_nombre)}</p><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Ciudad:</strong> ${utils.escapeHtml(c.ciudad || 'No especificada')}</p><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Contrato:</strong> ${utils.escapeHtml(c.contrato)} | <strong>Jornada:</strong> ${utils.escapeHtml(c.jornada)}</p></div><div style="text-align: right;"><span style="background: ${estadoColor}; color: white; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.85rem; text-transform: capitalize;">${utils.textoEstado(c.estado)}</span><button class="btn-text btn-small" onclick="app.candidaturas.retirarPostulacion(${c.id})" style="margin-top: 0.5rem; display: block;">Retirar</button></div></div></div>`;
        });
        container.innerHTML = `<div>${html.join('')}</div>`;
      } catch (error) {
        console.error(error);
      }
    },

    async retirarPostulacion(candidaturaId) {
      if (!confirm("¿Retirar postulación?")) return;
      try {
        await utils.request(`/candidaturas/${candidaturaId}`, { method: "DELETE" });
        utils.mostrarAlerta("✅ Postulación retirada", "success");

        // Cerrar modales que pudieran mostrar la postulación ya retirada
        ["modalDetalle", "modalInteresados"].forEach(id => {
          document.getElementById(id)?.classList.remove("active");
        });

        // Refrescar solo la vista donde estaba este botón, sin recargar toda
        // la página (eso perdía filtros y scroll, y cortaba el aviso de éxito)
        if (document.getElementById("misPostulacionesContainer")) {
          await app.candidaturas.cargarMisPostulaciones();
        } else if (document.querySelector("#publicacionesContainer .kanban-board")) {
          await app.kanban.render();
        } else if (document.getElementById("publicacionesContainer")) {
          await app.publicaciones.cargar();
        }
        await app.ui.actualizarStats();
      } catch (error) {
        utils.mostrarAlerta("❌ " + error.message, "error");
      }
    },

    async cargarCandidatos(publicacionId) {
      try {
        const data = await utils.request(`/publicaciones/${publicacionId}/candidatos`);
        const candidatos = data.candidatos || [];
        const container = document.getElementById("candidatosBody");
        if (!container) return;
        if (candidatos.length === 0) {
          container.innerHTML = `<div style="padding: 2rem; text-align: center; color: #6b7280;"><p>No hay candidatos aún</p></div>`;
          return;
        }
        const html = candidatos.map(c => {
          const estadoColor = utils.colorEstado(c.estado);
          return `<div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;"><div style="display: flex; justify-content: space-between; align-items: start;"><div style="flex: 1;"><h3 style="margin: 0 0 0.5rem 0; color: #1f2937;">${utils.escapeHtml(c.nombre)}</h3><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Email:</strong> ${utils.escapeHtml(c.email)}</p>${c.telefono ? `<p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Teléfono:</strong> ${utils.escapeHtml(c.telefono)}</p>` : ''}${c.movil ? `<p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Móvil:</strong> ${utils.escapeHtml(c.movil)}</p>` : ''}${c.ciudad ? `<p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Ciudad:</strong> ${utils.escapeHtml(c.ciudad)}</p>` : ''}${c.mensaje ? `<p style="margin: 0.5rem 0 0 0; padding: 0.75rem; background: #f3f4f6; border-radius: 6px; border-left: 3px solid #2563eb; color: #374151; font-size: 0.9rem;"><strong>Mensaje:</strong> ${utils.escapeHtml(c.mensaje)}</p>` : ''}${utils.respuestasCribaHtml(c.respuestas)}</div><div style="text-align: right;"><span style="background: ${estadoColor}; color: white; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.85rem; text-transform: capitalize; display: inline-block; margin-bottom: 0.5rem;">${utils.textoEstado(c.estado)}</span><div style="display: flex; gap: 0.5rem; flex-direction: column;">${utils.selectorEstado(c.id, c.estado, `app.candidaturas.actualizarEstado(${c.id}, this.value, ${publicacionId})`)}<button class="btn-outline btn-small" onclick="app.perfiles.verDetalle(${c.usuario_id}, true)" title="Perfil del dentista, con su CV">👤 Ver perfil y CV</button><button class="btn-outline btn-small" onclick="app.perfiles.verBook(${c.usuario_id}, '${utils.escapeHtml((c.nombre || 'este dentista').replace(/'/g, "\\'"))}', true)" title="Archivos del Book del dentista">📕 Descargar Book</button></div></div></div></div>`;
        });
        container.innerHTML = `<div>${html.join('')}</div>`;
      } catch (error) {
        console.error(error);
      }
    },

    async actualizarEstado(candidaturaId, nuevoEstado, publicacionId) {
      try {
        await utils.request(`/candidaturas/${candidaturaId}`, {
          method: "PUT",
          body: JSON.stringify({ estado: nuevoEstado })
        });
        utils.mostrarAlerta(`✅ Candidatura ${nuevoEstado}`, "success");
        app.candidaturas.cargarCandidatos(publicacionId);
      } catch (error) {
        utils.mostrarAlerta("❌ " + error.message, "error");
      }
    }
  }
};

// Cerradores globales de modales (presionando Esc)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    app.modal.cerrarTodosModales();
  }
});

// Cerrador por clic fuera del modal - SOLO para modales activos
document.addEventListener("click", (e) => {
  // Solo cerrar si es click en un modal activo
  if (e.target.classList && e.target.classList.contains("modal") && e.target.classList.contains("active")) {
    e.target.classList.remove("active");
    app.modal.cerrarTodosModales();
  }

  // Cerrar el panel de notificaciones al hacer clic fuera de él y del botón campana
  const panel = document.getElementById("notifPanel");
  if (panel && panel.style.display === "block") {
    const dentro = panel.contains(e.target) || document.getElementById("btnNotif")?.contains(e.target);
    if (!dentro) panel.style.display = "none";
  }
});


// Función de debug para encontrar qué está bloqueando clicks
window.findBlocker = () => {
  console.log("=== BUSCANDO ELEMENTO QUE BLOQUEA ===");
  const buttons = Array.from(document.querySelectorAll('.stat-item, [onclick*="mostrar"]'));
  buttons.forEach(btn => {
    const rect = btn.getBoundingClientRect();
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const element = document.elementFromPoint(centerX, centerY);
    console.log("Button:", btn.textContent.trim());
    console.log("Element at position:", element?.id || element?.className || element?.tagName);
    console.log("z-index:", getComputedStyle(element)?.zIndex || "auto");
    console.log("pointer-events:", getComputedStyle(element)?.pointerEvents || "auto");
    console.log("display:", getComputedStyle(element)?.display || "auto");
    console.log("visibility:", getComputedStyle(element)?.visibility || "auto");
    console.log("---");
  });
};

// Inicializar la aplicación
app.ui.init();
