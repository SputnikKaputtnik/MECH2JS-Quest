import { useState } from 'react';
import { installOfflineShell, installPrivateData } from './questStorage.ts';
import { exportSaveBackup, importSaveBackup } from './diskStore.ts';
export function QuestSetup() {
  const [status,setStatus]=useState('Einmal mit USB-Verbindung installieren; danach dieselbe Adresse auf der Quest öffnen.');
  const [busy,setBusy]=useState(false);
  const backup=async()=>{
    try {
      const url=URL.createObjectURL(new Blob([await exportSaveBackup()],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='MW2-Spielstaende.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      setStatus('Spielstandsicherung zum Download bereit.');
    }catch(error){setStatus(String(error));}
  };
  const install=async()=>{
    setBusy(true);
    try {
      setStatus('Offline-App wird gespeichert …'); await installOfflineShell();
      const r=await installPrivateData(setStatus);
      setStatus(`Vollständig lokal gespeichert (${(r.bytes/1048576).toFixed(0)} MiB). ${r.persistent?'Dauerhafter Speicher wurde bewilligt.':'Dauerhafter Speicher wurde nicht bewilligt; der Browser kann Daten bei Speicherdruck entfernen.'} Zum Test Kabel entfernen und Spiel neu öffnen.`);
    } catch(error) {setStatus(String(error));}
    finally {setBusy(false);}
  };
  return <main style={{maxWidth:800,margin:'40px auto',padding:24,color:'white',font:'20px sans-serif'}}>
    <h1>MechWarrior 2 · Quest</h1><p>Private Offline-Installation</p>
    <p>Spieldaten bleiben auf diesem Gerät. Spielstände speichert das Spiel separat im Browser. Browserdaten nicht löschen.</p>
    <button disabled={busy} onClick={()=>void install()} style={{fontSize:22,padding:18}}>Auf dieser Quest speichern</button>
    <p role="status">{status}</p><p><a href="/">Spiel starten</a> · <a href="/?dev">Missionstest</a></p>
    <p><button disabled={busy} onClick={()=>void backup()}>Spielstände sichern</button></p>
    <label>Spielstände aus Sicherung ersetzen (überschreibt diese Browser-Spielstände): <input type="file" accept="application/json,.json" disabled={busy} onChange={e=>{
      const f=e.target.files?.[0];if(!f)return;setBusy(true);
      void f.text().then(importSaveBackup).then(()=>setStatus('Spielstände wiederhergestellt. Spiel neu öffnen.')).catch(error=>setStatus(String(error))).finally(()=>setBusy(false));
    }}/></label>
    <p>Menüs in VR: rechter Stick = Cursor, A/Trigger = Klick, X = Tastatur, B/Y = zurück.</p>
  </main>;
}
