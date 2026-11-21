// Los tres giros de la demo. Marcas, personas y teléfonos son ficticios (+507 6000-xxxx).
// Todo lo que aquí aparece como "config" se puede editar luego desde el panel.

const URGENT_COMMON = [
  'dolor fuerte', 'dolor intenso', 'mucho dolor', 'sangrado', 'sangrando', 'sangra mucho', 'hemorragia', 'accidente',
  'no respira', 'no puede respirar', 'envenenamiento', 'envenen*', 'intoxicacion', 'desmayo', 'convulsion*', 'inconsciente', 'emergencia',
  // Dolor muy intenso (la negación "ya no me duele mucho" se descarta antes de comparar; ver stripNegatedPain en nlu.js).
  'me duele much*', 'me duelen much*', 'duele much*', 'duelen much*', 'dolor insoportable', 'insoportable',
];

const MSG_COMMON = {
  greeting: '¡Hola! 👋 Soy el asistente virtual de {clinica}. ¿En qué le puedo ayudar hoy?',
  pricesIntro: 'Estos son nuestros servicios y precios:',
  pricesOutro: 'Pagos en la clínica con Yappy, tarjeta, ACH o efectivo (en esta demo no se procesa ningún pago).',
  location: 'Nos encontramos en {direccion}.\nPara llamarnos: {telefono}.\n\nHorario de atención:\n{horario}',
  urgent: 'Por lo que describe, esto puede ser una urgencia. Por favor llame ahora al {telefono} o acuda al servicio de urgencias más cercano.\n\nPor este medio no agendo urgencias. ¿Desea que una persona del equipo le contacte?',
  handoff: 'Con gusto. Una persona del equipo de {clinica} le escribirá por este chat en horario de atención. Si desea volver al asistente, escriba «menú».',
  confirm: '✅ Listo, {nombre}. Su cita quedó agendada:\n📅 {fecha} a las {hora}\n🩺 {servicio} con {profesional}\n\nLe enviaremos un recordatorio el día anterior. ¡Le esperamos!',
  reminder: 'Hola {nombre}, le recordamos su cita {cuando} a las {hora} ¿Confirma?\n1. Sí\n2. Reprogramar',
};

