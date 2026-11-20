# Citas por WhatsApp para clínicas · Demo

Demo comercial para reuniones de venta con micro, pequeñas y medianas empresas. Muestra en 2 minutos que un
**asistente de WhatsApp agenda, confirma y recuerda citas solo**, y que la clínica lo ve todo en su panel.

- Subdominio previsto: `citas-whatsapp-demo.vercel.app`
- Sitio **estático** (HTML + CSS + JavaScript con módulos nativos): **no hay paso de compilación** ni framework.
- Todo es **ficticio y simulado**: marcas, personas, teléfonos (+507 6000-xxxx), WhatsApp y pagos.
- Giros: *Centro de Fisioterapia Movimiento*, *Clínica Dental Sonrisa* y *Veterinaria Patitas*.

> Frase para la reunión: **«Sus pacientes agendan y confirman solos por WhatsApp; su equipo solo atiende lo que necesita una persona.»**

---

## 1. Cómo correrlo

Requisitos: Node.js 20 o superior (probado con Node 24). No hace falta instalar nada para el modo guion.

```bash
npm start
# → http://127.0.0.1:5173   (otro puerto: PORT=8080 npm start)
```

Alternativa sin Node: `python -m http.server 5173 --directory public`.
Las rutas son por hash (`#/`, `#/demo`, `#/admin`), así que cualquier servidor de archivos estáticos sirve.

Pruebas automáticas (sin navegador, 71 pruebas):

```bash
npm test
```

### Rutas

| Ruta | Qué es |
| --- | --- |
| `#/` | Portada con el selector de giro (cambia marca, servicios, profesionales y textos del bot) |
| `#/demo` | Vista del cliente: teléfono con WhatsApp simulado a la izquierda, panel «En vivo» a la derecha |
| `#/admin` | Panel de recepción. Se entra con el botón **Entrar como administrador** (sin contraseña) |
| `#/admin/agenda` · `conversaciones` · `seguimiento` · `configuracion` | Secciones del panel |

Botones siempre visibles: **▶ Presentación** y **↺ Reiniciar demo**. El banner fijo de arriba avisa que es una demo con datos ficticios y
ofrece el diagnóstico gratis de 30 minutos.

---

## 2. Cómo desplegarlo

### Netlify (configuración incluida en `netlify.toml`)

1. Suba esta carpeta a un repositorio de git y créelo como sitio en Netlify.
2. Sin comando de compilación. Directorio de publicación: `public`. Funciones: `api` (ya está en `netlify.toml`).
3. En *Domain management* agregue `citas-whatsapp-demo.vercel.app` (registro CNAME hacia el sitio de Netlify; HTTPS automático).

Otros hostings estáticos: publique solo la carpeta `public/`. Sin `/api/chat` la demo funciona igual en modo guion.

### Modo «IA real» (opcional)

El modo guion es el predeterminado y no necesita nada. Para activar **IA real**:

1. En Netlify: *Site configuration → Environment variables* → cree `ANTHROPIC_API_KEY` con su clave.
   **La clave solo vive en esa variable del servidor**: nunca la escriba en el código, en `.env` dentro del repo ni en el navegador.
2. Opcionales: `CLAUDE_MODEL` (por defecto `claude-opus-5-5`; para menor costo y latencia pruebe `claude-haiku-5-5`),
   `CLAUDE_FALLBACKS=off` (desactiva el respaldo de modelo ante un rechazo de seguridad) y
   `ALLOWED_ORIGINS=https://citas-whatsapp-demo.vercel.app` (limita quién puede llamar a la función).
3. En la demo, bajo el teléfono, elija **IA real**. Si `/api/chat` no existe, no tiene clave o falla, la demo avisa y
   **se queda (o vuelve) al modo guion sin romper nada**.

Probarlo en local: `npm install` una vez, defina `ANTHROPIC_API_KEY` **en su propia terminal** y ejecute `npm start`.

**Cómo funciona.** `api/chat.js` usa el SDK oficial `@anthropic-ai/sdk`. Contrato:

```jsonc
// POST /api/chat
{ "demo": "citas", "sessionId": "…", "messages": [{ "role": "user", "content": "…" }],
  "context": { "clinica": {…}, "servicios": […], "profesionales": […], "horariosLibres": […], "citasDelPaciente": […] } }
// → { "reply": "…", "actions": [{ "type": "crear_cita", "payload": {…} }], "handoff": false }
```

