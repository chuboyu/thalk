// Export subscribers and support leads to JSON — the eject/backup path for
// the one dataset that lives outside the repo.
//
//   node scripts/export-subscribers.mjs > backup.json
//
// Requires application-default credentials or `gcloud auth application-default login`.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: 'thalk-1c092' });
const db = getFirestore();

const dump = {};
for (const name of ['subscribers', 'support_leads']) {
  const snap = await db.collection(name).get();
  dump[name] = snap.docs.map((d) => {
    const data = d.data();
    return { id: d.id, ...data, createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null };
  });
}
console.log(JSON.stringify(dump, null, 2));
