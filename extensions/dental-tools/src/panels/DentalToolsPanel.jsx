import { useEffect, useState, useCallback } from 'react';
import { annotation, triggerAnnotationModified } from '@cornerstonejs/tools';
import { eventTarget } from '@cornerstonejs/core';
import { DENTAL_TOOTH_PICK_EVENT } from '../tools/ToothAnnotationTool';
import { getAllTeeth } from '../utils/fdi';

const FINDINGS = [
  { value: 'none',      label: 'Kein Befund' },
  { value: 'caries',    label: 'Karies'      },
  { value: 'crown',     label: 'Krone'       },
  { value: 'implant',   label: 'Implantat'   },
  { value: 'missing',   label: 'Fehlend'     },
  { value: 'rootCanal', label: 'WK-Behandlung'},
];

const ALL_TEETH = getAllTeeth();

export default function DentalToolsPanel({ servicesManager }) {
  const [pending, setPending] = useState(null);
  const [selectedTooth, setSelectedTooth] = useState(null);
  const [finding, setFinding] = useState('none');

  useEffect(() => {
    const handler = (evt) => {
      setPending(evt.detail);
      setSelectedTooth(null);
      setFinding('none');
    };
    eventTarget.addEventListener(DENTAL_TOOTH_PICK_EVENT, handler);
    return () => eventTarget.removeEventListener(DENTAL_TOOTH_PICK_EVENT, handler);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!pending || !selectedTooth) return;

    const ann = annotation.state.getAnnotation(pending.annotationUID);
    if (!ann) return;

    const findingLabel = FINDINGS.find(f => f.value === finding)?.label ?? '';
    const suffix = finding !== 'none' ? ` [${findingLabel.substring(0, 5).trimEnd()}]` : '';

    ann.data.toothNumber = selectedTooth.fdi;
    ann.data.finding = finding;
    ann.data.text = `${selectedTooth.fdi}${suffix}`;

    triggerAnnotationModified(ann, pending.element);
    setPending(null);
  }, [pending, selectedTooth, finding]);

  // FDI anatomical grid (patient view): Q1 Q2 top, Q3 Q4 bottom.
  // Q1/Q4 (patient's right) rendered right-to-left on screen; Q2/Q3 left-to-right.
  const renderGrid = () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      {[1, 2, 3, 4].map(q => {
        const teethInQ = ALL_TEETH.filter(t => t.quadrant === q);
        const orderedTeeth = (q === 1 || q === 4)
          ? [...teethInQ].reverse()
          : teethInQ;
        const meta = teethInQ[0];
        return (
          <div key={q}>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>
              {meta?.quadrantLabel}
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              {orderedTeeth.map(tooth => (
                <button
                  key={tooth.fdi}
                  onClick={() => setSelectedTooth(tooth)}
                  title={tooth.label}
                  style={{
                    width: 26, height: 26, fontSize: 9, padding: 0,
                    background: selectedTooth?.fdi === tooth.fdi ? '#2563eb' : '#1e293b',
                    color: selectedTooth?.fdi === tooth.fdi ? '#fff' : '#94a3b8',
                    border: '1px solid #334155', borderRadius: 3, cursor: 'pointer',
                  }}
                >
                  {tooth.fdi}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (!pending) {
    return (
      <div style={{ padding: 12, color: '#94a3b8', fontSize: 12 }}>
        <strong style={{ color: '#e2e8f0' }}>Dental Tools</strong>
        <p style={{ marginTop: 8 }}>Zahn-Annotation setzen → FDI-Picker erscheint hier.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <h3 style={{ color: '#e2e8f0', fontSize: 13, marginBottom: 10 }}>Zahn (FDI)</h3>
      {renderGrid()}
      <div style={{ marginTop: 10 }}>
        <label style={{ color: '#94a3b8', fontSize: 11 }}>Befund: </label>
        <select
          value={finding}
          onChange={e => setFinding(e.target.value)}
          style={{
            marginLeft: 6, background: '#1e293b', color: '#e2e8f0',
            border: '1px solid #334155', padding: '2px 6px', fontSize: 11,
          }}
        >
          {FINDINGS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>
      {selectedTooth && (
        <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 11 }}>
          {selectedTooth.label}
        </div>
      )}
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button
          onClick={handleConfirm}
          disabled={!selectedTooth}
          style={{
            padding: '5px 14px', fontSize: 12,
            background: selectedTooth ? '#2563eb' : '#334155',
            color: '#fff', border: 'none', borderRadius: 4,
            cursor: selectedTooth ? 'pointer' : 'default',
          }}
        >
          Bestätigen
        </button>
        <button
          onClick={() => setPending(null)}
          style={{
            padding: '5px 10px', fontSize: 12,
            background: 'transparent', color: '#94a3b8',
            border: '1px solid #334155', borderRadius: 4, cursor: 'pointer',
          }}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