- Las instrucciones del modelo reproducen **el mismo flujo del guion** y los datos reales de la configuración (precios, horarios,
  horarios libres de la agenda). No inventa datos.
- **La IA nunca escribe datos**: solo *propone* acciones. El navegador aplica únicamente las permitidas
  (`proponer_horarios`, `crear_cita`, `reprogramar_cita`, `cancelar_cita`, `confirmar_cita`, `marcar_urgente`, `pasar_a_persona`),
  validando cada payload contra la agenda real (horario libre, servicio, profesional, teléfono, y que la cita sea del paciente).
- **Urgencias y «hablar con una persona» siempre las decide el guion**, nunca la IA.
- **Privacidad**: a la IA no se le envían mensajes que parezcan datos de salud (llegan como «mensaje no guardado»).
- La función no guarda nada. No tiene límite de uso propio: use `ALLOWED_ORIGINS` y fije un límite de gasto en su cuenta de Anthropic.

---

## 3. Guion de 2 minutos

Use **▶ Presentación** para recorrerlo solo (15 pasos con una nota por paso; `→` y `←` avanzan o retroceden, `Esc` sale,
«Reproducir solo» avanza automáticamente) o hágalo a mano:

1. **Portada (15 s).** Elija el giro del prospecto: cambian marca, servicios, profesionales y textos del bot.
2. **Agendar (40 s).** En el teléfono: *«Hola, quiero una cita para mañana»* → servicio → *«el primero disponible»* → 3 horarios
   reales → número `1` → nombre → teléfono (use `6000-0000`) → *«sí»*. Muestre la cita apareciendo en el panel de la derecha.
3. **Recordatorio (20 s).** **⏰ Simular día anterior** → responda `1` → la cita pasa a *Confirmada* (mírela en el panel).
4. **Urgencia (20 s).** Escriba *«tengo un dolor fuerte»* (o, en veterinaria, *«mi perro se tragó algo y está vomitando»*):
   el bot no agenda, da el teléfono y marca **URGENTE**. Pulse **Pasar a una persona**.
5. **Panel (20 s).** **Entrar como administrador**: indicadores, calendario por profesional (arrastre una cita), bandeja con
   las urgentes arriba.
6. **Cierre (5 s).** La frase de venta y el botón *«Agende un diagnóstico gratis de 30 minutos»*.

---

## 4. Qué incluye

**Bot (modo guion)** — entiende tildes, mayúsculas, «pa mañana», números, «la segunda», horas («a las 10») y errores de una letra.

| Flujo | Qué hace |
| --- | --- |
| a) Saludo | Menú: Agendar cita / Precios y horarios / Ubicación / Reprogramar o cancelar / Hablar con una persona |
| b) Agendar | Servicio → profesional (o «el primero disponible») → 3 horarios libres reales → nombre y teléfono (y mascota en veterinaria) → resumen → cita creada al instante (Pendiente, origen *chat*) |
| c) Recordatorio | «Simular día anterior» → *«¿Confirma? 1. Sí 2. Reprogramar»*; la respuesta cambia el estado |
| d) Reprogramar y cancelar | Con los mismos horarios libres; el horario liberado vuelve a estar disponible |
| e) Urgencias | Palabras configurables (dolor fuerte, sangrado, accidente, no respira, envenenamiento…): no agenda, da el teléfono, marca URGENTE y ofrece una persona |
| f) Seguimiento | Veterinaria: próxima vacuna a los 12 meses · Fisioterapia: aviso al quedar 2 sesiones del paquete · Odontología: limpieza a los 6 meses |

**Panel** — calendario semanal/diario por profesional (mover arrastrando o con botones, con validación), 6 estados con
historial, indicadores (citas de la semana, % confirmado, reprogramadas con aviso, conversaciones a una persona), bandeja de
conversaciones, seguimiento, y configuración editable (horario, servicios con duración/precio/ITBMS, profesionales, mensajes
del bot, palabras de urgencia, teléfono y dirección).

**Datos semilla por giro:** 3 profesionales, 4 servicios, 15 pacientes y 25 citas en la semana actual (de lunes a sábado)
con estados variados. Son deterministas: «Reiniciar demo» siempre deja el mismo estado. Si cambia la semana, se siembra de nuevo.

**Privacidad (CIT-RNF-01):** solo se guarda nombre, teléfono, servicio, hora y, en veterinaria, nombre/especie/edad de la mascota.
Un mensaje que parezca contener síntomas o datos de salud se muestra en el teléfono durante la sesión, pero **no se guarda**
(ni en `localStorage` ni en la bandeja) y no se envía a la IA. Los archivos adjuntos tampoco se leen ni se guardan.

