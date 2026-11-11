// Privacidad (CIT-RNF-01): no se piden ni se guardan diagnósticos, síntomas ni datos clínicos.
// Solo nombre, teléfono, servicio, hora y, en veterinaria, nombre/especie/edad de la mascota.
// Un mensaje que parezca contener datos de salud se muestra en el teléfono durante la sesión,
// pero lo que se guarda (y lo que podría ir a la IA) es un texto genérico.
import { matchesAny } from '../shared/chat-engine/nlu.js';

export const REDACTED_TEXT = '🔒 Mensaje no guardado por privacidad (posible dato de salud)';

const CLINICAL = [
  'dolor', 'duele', 'duelen', 'sintoma*', 'diagnostic*', 'fiebre', 'vomit*', 'medicament*', 'alergi*', 'inflamacion', 'herida*', 'lesion*',
  'enfermedad*', 'infeccion', 'sangr*', 'receta*', 'pastilla*', 'cirugia', 'embarazo', 'embarazada', 'diarrea', 'cojea', 'cojera', 'tos', 'mareo*',
];

export const looksClinical = (text) => matchesAny(text, CLINICAL, false);

export const PRIVACY_TIP = 'Por privacidad, no escriba síntomas ni diagnósticos por este medio: solo necesitamos su nombre, teléfono, servicio y hora.';
