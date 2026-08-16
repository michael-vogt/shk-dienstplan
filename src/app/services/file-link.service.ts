import { Service, signal } from '@angular/core';

/**
 * Verknüpft den Dienstplan mit einer echten lokalen Datei, sofern der
 * Browser die File System Access API unterstützt (Chrome, Edge, Opera).
 * Firefox unterstützt sie grundsätzlich nicht, Safari nur ein für den
 * Nutzer unsichtbares Sandbox-Dateisystem — in beiden Fällen bleibt
 * `localStorage` die einzige Möglichkeit, und dieser Dienst tut dann nichts.
 *
 * Die Verknüpfung selbst (welche Datei es ist) liegt in IndexedDB, weil ein
 * `FileSystemFileHandle` sich nicht in localStorage speichern lässt — es ist
 * kein einfacher Wert, sondern ein Objekt mit Berechtigungen.
 */

const DB_NAME = 'shk-dienstplan-files';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'linked-file';

type PickerWindow = Window &
  typeof globalThis & {
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle>;
};

@Service()
export class FileLinkService {
  /** `null` = noch nicht geprüft, `true`/`false` = Ergebnis der Prüfung. */
  readonly supported = typeof (window as PickerWindow).showSaveFilePicker === 'function';

  /** Name der verknüpften Datei, oder `null` ohne Verknüpfung. */
  readonly linkedFileName = signal<string | null>(null);

  /**
   * Zuletzt beim Schreiben aufgetretener Fehler, etwa weil die Datei
   * gelöscht oder die Berechtigung entzogen wurde. Wird von der Oberfläche
   * angezeigt; ein erfolgreicher Schreibvorgang setzt sie wieder zurück.
   */
  readonly writeError = signal<string | null>(null);

  private handle: FileSystemFileHandle | null = null;

  /** Versucht beim Start, eine frühere Verknüpfung stillschweigend wiederherzustellen. */
  async restoreLink(): Promise<void> {
    if (!this.supported) return;
    try {
      const handle = await this.loadHandle();
      if (!handle) return;
      // 'query' statt 'request': hier soll noch kein Berechtigungsdialog
      // aufploppen, das passiert erst auf einen ausdrücklichen Klick hin.
      const permission = await (
        handle as unknown as {
          queryPermission: (o: { mode: string }) => Promise<PermissionState>;
        }
      ).queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') return;
      this.handle = handle;
      this.linkedFileName.set(handle.name);
    } catch {
      // Kein Zugriff mehr möglich (Datei verschoben, Berechtigung entzogen):
      // die App fällt kommentarlos auf localStorage zurück.
    }
  }

  /** Öffnet den Auswahldialog und verknüpft die App mit der gewählten Datei. */
  async chooseFile(suggestedName: string, initialContent: string): Promise<boolean> {
    if (!this.supported) return false;
    try {
      const picker = (window as PickerWindow).showSaveFilePicker!;
      const handle = await picker({
        suggestedName,
        types: [{ description: 'Dienstplan-Daten', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(initialContent);
      await writable.close();
      this.handle = handle;
      this.linkedFileName.set(handle.name);
      this.writeError.set(null);
      await this.saveHandle(handle);
      return true;
    } catch (err) {
      // Vom Nutzer abgebrochen (AbortError) oder anderer Fehler — beides
      // bedeutet schlicht: keine Verknüpfung zustande gekommen.
      if ((err as { name?: string })?.name !== 'AbortError') {
        console.error('Datei konnte nicht verknüpft werden', err);
      }
      return false;
    }
  }

  unlink(): void {
    this.handle = null;
    this.linkedFileName.set(null);
    this.writeError.set(null);
    void this.deleteHandle();
  }

  get isLinked(): boolean {
    return !!this.handle;
  }

  /** Schreibt den Inhalt in die verknüpfte Datei. Kein No-op-Fallback hier — der Aufrufer entscheidet, was ohne Verknüpfung passiert. */
  async write(content: string): Promise<void> {
    if (!this.handle) return;
    try {
      const writable = await this.handle.createWritable();
      await writable.write(content);
      await writable.close();
      this.writeError.set(null);
    } catch (err) {
      this.writeError.set(
        'Schreiben in die verknüpfte Datei fehlgeschlagen. Die Daten bleiben im Browser ' +
        'gespeichert; auf „Erneut verknüpfen" klicken, um die Datei neu auszuwählen.',
      );
      console.error('Schreiben in verknüpfte Datei fehlgeschlagen', err);
    }
  }

  async read(): Promise<string | null> {
    if (!this.handle) return null;
    try {
      const file = await this.handle.getFile();
      return await file.text();
    } catch (err) {
      console.error('Lesen der verknüpften Datei fehlgeschlagen', err);
      return null;
    }
  }

  // --- IndexedDB: Ablage des Handles zwischen Sitzungen ---------------------

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async saveHandle(handle: FileSystemFileHandle): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      // Die Verknüpfung funktioniert auch ohne, dass sie den Neustart
      // übersteht — dann muss beim nächsten Laden nur erneut gewählt werden.
      console.error('Dateiverknüpfung konnte nicht gemerkt werden', err);
    }
  }

  private async loadHandle(): Promise<FileSystemFileHandle | null> {
    try {
      const db = await this.openDb();
      const handle = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
        request.onsuccess = () => resolve((request.result as FileSystemFileHandle) ?? null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return handle;
    } catch {
      return null;
    }
  }

  private async deleteHandle(): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      // Kein Problem, wenn das Aufräumen scheitert — die Verknüpfung im
      // Arbeitsspeicher ist ohnehin schon aufgehoben.
    }
  }
}
