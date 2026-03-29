// extensions/dental-cpr/src/components/DicomImport.tsx
import React, { useRef, useState } from 'react';
import { Colors, Font, Border, Radius } from '../utils/designTokens';
import { OrthancClient } from '../utils/orthancClient';

interface Props {
  client: OrthancClient;
  onImported: () => void;
}

type ImportStatus = 'idle' | 'uploading' | 'success' | 'error';

export default function DicomImport({ client, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [message, setMessage] = useState('');

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setStatus('uploading');
    setMessage(`Lade ${files.length} Datei(en) hoch…`);
    let errors = 0;
    for (const file of Array.from(files)) {
      try {
        await client.uploadDicom(file);
      } catch (e: any) {
        errors++;
        console.error('[DicomImport]', e);
      }
    }
    if (errors === 0) {
      setStatus('success');
      setMessage(`${files.length} Datei(en) erfolgreich importiert.`);
      onImported();
      setTimeout(() => setStatus('idle'), 3000);
    } else {
      setStatus('error');
      setMessage(`${errors} Datei(en) konnten nicht importiert werden.`);
    }
  };

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".dcm,.zip"
        multiple
        style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)}
      />

      {/* Toast */}
      {status !== 'idle' && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 10000,
          background: status === 'error' ? '#2a1515' : '#151a15',
          border: `1px solid ${status === 'error' ? Colors.offline : Colors.online}`,
          borderRadius: Radius.md, padding: '10px 16px',
          color: status === 'error' ? Colors.offline : Colors.online,
          fontFamily: Font.family, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        }}>
          {status === 'uploading' && <Spinner />}
          {status === 'success' && '✓'}
          {status === 'error' && '✕'}
          {message}
          {status === 'error' && (
            <button onClick={() => inputRef.current?.click()} style={{ background: 'none', border: 'none', color: Colors.offline, cursor: 'pointer', fontSize: 11, textDecoration: 'underline', padding: 0 }}>
              Wiederholen
            </button>
          )}
          <button onClick={() => setStatus('idle')} style={{ background: 'none', border: 'none', color: Colors.textDim, cursor: 'pointer', fontSize: 14, padding: '0 0 0 4px' }}>×</button>
        </div>
      )}
    </>
  );
}

export function useDragDrop(onFiles: (files: FileList) => void) {
  const [dragging, setDragging] = useState(false);

  const handlers = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragging(true); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
    },
  };

  return { dragging, handlers };
}

function Spinner() {
  return <div style={{ width: 14, height: 14, border: `2px solid rgba(255,255,255,0.2)`, borderTopColor: Colors.online, borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />;
}
