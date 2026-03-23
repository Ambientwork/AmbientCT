const POSITION_NAMES = {
  1: 'Mittlerer Schneidezahn',
  2: 'Seitlicher Schneidezahn',
  3: 'Eckzahn',
  4: 'Erster Prämolar',
  5: 'Zweiter Prämolar',
  6: 'Erster Molar',
  7: 'Zweiter Molar',
  8: 'Weisheitszahn',
};

const QUADRANT_META = {
  1: { jaw: 'upper', side: 'right', label: 'Oben rechts' },
  2: { jaw: 'upper', side: 'left',  label: 'Oben links'  },
  3: { jaw: 'lower', side: 'left',  label: 'Unten links' },
  4: { jaw: 'lower', side: 'right', label: 'Unten rechts'},
};

function isValidFDI(fdi) {
  const q = Math.floor(fdi / 10);
  const p = fdi % 10;
  return q >= 1 && q <= 4 && p >= 1 && p <= 8;
}

function getToothInfo(fdi) {
  if (!isValidFDI(fdi)) return null;
  const quadrant = Math.floor(fdi / 10);
  const position = fdi % 10;
  const { jaw, side, label: quadrantLabel } = QUADRANT_META[quadrant];
  return {
    fdi, quadrant, position,
    name: POSITION_NAMES[position],
    jaw, side, quadrantLabel,
    label: `${fdi} — ${POSITION_NAMES[position]}`,
  };
}

function getAllTeeth() {
  const teeth = [];
  for (const q of [1, 2, 3, 4]) {
    for (let p = 1; p <= 8; p++) {
      teeth.push(getToothInfo(q * 10 + p));
    }
  }
  return teeth;
}

module.exports = { isValidFDI, getToothInfo, getAllTeeth, POSITION_NAMES, QUADRANT_META };