**Moneda e impuestos:** balboas (**B/.**) en toda la demo. El ITBMS de 7% aparece solo en los servicios que lo tienen marcado en la
configuración (blanqueamiento y baño, a modo de ejemplo): confírmelo con el contador de cada cliente.

---

## 5. Estructura

```
citas-whatsapp-demo/
├─ api/chat.js                 Función serverless (IA real). Clave solo en variable de entorno.
├─ public/                     Sitio estático (lo que se publica)
│  ├─ index.html
│  ├─ shared/                  Piezas reutilizables para las demás demos
│  │  ├─ time/panama.js        Fechas en America/Panama (UTC-5), independientes del navegador
│  │  ├─ storage/storage.js    localStorage con try/catch y respaldo en memoria
│  │  ├─ chat-engine/          nlu.js (lenguaje del guion) · ai-adapter.js (/api/chat con respaldo)
│  │  ├─ whatsapp-sim/         Marco de teléfono: burbujas, hora, doble check, «escribiendo…», adjuntos
│  │  └─ ui/                   Banner, avisos, diálogos, modo Presentación, íconos SVG y base.css (sistema visual)
│  ├─ assets/fonts/            Inter (tipografía, licencia SIL OFL incluida); se sirve desde el propio sitio
│  └─ app/                     Lo propio de esta demo
│     ├─ data/                 templates.js (3 giros) · seed.js (datos semilla)
│     ├─ agenda.js · bot.js · ai.js · controller.js · followups.js · privacy.js · state.js
│     ├─ views/                home · demo · admin (+ agenda, conversaciones, seguimiento, configuración)
│     └─ ui/                   panel «En vivo», ventana de cita
├─ scripts/serve.mjs           Servidor local sin dependencias
├─ tests/                      71 pruebas (node:test)
└─ netlify.toml · .env.example
```

`public/shared/` no depende de nada de `public/app/`: se puede copiar tal cual a las otras demos.

**Diseño.** Sistema claro de bordes finos: lienzo blanco, contenedores definidos por una línea de 1 px (`#cdcdcd`; `#999` en controles) en lugar de sombras,
tarjetas de 12 px, botones de 8 px, etiquetas en píldora y titulares en Inter peso 500. La letra base crece con la pantalla (16 px en móvil, 17 px en portátil, 18 px en monitor grande).
La portada pone primero el selector de giro, un titular de dos líneas y el botón «Probar el asistente» (se ve sin desplazarse en 1366 × 768 y en móvil); a partir de 1280 px se reparte en dos columnas (texto a la izquierda; teléfono con la conversación y agenda de mañana a la derecha) para no dejar blanco a los lados, y por debajo se apila y se centra. En «Cómo funciona», cada paso trae un fragmento verdadero (la respuesta real del asistente, el mensaje de confirmación de la configuración y la agenda). Los colores, radios y la escala tipográfica son
variables CSS en `public/shared/ui/base.css`. El acento es la marca de cada giro (`--brand`, `--brand-soft`, `--accent`…), que `main.js`
aplica desde la paleta de `public/app/data/templates.js`; las acciones de la clínica (probar el asistente, nueva cita, confirmar, crear, mover) van en ese color
(`.btn--accent`) y el negro (`.btn--primary`) queda para los controles de la demo: Presentación, Reiniciar demo y controles de la demo. Los íconos son SVG propios
(`public/shared/ui/icons.js`): en la interfaz no hay emojis, solo dentro de los mensajes del bot.

**Acabados.** La capa final `public/app/polish.css` (se carga al final) define tiempos y curvas tipo resorte, sombras pequeñas en capas, el color de estado
de las citas, el chat con burbujas agrupadas (cola, hora y checks dentro), el «Horario libre» de la portada que se convierte en la cita, los diálogos con salida
y el cambio de giro con fundido. `motion.js` aporta `flip` (lo que ya estaba se desliza a su sitio nuevo), `rollTo` (cifras que ruedan) y `withTransition`.

**Movimiento.** La portada entra por etapas y su vista del producto cuenta una historia en bucle (el paciente escribe, el asistente
agenda y su cita entra a la agenda de al lado); los bloques de «Cómo funciona» aparecen al hacer scroll, las cifras del panel cuentan
hasta su valor y las citas del calendario entran escalonadas. Todo vive en `public/shared/ui/motion.js` y en el bloque «Movimiento» de
`public/app/app.css`; casi todo es opacidad y transformaciones (la fila nueva de la tabla también abre su altura). Con «reducir movimiento» activado en el sistema, nada se mueve: la
portada muestra la historia ya terminada.

