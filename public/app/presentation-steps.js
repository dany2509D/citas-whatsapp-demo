// Guion del modo Presentación (≈ 2 minutos). Sigue el guion de la reunión:
// giro → agendar → recordatorio y confirmación → urgencia → panel → cierre.
import { LINKS } from '../shared/ui/ui.js';

const PER_GIRO = {
  fisio: { service: 'sesión de terapia', urgent: 'tengo un dolor fuerte en la espalda' },
  dental: { service: 'limpieza', urgent: 'tengo un dolor fuerte en una muela' },
  vet: { service: 'vacuna', urgent: 'mi perro se tragó algo y está vomitando' },
};

export function buildSteps(app) {
  const { controller: ctl, store } = app;
  const g = () => PER_GIRO[store.state.giro];
  const send = (text, inst) => ctl.sendUser(text, inst ? { speed: 0 } : undefined);
  const vet = () => store.state.giro === 'vet';

  return [
    {
      title: 'Elija el giro del prospecto',
      note: 'La demo cambia marca, servicios, profesionales y textos del bot. Así la clínica reconoce su negocio en la pantalla. (Se reinició la demo para empezar desde cero.)',
      highlight: '.giro-picker',
      run: () => app.navigate('#/'),
    },
    {
      title: 'Una pantalla: WhatsApp y panel',
      note: 'A la izquierda, el WhatsApp de la clínica. A la derecha, lo que ve la recepción en vivo: agenda, recordatorios y cada cambio que provoca el chat.',
      highlight: ['.wa-device', '.live__head'],
      run: () => app.navigate('#/demo'),
    },
    {
      title: 'El paciente escribe como habla',
      note: 'No tiene que usar el menú: el asistente entiende «una cita para mañana», con o sin tildes, y pregunta lo que falta.',
      highlight: '.wa-device',
      run: ({ instant }) => send('Hola, quiero una cita para mañana', instant),
    },
    {
      title: 'Servicio y profesional',
      note: 'Pregunta el servicio y ofrece elegir profesional o «el primero disponible».',
      highlight: '.wa-device',
      run: async ({ instant }) => { await send(g().service, instant); },
    },
    {
      title: 'Tres horarios libres reales',
      note: 'Los horarios salen de la agenda de verdad: si alguien ya lo tomó, no se ofrece. Nunca se asigna un horario dos veces al mismo profesional.',
      highlight: '.wa-chat',
      run: ({ instant }) => send('el primero disponible', instant),
    },
    {
      title: 'Solo lo necesario',
      note: 'Solo pide el nombre (y los datos básicos de la mascota en veterinaria): el teléfono es el del WhatsApp desde el que escribe, y el resumen lo muestra. Nunca síntomas ni diagnósticos: la privacidad es parte del diseño.',
      highlight: '.wa-device',
      run: async ({ instant }) => {
        await send('1', instant); await send('Ana Pérez', instant);
        if (vet()) { await send('Max', instant); await send('perro', instant); await send('3 años', instant); }
      },
    },
    {
      title: 'Confirma y la cita aparece en el panel',
      note: 'Al confirmar, la cita queda creada al instante: mire el panel de la derecha. Estado «Pendiente», origen «chat».',
      highlight: ['.live .feed'],
      run: ({ instant }) => send('sí', instant),
    },
    {
      title: 'Un día antes: recordatorio automático',
      note: 'El asistente recuerda la cita y pide confirmar: «¿Confirma? 1. Sí 2. Reprogramar». Con esto bajan las ausencias.',
      highlight: '.tools',
      run: () => ctl.simulateDayBefore(),
    },
    {
      title: 'Responde «Sí» y cambia el estado',
      note: 'La respuesta actualiza la cita a «Confirmada» en el panel, sin que nadie del equipo tenga que llamar.',
      highlight: ['.live .feed'],
      run: ({ instant }) => send('1', instant),
    },
    {
      title: 'Urgencias: el bot no agenda',
      note: 'Si detecta una urgencia, no agenda: da el número que corresponde (el de la clínica en su horario de atención; fuera de horario, el de emergencias que la clínica configuró), marca la conversación como URGENTE y ofrece pasar a una persona. Lo escrito se guarda sin detalles de salud.',
      highlight: ['.wa-device', '.live .feed'],
      run: ({ instant }) => send(g().urgent, instant),
    },
    {
      title: 'Una persona revisa lo importante',
      note: '«Pasar a una persona» deja la conversación marcada para la recepción. El asistente ayuda; las personas atienden lo que importa.',
      highlight: '.wa-human',
      run: () => ctl.requestHandoff(),
    },
    {
      title: 'Panel de recepción: indicadores',
      note: 'Citas de la semana, porcentaje confirmado, citas reprogramadas con aviso (ausencias evitadas) y conversaciones que pasaron a una persona.',
      highlight: '.kpis',
      run: async () => { app.admin.enter(); await app.navigate('#/admin/agenda'); },
    },
    {
      title: 'Calendario por profesional',
      note: 'Semana por profesional; mueva citas arrastrando o con botones. Al cancelar o reprogramar, el horario liberado vuelve a estar disponible.',
      highlight: '.cal-scroll',
      run: () => app.navigate('#/admin/agenda'),
    },
    {
      title: 'Bandeja de conversaciones',
      note: 'Las urgentes y las derivadas a una persona aparecen arriba. Allí la recepción responde y marca como atendida.',
      highlight: '.inbox',
      run: () => app.navigate('#/admin/conversaciones'),
    },
    {
      title: 'Cierre',
      note: 'Sus pacientes agendan y confirman solos por WhatsApp; su equipo solo atiende lo que necesita una persona. ¿Agendamos un diagnóstico gratis de 30 minutos?',
      highlight: '.demo-banner__cta',
      link: { label: 'Agendar diagnóstico gratis', href: LINKS.diagnostico },
      dwell: 8000,
      run: () => app.navigate('#/'),
    },
  ];
}
