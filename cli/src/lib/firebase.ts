import { FirebaseApp, FirebaseOptions, initializeApp } from "firebase/app"
import { getAuth, GithubAuthProvider, signInWithCredential, UserCredential } from "firebase/auth"
import { doc, DocumentSnapshot, Firestore, getDoc, getFirestore, setDoc } from "firebase/firestore"

/**
 * This method initialize a Firebase app if no other app has already been initialized.
 * @param options <FirebaseOptions> - an object w/ every necessary Firebase option to init app.
 * @returns <FirebaseApp> - the initialized Firebase app object.
 */
export const initializeFirebaseApp = (options: FirebaseOptions): FirebaseApp => initializeApp(options)

/**
 * This method returns the Firestore database instance associated to the given Firebase application.
 * @param app <FirebaseApp> - the Firebase application.
 * @returns <Firestore> - the Firebase Firestore associated to the application.
 */
export const getFirestoreDatabase = (app: FirebaseApp): Firestore => {
  if (app.options.databaseURL !== `${`${app.options.projectId}.firebaseio.com`}`)
    throw new Error("Please, check that all FIREBASE variables in the .env file are set correctly.")

  return getFirestore(app)
}

/**
 * Sign in to Firebase with a token generated by Github OAuth authentication.
 * @param token <string> - the Github-Firebase handshake token for authentication w/ Github account to Firebase.
 * @returns <Promise<UserCredential>> - the credentials of the user who authenticated with the Github account in Firebase.
 */
export const signInToFirebaseWithGithubCredentials = async (token: string): Promise<UserCredential> =>
  signInWithCredential(getAuth(), GithubAuthProvider.credential(token))

/**
 * Set a specific document on Firestore.
 * @param db <Firestore> - the Firestore database instance.
 * @param collection <string> - the name of the collection.
 * @param uid <string> - the unique identifier in the collection.
 * @param data <any> - the object containing the document data.
 */
export const recordDocumentInFirestore = async (db: Firestore, collection: string, uid: string, data: any) => {
  // Get document reference.
  const docRef = doc(db, collection, uid)

  // Set document.
  await setDoc(docRef, data)
}

/**
 * Get a specific document from Firestore.
 * @param db <Firestore> - the Firestore database instance.
 * @param collection <string> - the name of the collection.
 * @param uid <string> - the unique identifier in the collection.
 * @returns <Promise<DocumentSnapshot<any>>> - return the document from Firestore.
 */
export const getDocFromFirestore = async (
  db: Firestore,
  collection: string,
  uid: string
): Promise<DocumentSnapshot<any>> => {
  // Get document reference.
  const docRef = doc(db, collection, uid)

  return getDoc(docRef)
}

/**
 * Check if a document is present in the provided collection of the Firestore database.
 * @param db <Firestore> - the Firestore database instance.
 * @param collection <string> - the name of the collection.
 * @param uid <string> - the unique identifier in the collection.
 * @returns <Promise<Boolean>> - true if the document with uid is present in the collection; otherwise false.
 */
export const isDocRecordedOnFirestore = async (db: Firestore, collection: string, uid: string): Promise<Boolean> =>
  (await getDocFromFirestore(db, collection, uid)).exists()