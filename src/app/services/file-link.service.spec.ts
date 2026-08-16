import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileLinkService } from './file-link.service';

/**
 * Minimaler IndexedDB-Ersatz für den Testlauf. Bewusst kein Paket wie
 * fake-indexeddb: das setzt einen generischen Struktur-Klon durch, der an
 * Funktionseigenschaften scheitert — echte Browser klonen einen
 * FileSystemFileHandle dagegen über fest eingebauten nativen Code, ganz ohne
 * diese Einschränkung. Ein Klon wäre hier also weniger realistisch als ein
 * einfacher Speicher per Referenz.
 */
function installFakeIndexedDb(): { restore: () => void } {
  const original = (globalThis as Record<string, unknown>)['indexedDB'];
  const store = new Map<string, unknown>();

  function makeRequest<T>(run: () => T) {
    const request = {
      result: undefined as T | undefined,
      error: null as Error | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    queueMicrotask(() => {
      try {
        request.result = run();
        request.onsuccess?.();
      } catch (err) {
        request.error = err as Error;
        request.onerror?.();
      }
    });
    return request;
  }

  const fakeIndexedDb = {
    open: (_name: string, _version: number) => {
      const db = {
        createObjectStore: () => {},
        transaction: (_store: string, _mode: string) => {
          const tx = {
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            objectStore: () => ({
              put: (value: unknown, key: string) => {
                queueMicrotask(() => {
                  store.set(key, value);
                  tx.oncomplete?.();
                });
              },
              get: (key: string) => makeRequest(() => store.get(key)),
              delete: (key: string) => {
                queueMicrotask(() => {
                  store.delete(key);
                  tx.oncomplete?.();
                });
              },
            }),
          };
          return tx;
        },
        close: () => {},
      };
      const request = {
        result: db,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  (globalThis as Record<string, unknown>)['indexedDB'] = fakeIndexedDb;
  return {
    restore: () => {
      (globalThis as Record<string, unknown>)['indexedDB'] = original;
    },
  };
}

/**
 * Simuliert einen FileSystemFileHandle so weit, wie der Dienst ihn nutzt:
 * Schreiben, Lesen und eine steuerbare Berechtigung. Kein echter Browser
 * verfügbar, aber die Logik um die Programmierschnittstelle herum — Fehler-
 * behandlung, Berechtigungsprüfung, IndexedDB-Ablage — ist genau das, was
 * hier zu prüfen ist.
 */
function makeFakeHandle(name: string, initialContent = '') {
  let content = initialContent;
  let permission: PermissionState = 'granted';
  let failNextWrite = false;

  const handle = {
    name,
    kind: 'file' as const,
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
    createWritable: vi.fn(async () => {
      if (failNextWrite) throw new Error('Schreibfehler simuliert');
      return {
        write: vi.fn(async (data: string) => {
          content = data;
        }),
        close: vi.fn(async () => {}),
      };
    }),
    getFile: vi.fn(async () => ({
      text: async () => content,
    })),
    // Damit sich der Handle wie ein strukturell klonbares Objekt verhält,
    // wie es IndexedDB von echten FileSystemFileHandles erwartet.
    [Symbol.toStringTag]: 'FileSystemFileHandle',
  };

  return {
    handle: handle as unknown as FileSystemFileHandle,
    setPermission: (p: PermissionState) => (permission = p),
    setFailNextWrite: (v: boolean) => (failNextWrite = v),
    getContent: () => content,
  };
}

describe('FileLinkService', () => {
  let originalPicker: unknown;
  let pickedHandle: ReturnType<typeof makeFakeHandle> | null;
  let fakeDb: { restore: () => void };

  beforeEach(() => {
    fakeDb = installFakeIndexedDb();
    pickedHandle = null;
    originalPicker = (window as unknown as Record<string, unknown>)['showSaveFilePicker'];
    (window as unknown as Record<string, unknown>)['showSaveFilePicker'] = vi.fn(async () => {
      if (!pickedHandle) throw new Error('kein Handle vorbereitet');
      return pickedHandle.handle;
    });
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    (window as unknown as Record<string, unknown>)['showSaveFilePicker'] = originalPicker;
    fakeDb.restore();
  });

  function makeService(): FileLinkService {
    return TestBed.inject(FileLinkService);
  }

  it('erkennt Unterstützung anhand von showSaveFilePicker', () => {
    const service = makeService();
    expect(service.supported).toBe(true);
  });

  it('verknüpft eine Datei und schreibt den Anfangsinhalt', async () => {
    const fake = makeFakeHandle('dienstplan.json');
    pickedHandle = fake;
    const service = makeService();

    const ok = await service.chooseFile('dienstplan.json', '{"a":1}');

    expect(ok).toBe(true);
    expect(service.linkedFileName()).toBe('dienstplan.json');
    expect(service.isLinked).toBe(true);
    expect(fake.getContent()).toBe('{"a":1}');
  });

  it('schreibt nachfolgende Inhalte in denselben Handle', async () => {
    const fake = makeFakeHandle('dienstplan.json');
    pickedHandle = fake;
    const service = makeService();
    await service.chooseFile('dienstplan.json', '{"a":1}');

    await service.write('{"a":2}');

    expect(fake.getContent()).toBe('{"a":2}');
    expect(service.writeError()).toBeNull();
  });

  it('meldet einen Fehler, wenn das Schreiben fehlschlägt, statt ihn zu verschlucken', async () => {
    const fake = makeFakeHandle('dienstplan.json');
    pickedHandle = fake;
    const service = makeService();
    await service.chooseFile('dienstplan.json', '{}');

    fake.setFailNextWrite(true);
    await service.write('{"a":2}');

    expect(service.writeError()).toContain('fehlgeschlagen');
  });

  it('setzt den Fehler bei einem erfolgreichen Schreibvorgang zurück', async () => {
    const fake = makeFakeHandle('dienstplan.json');
    pickedHandle = fake;
    const service = makeService();
    await service.chooseFile('dienstplan.json', '{}');
    fake.setFailNextWrite(true);
    await service.write('{"a":2}');
    expect(service.writeError()).not.toBeNull();

    fake.setFailNextWrite(false);
    await service.write('{"a":3}');

    expect(service.writeError()).toBeNull();
  });

  it('liest den aktuellen Dateiinhalt', async () => {
    const fake = makeFakeHandle('dienstplan.json', '{"gespeichert":true}');
    pickedHandle = fake;
    const service = makeService();
    await service.chooseFile('dienstplan.json', '{"gespeichert":true}');

    const content = await service.read();

    expect(content).toBe('{"gespeichert":true}');
  });

  it('löst die Verknüpfung und liest danach nichts mehr', async () => {
    const fake = makeFakeHandle('dienstplan.json', '{}');
    pickedHandle = fake;
    const service = makeService();
    await service.chooseFile('dienstplan.json', '{}');

    service.unlink();

    expect(service.isLinked).toBe(false);
    expect(service.linkedFileName()).toBeNull();
    expect(await service.read()).toBeNull();
  });

  it('stellt eine frühere Verknüpfung wieder her, wenn die Berechtigung noch gilt', async () => {
    const fake = makeFakeHandle('dienstplan.json', '{"stand":1}');
    pickedHandle = fake;
    const first = makeService();
    await first.chooseFile('dienstplan.json', '{"stand":1}');

    // Neue Service-Instanz simuliert einen Neustart der App.
    TestBed.resetTestingModule();
    const second = makeService();
    await second.restoreLink();

    expect(second.isLinked).toBe(true);
    expect(second.linkedFileName()).toBe('dienstplan.json');
  });

  it('stellt eine Verknüpfung ohne gültige Berechtigung nicht wieder her', async () => {
    // Sicherheitsverhalten des echten Browsers: die Berechtigung für einen
    // gespeicherten Handle kann nach einem Neustart verfallen sein. Ohne
    // 'granted' darf die App nicht kommentarlos in die Datei schreiben.
    const fake = makeFakeHandle('dienstplan.json', '{}');
    pickedHandle = fake;
    const first = makeService();
    await first.chooseFile('dienstplan.json', '{}');
    fake.setPermission('prompt');

    TestBed.resetTestingModule();
    const second = makeService();
    await second.restoreLink();

    expect(second.isLinked).toBe(false);
  });

  it('bleibt ohne vorherige Verknüpfung nach dem Wiederherstellen unverknüpft', async () => {
    const service = makeService();
    await service.restoreLink();
    expect(service.isLinked).toBe(false);
  });

  it('write() ohne Verknüpfung ist ein wirkungsloser Aufruf', async () => {
    const service = makeService();
    await expect(service.write('{}')).resolves.toBeUndefined();
    expect(service.writeError()).toBeNull();
  });
});