export const TEMPLATES = {
  fisio: {
    id: 'fisio',
    giro: 'Fisioterapia',
    name: 'Centro de Fisioterapia Movimiento',
    short: 'Movimiento',
    tagline: 'Recupere su movimiento con un equipo que le acompaña.',
    palette: { brand: '#0b6e6e', brandDark: '#084f4f', soft: '#e1f1ef', accent: '#e8743b', onAccent: '#1a1a1a', ink: '#0f2a2a' },
    phone: '+507 6000-1000',
    // Persona ficticia del chat (quien escribe por WhatsApp en la demo). Su nombre y teléfono NO coinciden con ningún paciente de la semilla.
    persona: { name: 'Carolina Vallarino', phone: '6000-1900' },
    telefonoEmergenciasFueraDeHorario: '911',
    address: 'Vía Ejemplo, Edificio Plaza Movimiento, consultorio 204, Ciudad de Panamá',
    hours: { 1: ['08:00', '17:00'], 2: ['08:00', '17:00'], 3: ['08:00', '17:00'], 4: ['08:00', '17:00'], 5: ['08:00', '17:00'], 6: ['08:00', '12:00'], 0: null },
    services: [
      { id: 'evaluacion', name: 'Evaluación inicial', minutes: 60, price: 35, itbms: false, kw: ['evaluacion', 'valoracion', 'primera vez', 'primera cita', 'revision inicial'] },
      { id: 'sesion', name: 'Sesión de terapia', minutes: 45, price: 30, itbms: false, countsPackage: true, kw: ['sesion', 'terapia', 'fisioterapia', 'tratamiento', 'rehabilitacion'] },
      { id: 'paquete', name: 'Paquete de 10 sesiones', minutes: 45, price: 250, itbms: false, sessions: 10, countsPackage: true, kw: ['paquete', '10 sesiones', 'diez sesiones', 'bono'] },
      { id: 'control', name: 'Control de progreso', minutes: 30, price: 20, itbms: false, kw: ['control', 'seguimiento', 'progreso', 'reevaluacion'] },
    ],
    pros: [
      { id: 'p1', name: 'Lcda. Marisol Quintero', specialty: 'Fisioterapia deportiva', days: [1, 2, 3, 4, 5], services: ['evaluacion', 'sesion', 'paquete', 'control'] },
      { id: 'p2', name: 'Lcdo. Andrés Batista', specialty: 'Terapia manual', days: [1, 2, 3, 4, 6], services: ['evaluacion', 'sesion', 'paquete', 'control'] },
      { id: 'p3', name: 'Lcda. Karina Ortega', specialty: 'Fisioterapia general', days: [2, 3, 4, 5, 6], services: ['evaluacion', 'sesion', 'control'] },
    ],
    urgent: [...URGENT_COMMON, 'caida fuerte', 'no puedo mover', 'fractura', 'hueso roto', 'se me durmio todo'],
    messages: {
      ...MSG_COMMON,
      followup: 'Hola {nombre}, le quedan 2 sesiones de su paquete en {clinica}. ¿Desea agendar la próxima o renovar su paquete?\n1. Agendar sesión\n2. Más tarde',
    },
    starters: ['Hola 👋', 'Quiero una cita para mañana', '¿Cuánto cuesta una sesión?'],
    followupRule: 'Aviso cuando quedan 2 sesiones del paquete',
    followupService: 'sesion',
    patients: [
      ['Lucía Barría', 'paq', 8], ['Gabriel Samaniego', 'paq', 3], ['Daniela Cortés', 'paq', 8], ['Iván Moreno', null], ['Rosa Elena Vergara', 'paq', 5],
      ['Carlos Pitti', null], ['Sofía Araúz', 'paq', 6], ['Javier Bernal', null], ['Mónica Tejeira', 'paq', 2], ['Alonso De Gracia', null],
      ['Yaritza Montenegro', 'paq', 6], ['Pedro Caballero', null], ['Ana Cecilia Rovira', 'paq', 8], ['Héctor Sáez', null], ['Camila Lasso', 'paq', 4],
    ],
  },

  dental: {
    id: 'dental',
    giro: 'Odontología',
    name: 'Clínica Dental Sonrisa',
    short: 'Sonrisa',
    tagline: 'Cuidamos su sonrisa en cada visita.',
    palette: { brand: '#1f5fbf', brandDark: '#16448c', soft: '#e4eefb', accent: '#f2b544', onAccent: '#1a1a1a', ink: '#12213a' },
    phone: '+507 6000-2000',
    persona: { name: 'Elena Montalvo', phone: '6000-2900' },
    telefonoEmergenciasFueraDeHorario: '911',
    address: 'Calle Ejemplo y Avenida Central, Plaza Sonrisa, local 12, Ciudad de Panamá',
    hours: { 1: ['08:00', '18:00'], 2: ['08:00', '18:00'], 3: ['08:00', '18:00'], 4: ['08:00', '18:00'], 5: ['08:00', '18:00'], 6: ['08:00', '13:00'], 0: null },
    services: [
      { id: 'evaluacion', name: 'Evaluación', minutes: 30, price: 25, itbms: false, kw: ['evaluacion', 'revision', 'chequeo', 'valoracion', 'primera vez', 'consulta'] },
      { id: 'limpieza', name: 'Limpieza', minutes: 45, price: 40, itbms: false, kw: ['limpieza', 'profilaxis', 'limpiar', 'sarro'] },
      { id: 'blanqueamiento', name: 'Blanqueamiento', minutes: 60, price: 150, itbms: true, kw: ['blanqueamiento', 'blanquear', 'aclarar'] },
      { id: 'ortodoncia', name: 'Control de ortodoncia', minutes: 30, price: 45, itbms: false, kw: ['ortodoncia', 'brackets', 'frenillos', 'control', 'ajuste'] },
    ],
    pros: [
      { id: 'p1', name: 'Dra. Valeria Cedeño', specialty: 'Odontología general', days: [1, 2, 3, 4, 5], services: ['evaluacion', 'limpieza'] },
      { id: 'p2', name: 'Dr. Ricardo Mendieta', specialty: 'Ortodoncia', days: [1, 3, 4, 5, 6], services: ['evaluacion', 'ortodoncia'] },
      { id: 'p3', name: 'Dra. Lorena Salazar', specialty: 'Estética dental', days: [2, 3, 4, 5, 6], services: ['evaluacion', 'limpieza', 'blanqueamiento'] },
    ],
    urgent: [...URGENT_COMMON, 'diente roto', 'se me cayo el diente', 'se me cayo un diente', 'muela quebrada', 'cara hinchada', 'hinchazon en la cara',
      'me hincho la cara', 'cara inflamada', 'se me parti*', 'se partio', 'partid*', 'quebr*', 'fractur*', 'absceso', 'fiebre', 'se me salio el diente', 'se me salio un diente'],
    messages: {
      ...MSG_COMMON,
      followup: 'Hola {nombre}, ya pasaron 6 meses desde su última limpieza en {clinica}. ¿Desea agendar la próxima?\n1. Sí, agendar\n2. Más tarde',
    },
    starters: ['Hola 👋', 'Quiero una limpieza para mañana', '¿Cuánto cuesta el blanqueamiento?'],
    followupRule: 'Recordatorio de limpieza a los 6 meses',
    followupService: 'limpieza',
    patients: [
      ['Valentina Cano', 6], ['Miguel Ángel Ríos', 7], ['Estefanía Quiel', 5], ['Rodrigo Atencio', null], ['Paola Guardia', 6],
      ['Fernando Jaén', 8], ['Marisela Ábrego', null], ['Esteban Villalaz', 6], ['Nathalie Castrellón', 4], ['Óscar Tuñón', 7],
      ['Génesis Pimentel', null], ['Ramón Sanjur', 6], ['Isabel Chong', 3], ['Julio Bethancourt', null], ['Aidée Caballero', 6],
    ],
  },

  vet: {
    id: 'vet',
    giro: 'Veterinaria',
    name: 'Veterinaria Patitas',
    short: 'Patitas',
    tagline: 'Cuidado cercano para quienes más quiere.',
    palette: { brand: '#b8470f', brandDark: '#8a3409', soft: '#fbebdf', accent: '#2e7d5b', onAccent: '#ffffff', ink: '#2b1a10' },
    phone: '+507 6000-3000',
    persona: { name: 'Diego Arosemena', phone: '6000-3900' },
    telefonoEmergenciasFueraDeHorario: '+507 6000-3911', // veterinaria de turno 24 h (ficticia)
    address: 'Avenida Ejemplo, Centro Comercial Patitas, local 5, Ciudad de Panamá',
    hours: { 1: ['08:00', '17:00'], 2: ['08:00', '17:00'], 3: ['08:00', '17:00'], 4: ['08:00', '17:00'], 5: ['08:00', '17:00'], 6: ['08:00', '14:00'], 0: null },
    services: [
      { id: 'consulta', name: 'Consulta', minutes: 30, price: 25, itbms: false, kw: ['consulta', 'revision', 'chequeo', 'ver a'] },
      { id: 'vacuna', name: 'Vacuna', minutes: 20, price: 18, itbms: false, kw: ['vacuna', 'vacunar', 'vacunacion', 'refuerzo'] },
      { id: 'desparasitacion', name: 'Desparasitación', minutes: 20, price: 12, itbms: false, kw: ['desparasitacion', 'desparasitar', 'pulgas', 'garrapatas', 'parasitos'] },
      { id: 'bano', name: 'Baño', minutes: 45, price: 20, itbms: true, kw: ['bano', 'banar', 'banarlo', 'peluqueria', 'grooming', 'corte de pelo'] },
    ],
    pros: [
      { id: 'p1', name: 'Dr. Esteban Villarreal', specialty: 'Medicina general', days: [1, 2, 3, 4, 5], services: ['consulta', 'vacuna', 'desparasitacion'] },
      { id: 'p2', name: 'Dra. Natalia Pineda', specialty: 'Medicina preventiva', days: [1, 3, 4, 5, 6], services: ['consulta', 'vacuna', 'desparasitacion'] },
      { id: 'p3', name: 'Gabriela Rojas', specialty: 'Baño y estética', days: [2, 3, 4, 5, 6], services: ['bano'] },
    ],
    urgent: [...URGENT_COMMON, 'se trago', 'vomitando', 'vomito con sangre', 'atropell*', 'veneno', 'no puede caminar', 'golpe fuerte',
      'chocolate', 'uvas', 'xilitol', 'raticida', 'no come', 'no orina', 'no puede orinar', 'parto', 'ingirio'],
    messages: {
      ...MSG_COMMON,
      confirm: '✅ Listo, {nombre}. Su cita quedó agendada:\n📅 {fecha} a las {hora}\n🐾 {mascota}\n🩺 {servicio} con {profesional}\n\nLe enviaremos un recordatorio el día anterior. ¡Les esperamos!',
      followup: 'Hola {nombre} 🐾 Ya pasaron 12 meses desde la última vacuna de {mascota} en {clinica}. ¿Desea agendar la próxima?\n1. Sí, agendar\n2. Más tarde',
    },
    starters: ['Hola 👋', 'Quiero vacunar a mi perro', '¿Cuánto cuesta el baño?'],
    followupRule: 'Aviso de la próxima vacuna a los 12 meses',
    followupService: 'vacuna',
    patients: [
      ['Andrea Pinzón', 'Max', 'Perro', '4 años', 11], ['Luis Carlos Mosquera', 'Luna', 'Gata', '2 años', 5], ['Brenda Olmos', 'Toby', 'Perro', '7 años', 13],
      ['Ricardo Sandoval', 'Simba', 'Gato', '3 años', 12], ['Karen Delgado', 'Coco', 'Perro', '1 año', 3], ['Tomás Arjona', 'Nala', 'Perra', '5 años', 10],
      ['Yesenia Cedeño', 'Bruno', 'Perro', '9 años', 12], ['Dayra Mendoza', 'Mía', 'Gata', '8 meses', 2], ['Felipe Rangel', 'Rocky', 'Perro', '6 años', 9],
      ['Gisela Ortiz', 'Pelusa', 'Gata', '10 años', 14], ['Hugo Tello', 'Thor', 'Perro', '2 años', 7], ['Marta Quintero', 'Lola', 'Perra', '3 años', 12],
      ['Nelson Barrios', 'Chispa', 'Gata', '1 año', 4], ['Olga Espinosa', 'Canela', 'Perra', '4 años', 11], ['Pablo Núñez', 'Duque', 'Perro', '12 años', 6],
    ],
  },
};

export const GIROS = ['fisio', 'dental', 'vet'];
