// Logos SVG sencillos, inventados para la demo (no copian ninguna marca real).
import { svgFrom } from '../shared/ui/dom.js';
import { TEMPLATES } from './data/templates.js';

export function logoMarkup(giro) {
  const { brand, accent } = TEMPLATES[giro].palette;
  const open = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><rect width="48" height="48" rx="13" fill="${brand}"/>`;
  if (giro === 'fisio') {
    return `${open}<circle cx="32" cy="13" r="4.2" fill="#fff"/><path d="M10 35c0-8 5-14 12-14 3 0 5 1.2 7 3" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M17 40c0-5 3-9 8-9 4 0 6 3 6 6" stroke="${accent}" stroke-width="4" stroke-linecap="round" fill="none"/></svg>`;
  }
  if (giro === 'dental') {
    return `${open}<path d="M14 17c0-4 3-6 6-6 2 0 3 1 4 1s2-1 4-1c3 0 6 2 6 6 0 4-2 6-2.5 10-.5 4-1.5 9-4 9-2 0-2-6-3.5-6s-1.5 6-3.5 6c-2.5 0-3.5-5-4-9-.5-4-2.5-6-2.5-10z" fill="#fff"/><path d="M38 6l1.2 2.8L42 10l-2.8 1.2L38 14l-1.2-2.8L34 10l2.8-1.2z" fill="${accent}"/></svg>`;
  }
  return `${open}<ellipse cx="13.5" cy="23" rx="3.6" ry="4.6" fill="#fff" transform="rotate(-20 13.5 23)"/><ellipse cx="21" cy="15.5" rx="3.6" ry="4.8" fill="#fff"/><ellipse cx="29" cy="15.5" rx="3.6" ry="4.8" fill="#fff"/><ellipse cx="36.5" cy="23" rx="3.6" ry="4.6" fill="#fff" transform="rotate(20 36.5 23)"/><path d="M25 26c-5.500 0-10.500 4.600-10.500 9 0 3 2.600 4 5.600 3.200 1.600-.4 3-.9 4.900-.9s3.300.5 4.900.9c3 .8 5.600-.2 5.600-3.200 0-4.400-5-9-10.500-9z" fill="#fff"/></svg>`;
}

export const logoNode = (giro) => svgFrom(logoMarkup(giro));
