import { adminDb } from "../lib/firebase/admin";
import * as admin from "firebase-admin";

/**
 * 1 Megabyte in bytes
 */
const FIRESTORE_SIZE_LIMIT = 1048576;

/**
 * Abstract mapping interface for database queries
 */
export abstract class BaseRepository<T extends { id?: string }> {
  protected collectionPath: string;

  constructor(collectionPath: string) {
    this.collectionPath = collectionPath;
  }

  protected get collection(): admin.firestore.CollectionReference {
    return adminDb.collection(this.collectionPath);
  }

  /**
   * Enforces Firestore's 1MB document limit mathematically (roughly) before writes.
   * Helps catch massive payload bugs safely before they reach Firebase.
   */
  protected validateSize(data: any) {
    const size = Buffer.byteLength(JSON.stringify(data), 'utf8');
    if (size > FIRESTORE_SIZE_LIMIT * 0.95) { // Warning trigger at 95% capacity
      throw new Error(`Payload size of ${size} bytes exceeds safe Firestore document limit.`);
    }
  }

  public async getById(id: string): Promise<T | null> {
    const doc = await this.collection.doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as T;
  }

  public async save(data: T): Promise<T> {
    const { id, ...saveData } = data;
    this.validateSize(saveData);

    let docRef: admin.firestore.DocumentReference;
    if (id) {
      docRef = this.collection.doc(id);
      await docRef.set(saveData, { merge: true });
    } else {
      docRef = await this.collection.add(saveData);
    }
    return { id: docRef.id, ...saveData } as T;
  }
}