---

## 6. Cobertura de los requerimientos (demo 01)

| ID | Requerimiento | Estado |
| --- | --- | --- |
| CIT-RF-01 | Selector de giro | ✅ Cambia marca, logo, paleta, servicios, profesionales y textos; se conserva al recargar |
| CIT-RF-02 / 03 / 04 | Menú, agendar, mascota | ✅ Probado en los 3 giros |
| CIT-RF-05 | Recordatorio «Simular día anterior» | ✅ También por cita en «Recordatorios programados» |
| CIT-RF-06 | Reprogramar y cancelar desde el chat | ✅ El horario liberado vuelve a ofrecerse |
| CIT-RF-07 | Urgencias con palabras configurables | ✅ |
| CIT-RF-08 | Seguimientos por giro | ✅ Con envío simulado |
| CIT-RF-09 | Precios, horarios y ubicación desde la configuración | ✅ Si falta un dato, el bot lo dice y ofrece una persona |
| CIT-RF-10 | Calendario por profesional, mover con botones y arrastrando | ✅ Validado contra la agenda |
| CIT-RF-11 | 6 estados con historial | ✅ |
| CIT-RF-12 | 4 indicadores | ✅ Fórmulas explicadas en el panel |
| CIT-RF-13 | Configuración editable | ✅ Con validación de campos vacíos |
| CIT-RF-14 | Bandeja (urgentes y derivadas arriba) | ✅ |
| CIT-RF-15 | Panel «En vivo» junto al teléfono | ✅ |
| CIT-RNF-02 | Nunca dos citas en el mismo horario del mismo profesional | ✅ Una sola regla (`slotProblem`) usada por el bot, la IA, el panel y el arrastre; probada |
| CIT-RNF-03 | La cita aparece en el panel en menos de 1 s | ✅ Se crea antes de que el bot «termine de escribir» |

---

## 7. Qué se verificó y qué no

**Verificado:** 72 pruebas automáticas (lenguaje, agenda, bot en los 3 giros, urgencias, privacidad, almacenamiento bloqueado,
función `/api/chat` con un cliente de prueba, acciones de la IA) y un recorrido en Edge (headless) de 55 comprobaciones: portada,
chat por la interfaz y con la tecla Enter, panel, arrastrar una cita, configuración, los 3 giros, modo Presentación (incluido
«Anterior»), reinicio, `localStorage` bloqueado, etiquetas de formularios y cero errores de consola; 7 anchos (360, 390, 768, 1024, 1280, 1440 y
1920 px) en las 6 pantallas sin desborde horizontal; el movimiento de la portada y del panel (22 comprobaciones). Contraste de colores calculado: todos los pares ≥ 4.5:1 (AA). JavaScript del sitio: ≈ 77 KB comprimido.

**No verificado (pendiente):**
- Una llamada **real** a la API de Claude (no hay clave en este equipo): el flujo de IA se probó con un cliente de prueba.
- Despliegue real en Netlify y el subdominio `citas-whatsapp-demo.vercel.app`.
- Lighthouse, Firefox, Safari iOS y un teléfono real.
- Uso con lector de pantalla (se cuidó semántica, etiquetas y foco, pero no se probó con uno).

**Es simulado:** WhatsApp, recordatorios, avisos, pagos (Yappy, tarjeta, ACH y efectivo) y la «IA» del modo guion.

**Para producción (siguientes pasos que se venden):** los mensajes que la clínica inicia (recordatorios y seguimientos) fuera
de la ventana de conversación de WhatsApp Business requieren **plantillas aprobadas** (validarlo al cotizar), y si la clínica ya
usa un software de agenda, el paso siguiente es integrarlo en vez de usar este panel.

---

## 8. Subirlo a git

```bash
git add .
git commit -m "Demo de citas por WhatsApp para clínicas"
git remote add origin <URL-del-repositorio>
git push -u origin main
```

## Despliegue

Publicado en Vercel (https://citas-whatsapp-demo.vercel.app). Cada `git push` a `main` despliega solo; `vercel.json` fija `public` como salida y no hay paso de compilación. El modo IA real necesita la variable `ANTHROPIC_API_KEY` en Vercel (sin ella la demo sigue en modo guion).
