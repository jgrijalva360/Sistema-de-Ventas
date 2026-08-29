import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { DocumentReference, Query, onSnapshot, DocumentSnapshot, QuerySnapshot } from 'firebase/firestore';

/**
 * Crea un Observable en tiempo real para un Documento de Firestore
 * utilizando shareReplay({ bufferSize: 1, refCount: true }) para compartir
 * una única conexión en tiempo real entre todos los consumidores.
 */
export function docStream$<T = any>(docRef: DocumentReference): Observable<DocumentSnapshot> {
  return new Observable<DocumentSnapshot>((subscriber) => {
    const unsubscribe = onSnapshot(
      docRef,
      { includeMetadataChanges: false },
      (snapshot) => subscriber.next(snapshot),
      (error) => {
        console.error('Error en stream de documento Firestore:', error);
        subscriber.error(error);
      }
    );
    return () => unsubscribe();
  }).pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );
}

/**
 * Crea un Observable en tiempo real para una Colección o Consulta de Firestore
 * utilizando shareReplay({ bufferSize: 1, refCount: true }) para sincronización continua.
 */
export function collectionStream$(queryRef: Query): Observable<QuerySnapshot> {
  return new Observable<QuerySnapshot>((subscriber) => {
    const unsubscribe = onSnapshot(
      queryRef,
      { includeMetadataChanges: false },
      (snapshot) => subscriber.next(snapshot),
      (error) => {
        console.error('Error en stream de colección Firestore:', error);
        subscriber.error(error);
      }
    );
    return () => unsubscribe();
  }).pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
